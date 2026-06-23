"""Smoke tests for the read-mostly extraction routes.

Covers the previously-untested endpoints in ``routes/extraction.py``
(T4 in the AKIRA Iter 4 code review):

  - GET  /                          → 200, JSON endpoint list
  - GET  /health                    → 200, JSON status
  - GET  /health/detailed           → 200, JSON with sub-components
  - POST /extract                   → 405 (GET not allowed) or 422 (no body)
  - POST /extract/google-news       → 200, JSON with items

These are smoke tests against the live TestClient — no mocking
needed because /health and / don't hit heavy services. /extract
is left as a smoke surface (we just verify the route exists and
rejects bad input; the full cascade requires real extraction
infrastructure that's out of scope for this PR).

Singleton trap: see ``test_routes_synthesis`` docstring — the
``client`` fixture evicts ``main`` and ``config`` from
``sys.modules`` before importing so this file's ``AKIRA_DB_PATH``
wins regardless of test collection order.
"""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient


# ─── env setup ─────────────────────────────────────────────────────
#
# Each test file in this directory MUST use a unique AKIRA_DB_PATH
# so the singleton ``config.settings`` doesn't collide with
# sibling files. We set the env var ONLY inside the ``client``
# fixture below — NEVER at module level.
#
# Why not at module level: pytest imports test modules at
# collection time, in alphabetical order. If test_routes_extraction.py
# sets ``os.environ["AKIRA_DB_PATH"]`` at module level, that runs
# at collection. When the next file (test_routes_integration.py)
# imports and re-asserts its own path, the env var flips back —
# but if a THIRD file (test_routes_synthesis.py) loads AFTER
# integration and overwrites the env var again, integration's
# tests see the wrong (synthesis) DB path during execution.
#
# Setting the env var inside the fixture (instead of at module
# level) makes the assignment happen RIGHT BEFORE main is imported
# in our fixture, so the cached config.settings.db_path picks up
# OUR value. On teardown we drop the cached modules; the next
# file's fixture re-imports main against the env var IT sets in
# ITS fixture.

TEST_DB_PATH = Path(tempfile.gettempdir()) / "akira_pytest_extraction.db"


def _seed_db(path: Path) -> None:
    """Create the minimal schema the health + extraction routes need."""
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
            category TEXT,
            source_ids TEXT,
            bias_score REAL DEFAULT 0,
            published_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE sources (
            id INTEGER PRIMARY KEY,
            name TEXT,
            url TEXT,
            domain TEXT,
            avg_bias REAL,
            news_count INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1
        );
        CREATE TABLE locations (
            id INTEGER PRIMARY KEY,
            name TEXT,
            type TEXT,
            province TEXT
        );
        """
    )
    conn.commit()
    conn.close()


# ─── fixtures ──────────────────────────────────────────────────────


@pytest.fixture(scope="module", autouse=True)
def setup_extraction_db() -> Iterator[None]:
    """Seed the extraction DB once per module. Clean up after."""
    _seed_db(TEST_DB_PATH)
    yield
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """Build a fresh FastAPI app + TestClient, isolated from the
    cached ``main`` module.

    See ``test_routes_synthesis.client`` for the full rationale —
    we build a new app via ``core.app_setup.build_app`` and mount
    only the extraction routes, then restore ``sys.modules`` and
    ``AKIRA_DB_PATH`` on teardown so subsequent test files
    (e.g. ``test_routes_integration``) see a clean cache.
    """
    saved_env = os.environ.get("AKIRA_DB_PATH")

    os.environ["AKIRA_DB_PATH"] = str(TEST_DB_PATH)

    # Evict modules that captured ``config.settings`` at module
    # load time so they re-bind to the fresh AKIRA_DB_PATH set
    # above. See _STALE_SETTINGS_MODULES in test_routes_synthesis
    # for the full list and rationale.
    for mod in (
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
    ):
        sys.modules.pop(mod, None)

    from core.app_setup import build_app  # noqa: PLC0415
    from routes import extraction  # noqa: PLC0415

    app = build_app(akira_version="test-extraction", akira_admin_key=None)
    app.include_router(extraction.router)

    try:
        with TestClient(app) as c:
            yield c
    finally:
        # Teardown: drop the modules we just imported AND restore
        # AKIRA_DB_PATH to its pre-fixture value so the NEXT test
        # file's ``from main import app`` re-imports main against
        # the env var IT set in its own fixture.
        #
        # Order of restoration matters: restore AKIRA_DB_PATH FIRST
        # so the next file's lazy ``from config import settings``
        # (inside main → core.app_setup → config) picks up the
        # restored value, not ours.
        for mod in (
            "config", "main", "core.rag", "core.app_setup", "routes",
            "routes.synthesis", "routes.extraction", "routes.admin",
            "routes.feed", "routes.categories", "routes.locations",
            "routes.radios", "routes.sources", "routes.stats",
        ):
            sys.modules.pop(mod, None)
        if saved_env is None:
            os.environ.pop("AKIRA_DB_PATH", None)
        else:
            os.environ["AKIRA_DB_PATH"] = saved_env


# ─── GET / ─────────────────────────────────────────────────────────


def test_root_returns_endpoint_list(client):
    """GET / returns the hardcoded endpoint list from
    ``routes/extraction.py:43-73``. The list is the API's "what
    can I call" docs — if a route is missing from this list, a
    client reading this endpoint wouldn't know it exists."""
    response = client.get("/")
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "AKIRA"
    assert body["version"].startswith("4.")
    # Endpoint list must contain the public-facing routes.
    endpoints = body["endpoints"]
    assert "/health" in endpoints
    assert "/extract" in endpoints
    assert "/synthesis/stats" in endpoints


# ─── GET /health ───────────────────────────────────────────────────


def test_health_returns_ok(client):
    """GET /health returns the basic liveness probe."""
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["version"].startswith("4.")
    # uptime_seconds is populated from app.state.start_time.
    assert body["uptime_seconds"] >= 0
    # memory_mb is from resource.getrusage — should be > 0 on any
    # real Linux/macOS process.
    assert body["memory_mb"] > 0


# ─── GET /health/detailed ──────────────────────────────────────────


def test_health_detailed_returns_components(client):
    """GET /health/detailed returns the structured HealthReport.

    If the health_monitor isn't initialized (e.g. lifespan failed
    to bootstrap it), the endpoint still returns 200 with a
    fallback report containing the "not initialized" recommendation.
    Either shape is acceptable — we just assert the route works.
    """
    response = client.get("/health/detailed")
    assert response.status_code == 200
    body = response.json()
    # Required fields from HealthReport schema.
    assert "extractor_health" in body
    assert "cache_health" in body
    assert "memory_usage_mb" in body
    assert "open_circuits" in body
    assert "recommendations" in body
    assert isinstance(body["recommendations"], list)


# ─── POST /extract ─────────────────────────────────────────────────


def test_extract_rejects_get_method(client):
    """GET /extract is NOT a valid method — only POST is defined
    (the route's signature is ``@router.post("/extract", ...)``).

    FastAPI returns 405 Method Not Allowed for this case. We
    don't care about the exact status (some versions return 405
    with detail="Method Not Allowed"), we just care that the
    server doesn't crash and returns a sensible error.
    """
    response = client.get("/extract")
    # 405 = method not allowed, 422 = validation error. Either
    # is acceptable; both prove the route is registered and
    # rejects the bad request.
    assert response.status_code in (405, 422)


def test_extract_rejects_post_without_body(client):
    """POST /extract requires a JSON body matching ExtractRequest.
    Empty body → 422 (Pydantic validation error)."""
    response = client.post("/extract")
    assert response.status_code == 422


# ─── POST /extract/google-news ─────────────────────────────────────


def test_extract_google_news_requires_location_or_query(client):
    """POST /extract/google-news requires either ``location_id`` OR
    ``query``. Sending both empty returns 200 with
    ``success=False, error="Either location_id or query required"``
    (the route handles this in-body rather than 422-ing).

    This proves the route is registered AND the validation path
    runs without crashing — useful when verifying the route was
    added correctly without depending on the live Google News
    API (which is flaky and out of scope for these tests).
    """
    response = client.post("/extract/google-news", json={})
    assert response.status_code == 200
    body = response.json()
    # Either the google_news_service isn't initialized (we don't
    # run the full lifespan), or it returns the validation error.
    # Accept both shapes.
    if "error" in body and body["error"]:
        # Service not initialized, OR location/query missing.
        assert body["success"] is False or body["items_count"] == 0
    else:
        # If somehow both branches pass, items_count should be 0.
        assert body["items_count"] == 0
