"""Integration tests for AKIRA's public read-only routes.

These tests use httpx.AsyncClient against the FastAPI app, with a temporary
SQLite database (NOT the real akira.db). Tests cover:
- /health
- /api/news/feed
- /api/news/{id}
- /api/news/{id}/cluster
- /api/news/blindspot
- /api/locations
- /api/categories
- /api/sources
- /api/stats/health
- /

Admin routes and the /extract endpoint are NOT covered here — they require
side effects (engine, cache, browser pool) that are out of scope for this
integration suite.

NOTE on settings: `settings` in config.py is a singleton — once main is
imported, settings.db_path is frozen at the env-var value seen at import
time. We set AKIRA_DB_PATH at module level, then lazy-import main inside
the client fixture so our env var is honored even if another test file
already imported main with a different db_path.
"""
import os
import sqlite3
import tempfile
from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

# Set the DB path BEFORE any import of main. This env var is read by
# config.Settings() when main.py is first imported.
TEST_DB_PATH = Path(tempfile.gettempdir()) / "akira_pytest_default.db"
# conftest.py at package root already set AKIRA_DB_PATH, but we set it again
# here to be explicit and ensure correctness if conftest is moved.
os.environ["AKIRA_DB_PATH"] = str(TEST_DB_PATH)

# NOTE: `from main import app` is intentionally done INSIDE the `client`
# fixture below, NOT at module level. This avoids the singleton trap where
# another test file's earlier import of main freezes settings.db_path to
# the production DB.


@pytest.fixture(scope="module", autouse=True)
def setup_test_db() -> Iterator[None]:
    """Create the test DB schema + seed minimal data. Runs once per module."""
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()

    conn = sqlite3.connect(TEST_DB_PATH)
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE news_cards (
            id TEXT PRIMARY KEY,
            location_id INTEGER,
            title TEXT,
            summary TEXT,
            body TEXT,
            image_url TEXT,
            bias_score REAL DEFAULT 0,
            is_gacetilla INTEGER DEFAULT 0,
            cluster_id TEXT,
            category TEXT,
            source_ids TEXT,
            published_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE locations (
            id INTEGER PRIMARY KEY,
            name TEXT,
            type TEXT,
            province TEXT
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
        CREATE TABLE categories (
            id INTEGER PRIMARY KEY,
            name TEXT,
            slug TEXT,
            icon TEXT
        );
        CREATE TABLE seen_urls (url TEXT PRIMARY KEY, source_id INTEGER);
        CREATE TABLE source_health (
            source_id INTEGER PRIMARY KEY,
            consecutive_failures INTEGER DEFAULT 0,
            last_success_method TEXT,
            is_circuit_open INTEGER DEFAULT 0
        );
        """
    )
    cur.executemany(
        "INSERT INTO news_cards (id, title, summary, body, bias_score, "
        "category, source_ids, cluster_id, location_id, published_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            # cl1: 3 opposition cards (>=3) + 0 officialist -> blindspot
            ("c1", "Title 1", "Summary 1", "Body 1", -0.5, "política", "2", "cl1", 1, "2026-06-19T10:00:00"),
            ("c2", "Title 2", "Summary 2", "Body 2", -0.4, "política", "2", "cl1", 1, "2026-06-19T11:00:00"),
            ("c3", "Title 3", "Summary 3", "Body 3", -0.6, "política", "2", "cl1", 1, "2026-06-19T12:00:00"),
            # cl2: balanced (1 mild-officialist + 1 mild-opposition)
            ("c4", "Title 4", "Summary 4", "Body 4", 0.05, "economía", "1,2", "cl2", 2, "2026-06-19T13:00:00"),
            ("c5", "Title 5", "Summary 5", "Body 5", -0.05, "economía", "1,2", "cl2", 2, "2026-06-19T14:00:00"),
            # c6: no cluster — exercises the "no cluster" code path
            ("c6", "Title 6", "Summary 6", "Body 6", 0.0, "sociedad", "3", None, None, "2026-06-19T15:00:00"),
        ],
    )
    cur.executemany(
        "INSERT INTO sources (id, name, url, avg_bias, news_count, reliability_score) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        [
            (1, "Source 1", "https://s1.com", 0.1, 50, 0.8),
            (2, "Source 2", "https://s2.com", -0.4, 30, 0.6),
            (3, "Source 3", "https://s3.com", 0.0, 10, 0.7),
        ],
    )
    cur.executemany(
        "INSERT INTO locations (id, name, type, province) VALUES (?, ?, ?, ?)",
        [
            (1, "Buenos Aires", "ciudad", "Buenos Aires"),
            (2, "Córdoba", "ciudad", "Córdoba"),
        ],
    )
    conn.commit()
    conn.close()

    yield

    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink()


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """Lazy-import main so AKIRA_DB_PATH is honored, then create the TestClient."""
    from main import app  # noqa: PLC0415 — intentional lazy import

    with TestClient(app) as c:
        yield c


def test_health_returns_status(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["version"].startswith("4.")


def test_health_detailed(client):
    response = client.get("/health/detailed")
    assert response.status_code == 200


def test_news_feed_default(client):
    response = client.get("/api/news/feed")
    assert response.status_code == 200
    body = response.json()
    assert "news" in body
    assert "total" in body
    assert body["total"] >= 5
    assert body["per_page"] == 20


def test_news_feed_filter_by_category(client):
    response = client.get("/api/news/feed?category=politica")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 3
    for card in body["news"]:
        cat = (card["category"] or "").lower()
        assert cat == "política" or cat == "politica"


def test_news_feed_filter_by_bias_opposition(client):
    response = client.get("/api/news/feed?bias=opposition")
    assert response.status_code == 200
    body = response.json()
    for card in body["news"]:
        assert card["bias_score"] < -0.1


def test_news_feed_filter_by_bias_officialist(client):
    response = client.get("/api/news/feed?bias=officialist")
    assert response.status_code == 200
    body = response.json()
    for card in body["news"]:
        assert card["bias_score"] > 0.1


def test_news_feed_pagination(client):
    response = client.get("/api/news/feed?limit=2&offset=0")
    assert response.status_code == 200
    body = response.json()
    assert len(body["news"]) <= 2
    assert body["page"] == 1
    response2 = client.get("/api/news/feed?limit=2&offset=2")
    body2 = response2.json()
    assert body2["page"] == 2


def test_news_by_id(client):
    response = client.get("/api/news/c1")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "c1"
    assert body["title"] == "Title 1"


def test_news_by_id_404_shape(client):
    """Non-existent id returns the legacy {error: ...} shape (see main.py:1527)."""
    response = client.get("/api/news/nonexistent-id-xyz")
    assert response.status_code == 200  # legacy behavior — main.py:1527
    assert "error" in response.json()


def test_news_cluster(client):
    response = client.get("/api/news/c1/cluster")
    assert response.status_code == 200
    body = response.json()
    assert body["cluster_id"] == "cl1"
    assert len(body["news"]) == 3


def test_news_cluster_no_cluster(client):
    response = client.get("/api/news/c6/cluster")
    assert response.status_code == 200
    assert "error" in response.json()


def test_locations(client):
    response = client.get("/api/locations")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert any(loc["name"] == "Buenos Aires" for loc in body)


def test_locations_tree(client):
    response = client.get("/api/locations/tree")
    assert response.status_code == 200
    assert len(response.json()) == 2


def test_categories(client):
    response = client.get("/api/categories")
    assert response.status_code == 200
    body = response.json()
    categories = {c["slug"] for c in body}
    assert "politica" in categories
    assert "economia" in categories
    assert "sociedad" in categories


def test_sources(client):
    response = client.get("/api/sources")
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 3
    # Source 1 has highest news_count (50) -> first in list
    assert body[0]["name"] == "Source 1"


def test_stats_health(client):
    response = client.get("/api/stats/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    stats = body["stats"]
    assert stats["total_news"] == 6
    assert stats["active_sources"] == 3
    assert stats["total_locations"] == 2


def test_blindspot(client):
    """cl1 has 3 opposition cards (c1, c2, c3) and 0 officialist → blindspot."""
    response = client.get("/api/news/blindspot")
    assert response.status_code == 200
    body = response.json()
    cluster_ids = {item["cluster_id"] for item in body["items"]}
    assert "cl1" in cluster_ids


def test_root_endpoint_lists_endpoints(client):
    """Root endpoint documents the API. The list is hardcoded in main.py:394."""
    response = client.get("/")
    assert response.status_code == 200
    body = response.json()
    assert "/health" in body["endpoints"]
    assert "/extract" in body["endpoints"]
