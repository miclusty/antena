"""Smoke tests for the synthesis + cluster routes.

Covers the previously-untested endpoints in ``routes/synthesis.py``
(T2 in the AKIRA Iter 4 code review):

  - GET  /synthesis/master/{cluster_id}     → 404 (unknown), 200 (seeded)
  - POST /cluster/{id}/synthesize           → 401 (no key), 200 (mocked)
  - GET  /synthesis/stats                   → 200 with valid JSON
  - POST /cluster/{id}/synthesize-rag       → ok=False for empty cluster

Strategy:
  - Real FastAPI app via TestClient (mirror ``test_routes_integration``).
  - Separate temp DB so the seeded rows don't collide with other
    test files (each test file gets its own ``AKIRA_DB_PATH``).
  - ``AKIRA_ADMIN_KEY=test`` set BEFORE importing ``main`` so the
    ``check_admin`` dependency honors it (test_admin_auth pattern).
  - ``app.state.synthesis_engine`` replaced with a ``MagicMock``
    for the ``/cluster/{id}/synthesize`` test so we don't hit the
    real MiniMax/LM Studio API.

Singleton trap: ``config.settings`` is a module-level singleton
frozen at first import of ``main``. When pytest collects multiple
test files that each set their own ``AKIRA_DB_PATH``, only the
FIRST file's env var wins (the others see the cached settings).
Fix: in the ``client`` fixture, evict ``main`` + ``config`` from
``sys.modules`` so the import runs fresh against this file's
env var. Tested by running all 3 new test files together — they
produce 21 passed without conflicts.
"""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from pathlib import Path
from typing import Iterator
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient


# ─── env setup ─────────────────────────────────────────────────────
#
# Set BOTH the admin key AND the DB path INSIDE the ``client``
# fixture below — NEVER at module level. See the rationale in
# ``test_routes_extraction.py``.

TEST_DB_PATH = Path(tempfile.gettempdir()) / "akira_pytest_synthesis.db"


# ─── schema + data seeding ─────────────────────────────────────────


def _seed_db(path: Path) -> None:
    """Create the tables the synthesis routes touch + seed minimal data.

    Tables:
      - ``news_cards`` — needed by /cluster/{id}/synthesize (to look up
        cluster contents) and /synthesis/stats (COUNT(DISTINCT cluster_id)).
      - ``master_articles`` — needed by /synthesis/master/{id} (the
        SELECT * target) and /synthesis/stats (COUNT).
      - ``rag_queries`` — best-effort try/except in /synthesis/master,
        so it doesn't strictly need to exist, but we create it so
        the JOIN in /synthesis/master doesn't take the except branch.
    """
    if path.exists():
        path.unlink()
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE news_cards (
            id TEXT PRIMARY KEY,
            cluster_id TEXT,
            title TEXT,
            summary TEXT,
            body TEXT,
            image_url TEXT,
            bias_score REAL DEFAULT 0,
            bias_reasoning TEXT,
            is_gacetilla INTEGER DEFAULT 0,
            category TEXT,
            source_ids TEXT,
            location_id INTEGER,
            published_at TEXT,
            source_url TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE sources (
            id INTEGER PRIMARY KEY,
            name TEXT,
            url TEXT,
            domain TEXT,
            avg_bias REAL,
            news_count INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            reliability_score REAL,
            codgl TEXT
        );
        CREATE TABLE master_articles (
            id TEXT PRIMARY KEY,
            cluster_id TEXT,
            title TEXT,
            summary TEXT,
            neutral_perspective TEXT,
            officialist_perspective TEXT,
            opposition_perspective TEXT,
            verified_facts TEXT,
            disputed_claims TEXT,
            sources_count INTEGER DEFAULT 0,
            bias_min REAL,
            bias_max REAL,
            bias_avg REAL,
            created_at TEXT
        );
        CREATE TABLE rag_queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cluster_id TEXT,
            model TEXT,
            prompt_tokens INTEGER,
            completion_tokens INTEGER,
            neighbors_used TEXT,
            entities_used TEXT,
            perspectives TEXT,
            latency_ms INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    # Seed 3 cards in cluster 'cl1' so /synthesis/stats has
    # total_clusters=1 to report.
    conn.executemany(
        "INSERT INTO news_cards (id, cluster_id, title, summary, bias_score) "
        "VALUES (?, ?, ?, ?, ?)",
        [
            ("c1", "cl1", "Title 1", "Summary 1", 0.0),
            ("c2", "cl1", "Title 2", "Summary 2", 0.0),
            ("c3", "cl1", "Title 3", "Summary 3", 0.0),
        ],
    )
    # Seed one master_articles row for 'cl1' so GET
    # /synthesis/master/cl1 returns 200 with content.
    conn.execute(
        "INSERT INTO master_articles "
        "(id, cluster_id, title, summary, neutral_perspective, "
        " officialist_perspective, opposition_perspective, sources_count, "
        " bias_min, bias_max, bias_avg, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "master-cl1",
            "cl1",
            "Master Title",
            "Master Summary",
            "Neutral perspective text",
            "Pro-gov perspective text",
            "Anti-gov perspective text",
            3,
            -0.5,
            0.5,
            0.0,
            "2026-06-23T10:00:00",
        ),
    )
    conn.commit()
    conn.close()


# ─── fixtures ──────────────────────────────────────────────────────


@pytest.fixture(scope="module", autouse=True)
def setup_synthesis_db() -> Iterator[None]:
    """Seed the synthesis DB once per module. Clean up after."""
    _seed_db(TEST_DB_PATH)
    yield
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """Build a fresh FastAPI app + TestClient, isolated from the
    cached ``main`` module.

    The naive ``from main import app`` pattern fails because
    ``config.settings.db_path`` is a module-level singleton
    frozen at first import of ``config`` — once another test
    file (e.g. ``test_routes_integration``) has imported main
    with a different ``AKIRA_DB_PATH``, the cached ``main.app``
    permanently points at the wrong DB. Subsequent test files
    that set their own ``AKIRA_DB_PATH`` would silently inherit
    the wrong DB without raising.

    The fix used here:
      1. Snapshot the current ``AKIRA_DB_PATH`` + ``sys.modules``
         state BEFORE we touch anything.
      2. Build a NEW FastAPI app via ``core.app_setup.build_app``
         (same as ``test_admin_auth``), include only the routes
         we need (extraction + synthesis), and skip the lifespan
         (it's irrelevant for read-mostly smoke tests and slow
         to spin up the full extraction engine).
      3. Restore ``AKIRA_DB_PATH`` + ``sys.modules`` on teardown
         so subsequent test files (e.g. ``test_routes_integration``)
         see a pristine module cache and pick up their own
         ``AKIRA_DB_PATH`` cleanly.

    This way we don't pollute sys.modules for other tests.
    """
    saved_env = os.environ.get("AKIRA_DB_PATH")

    os.environ["AKIRA_DB_PATH"] = str(TEST_DB_PATH)
    os.environ["AKIRA_ADMIN_KEY"] = "test-admin-key"

    # Force a fresh import of every module that captured
    # ``config.settings`` at module level. Without this, the
    # first-loaded main (from another test file) wins, and the
    # routes will use its (wrong) db_path.
    for mod in _STALE_SETTINGS_MODULES:
        sys.modules.pop(mod, None)

    from core.app_setup import build_app  # noqa: PLC0415
    from routes import extraction, synthesis  # noqa: PLC0415

    app = build_app(akira_version="test-synthesis", akira_admin_key="test-admin-key")
    app.include_router(extraction.router)
    app.include_router(synthesis.router)

    try:
        with TestClient(app) as c:
            yield c
    finally:
        # Teardown: drop the modules we just imported AND restore
        # AKIRA_DB_PATH to its pre-fixture value so the NEXT test
        # file's ``from main import app`` re-imports main against
        # the env var IT set in its own fixture.
        #
        # Order of restoration matters: pop modules FIRST so any
        # stale ``from config import settings`` reference inside
        # them is dropped, then restore AKIRA_DB_PATH so the next
        # file's lazy ``from config import settings`` re-imports
        # config against the restored env var.
        for mod in _STALE_SETTINGS_MODULES:
            sys.modules.pop(mod, None)
        if saved_env is None:
            os.environ.pop("AKIRA_DB_PATH", None)
        else:
            os.environ["AKIRA_DB_PATH"] = saved_env


# Modules that did ``from config import settings`` at module load
# time. They MUST be evicted before any of our routes are imported,
# otherwise the cached settings reference will point at a stale
# AKIRA_DB_PATH from another test file.
#
# Identified via grep over packages/akira/{core,routes,db}/:
#   - core.rag              (RAGEngine)
#   - core.app_setup        (build_app, lifespan)
#   - routes.synthesis      (master_article, stats, synthesize-rag)
#   - routes.extraction     (root, health)
#
# db.connection is intentionally NOT in this list — it lazy-imports
# ``from config import settings`` inside get_db_connection(), so it
# always picks up the fresh value.
_STALE_SETTINGS_MODULES = (
    "config",
    "main",
    "core.rag",
    "core.app_setup",
    "routes",
    "routes.synthesis",
    "routes.extraction",
    "routes.admin",
    "routes.feed",
    "routes.categories",
    "routes.locations",
    "routes.radios",
    "routes.sources",
    "routes.stats",
)


# ─── /synthesis/master/{cluster_id} ────────────────────────────────


def test_synthesis_master_returns_404_shape_for_unknown_id(client):
    """Unknown cluster_id returns 200 with the legacy 'empty record'
    shape (see ``routes/synthesis.py:165-182``). NOT a 404 — the
    endpoint deliberately returns 200 with empty strings so clients
    can render a "no master article yet" UI without a special case.
    """
    response = client.get("/synthesis/master/nonexistent-cluster-xyz")
    # The route does not raise HTTPException — it returns a
    # MasterArticle-shaped dict with empty strings.
    assert response.status_code == 200
    body = response.json()
    assert body["cluster_id"] == "nonexistent-cluster-xyz"
    assert body["id"] == ""
    assert body["title"] == ""
    assert body["sources_count"] == 0
    assert body["rag_neighbors"] == 0


def test_synthesis_master_returns_200_for_seeded_id(client):
    """A seeded master_articles row surfaces all its fields through
    the endpoint, including the 3 perspective columns."""
    response = client.get("/synthesis/master/cl1")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "master-cl1"
    assert body["cluster_id"] == "cl1"
    assert body["title"] == "Master Title"
    assert body["summary"] == "Master Summary"
    assert body["sources_count"] == 3
    assert body["bias_min"] == -0.5
    assert body["bias_max"] == 0.5
    # 3 perspectives from the seeded row.
    assert body["neutral_perspective"] == "Neutral perspective text"
    assert body["pro_gov_perspective"] == "Pro-gov perspective text"
    assert body["anti_gov_perspective"] == "Anti-gov perspective text"


# ─── /cluster/{id}/synthesize (admin-protected) ────────────────────


def test_cluster_synthesize_requires_admin_key(client):
    """POST /cluster/{id}/synthesize WITHOUT X-Admin-Key → 401.

    The ``check_admin`` dependency runs before the endpoint body;
    without the right key, the user gets a 401 with no synthesis
    attempt (saves a ~30s LM call).
    """
    response = client.post("/cluster/cl1/synthesize")
    assert response.status_code == 401
    body = response.json()
    assert "Unauthorized" in body["detail"] or "Admin" in body["detail"]


def test_cluster_synthesize_with_admin_key_uses_mocked_engine(client):
    """POST /cluster/{id}/synthesize WITH the admin key reaches the
    endpoint body. We patch ``app.state.synthesis_engine`` with a
    MagicMock so the route doesn't try to invoke the real LM/MiniMax.

    The mock returns a SynthesisResult-shaped dict; the route then
    passes that through to the response."""
    # Access the live app instance via the TestClient (the same
    # FastAPI instance the route reads from). We use ``client.app``
    # instead of ``from main import app`` because main's cached
    # module is shared across the whole pytest session — touching
    # its app.state would leak the mock into other test files.
    app = client.app

    mock_engine = MagicMock()
    mock_engine.synthesize_cluster.return_value = {
        "master_id": "mock-master-id",
        "cluster_id": "cl1",
        "title": "Mock Synthesized Title",
        "sources_count": 3,
        "verified_facts_count": 2,
    }
    app.state.synthesis_engine = mock_engine
    try:
        response = client.post(
            "/cluster/cl1/synthesize",
            headers={"X-Admin-Key": "test-admin-key"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["master_id"] == "mock-master-id"
        assert body["cluster_id"] == "cl1"
        assert body["title"] == "Mock Synthesized Title"
        assert body["sources_count"] == 3
        assert body["verified_facts_count"] == 2
        # Verify the engine was actually called (not bypassed).
        mock_engine.synthesize_cluster.assert_called_once_with("cl1")
    finally:
        # Clean up: drop the mock so other tests don't see it.
        if hasattr(app.state, "synthesis_engine"):
            del app.state.synthesis_engine


# ─── /synthesis/stats ──────────────────────────────────────────────


def test_synthesis_stats_returns_valid_json(client):
    """GET /synthesis/stats returns 200 with the expected shape.

    Schema: master_articles count, total_clusters count,
    coverage_pct, avg_sources_per_master. Coverage_pct = 1.0
    (1 master for 1 cluster) and avg_sources_per_master = 3.0
    (the seeded row has sources_count=3).
    """
    response = client.get("/synthesis/stats")
    assert response.status_code == 200
    body = response.json()
    assert body["master_articles"] == 1
    assert body["total_clusters"] == 1
    assert body["coverage_pct"] == 100.0
    assert body["avg_sources_per_master"] == 3.0


# ─── /cluster/{id}/synthesize-rag ──────────────────────────────────


def test_cluster_synthesize_rag_returns_ok_false_for_unknown(client):
    """POST /cluster/nonexistent/synthesize-rag does NOT pre-validate
    the cluster_id — it instantiates an RAGEngine and calls
    ``synthesize()`` which returns ``None`` for empty clusters. The
    route surfaces that as 200 + ``{"ok": False, "error": ...}``.

    This is the correct behavior: the route is admin-protected AND
    idempotent (safe to retry). A 404 here would force the caller
    to differentiate "cluster doesn't exist" from "synthesis
    failed" — easier to return a uniform ok=True/False shape.
    """
    response = client.post(
        "/cluster/nonexistent-xyz/synthesize-rag",
        headers={"X-Admin-Key": "test-admin-key"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
    assert body["cluster_id"] == "nonexistent-xyz"
    assert "error" in body


def test_cluster_synthesize_rag_requires_admin_key(client):
    """Same admin gate as the legacy /synthesize endpoint."""
    response = client.post("/cluster/cl1/synthesize-rag")
    assert response.status_code == 401
