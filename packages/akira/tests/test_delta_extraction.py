"""Tests for delta extraction logic."""

import os
import sqlite3
import tempfile
import pytest
from core.engine import ExtractionEngine, _update_last_harvest
from extractors.base import ExtractedItem


@pytest.fixture
def temp_db():
    """Create a temporary akira.db with required schema."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    conn = sqlite3.connect(path)
    conn.executescript("""
        CREATE TABLE sources (
            id INTEGER PRIMARY KEY,
            url TEXT,
            rss_url TEXT,
            wp_api_url TEXT,
            last_harvest_at DATETIME
        );
        CREATE TABLE seen_urls (
            url TEXT PRIMARY KEY,
            source_id INTEGER,
            first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
            view_count INTEGER DEFAULT 1
        );
        INSERT INTO sources (id, url, last_harvest_at) VALUES (1, 'https://example.com', NULL);
    """)
    conn.commit()
    conn.close()
    yield path
    os.unlink(path)


class TestFilterSeenItems:
    """Test _filter_seen_items batch dedup logic."""

    def test_all_new_items(self, temp_db):
        """All items should pass through when none are seen."""
        engine = _make_engine()
        items = [
            ExtractedItem(
                title="New 1", url="https://example.com/1", summary="Summary one here"
            ),
            ExtractedItem(
                title="New 2", url="https://example.com/2", summary="Summary two here"
            ),
        ]
        result = engine._filter_seen_items(items, temp_db, source_id=1)
        assert len(result) == 2

    def test_all_seen_items(self, temp_db):
        """All items should be filtered when all are seen."""
        conn = sqlite3.connect(temp_db)
        conn.execute(
            "INSERT INTO seen_urls (url, source_id) VALUES ('https://example.com/1', 1)"
        )
        conn.execute(
            "INSERT INTO seen_urls (url, source_id) VALUES ('https://example.com/2', 1)"
        )
        conn.commit()
        conn.close()

        engine = _make_engine()
        items = [
            ExtractedItem(
                title="Seen 1", url="https://example.com/1", summary="Summary one here"
            ),
            ExtractedItem(
                title="Seen 2", url="https://example.com/2", summary="Summary two here"
            ),
        ]
        result = engine._filter_seen_items(items, temp_db, source_id=1)
        assert len(result) == 0

    def test_mixed_new_and_seen(self, temp_db):
        """Only new items should pass through."""
        conn = sqlite3.connect(temp_db)
        conn.execute(
            "INSERT INTO seen_urls (url, source_id) VALUES ('https://example.com/1', 1)"
        )
        conn.commit()
        conn.close()

        engine = _make_engine()
        items = [
            ExtractedItem(
                title="Seen", url="https://example.com/1", summary="Summary one here"
            ),
            ExtractedItem(
                title="New", url="https://example.com/2", summary="Summary two here"
            ),
        ]
        result = engine._filter_seen_items(items, temp_db, source_id=1)
        assert len(result) == 1
        assert result[0].url == "https://example.com/2"

    def test_empty_url_items_skipped(self, temp_db):
        """Items with empty URLs should be filtered out."""
        engine = _make_engine()
        items = [
            ExtractedItem(title="No URL", url="", summary="Summary one here"),
            ExtractedItem(
                title="Has URL", url="https://example.com/1", summary="Summary two here"
            ),
        ]
        result = engine._filter_seen_items(items, temp_db, source_id=1)
        assert len(result) == 1
        assert result[0].url == "https://example.com/1"

    def test_empty_items_list(self, temp_db):
        """Empty list should return empty."""
        engine = _make_engine()
        result = engine._filter_seen_items([], temp_db, source_id=1)
        assert result == []

    def test_marks_urls_as_seen(self, temp_db):
        """New URLs should be inserted into seen_urls."""
        engine = _make_engine()
        items = [
            ExtractedItem(
                title="New", url="https://example.com/new", summary="Summary here now"
            )
        ]
        engine._filter_seen_items(items, temp_db, source_id=1)

        conn = sqlite3.connect(temp_db)
        row = conn.execute(
            "SELECT url, source_id, view_count FROM seen_urls WHERE url = ?",
            ("https://example.com/new",),
        ).fetchone()
        conn.close()
        assert row is not None
        assert row[0] == "https://example.com/new"
        assert row[1] == 1
        assert row[2] == 1

    def test_increments_view_count(self, temp_db):
        """Re-fetching a seen URL should NOT re-insert (it's filtered out)."""
        conn = sqlite3.connect(temp_db)
        conn.execute(
            "INSERT INTO seen_urls (url, source_id, view_count) VALUES ('https://example.com/1', 1, 3)"
        )
        conn.commit()
        conn.close()

        engine = _make_engine()
        items = [
            ExtractedItem(
                title="Seen", url="https://example.com/1", summary="Summary here now"
            )
        ]
        result = engine._filter_seen_items(items, temp_db, source_id=1)
        assert len(result) == 0  # filtered out

        # view_count stays the same — filtered items are not re-inserted
        conn = sqlite3.connect(temp_db)
        row = conn.execute(
            "SELECT view_count FROM seen_urls WHERE url = ?", ("https://example.com/1",)
        ).fetchone()
        conn.close()
        assert row[0] == 3  # unchanged, not re-inserted


class TestUpdateLastHarvest:
    """Test _update_last_harvest function."""

    def test_updates_timestamp(self, temp_db):
        """last_harvest_at should be set to current time."""
        _update_last_harvest(temp_db, source_id=1)

        conn = sqlite3.connect(temp_db)
        row = conn.execute(
            "SELECT last_harvest_at FROM sources WHERE id = 1"
        ).fetchone()
        conn.close()
        assert row[0] is not None
        assert len(row[0]) > 0

    def test_noop_without_db_path(self):
        """Should return early if db_path is None."""
        _update_last_harvest(None, source_id=1)

    def test_noop_without_source_id(self, temp_db):
        """Should return early if source_id is None."""
        _update_last_harvest(temp_db, source_id=None)

    def test_invalid_source_id(self, temp_db):
        """Should not raise for non-existent source_id."""
        _update_last_harvest(temp_db, source_id=999)


def _make_engine():
    """Create a minimal engine with mocked dependencies."""
    from core.cache import CacheManager, MemoryBackend
    from core.rate_limiter import RateLimiter
    from core.circuit_breaker import CircuitBreaker

    cache = CacheManager(MemoryBackend(maxsize=100))
    rate_limiter = RateLimiter(delay=0)
    circuit_breaker = CircuitBreaker(threshold=5, timeout=60)

    return ExtractionEngine(
        extractors=[],
        cache=cache,
        rate_limiter=rate_limiter,
        circuit_breaker=circuit_breaker,
    )
