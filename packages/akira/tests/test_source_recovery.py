"""Tests for Source Recovery Service."""

import pytest
import sqlite3
import os
from core.source_recovery import SourceRecovery, RecoveryResult, RecoveryStatus


@pytest.fixture
def recovery():
    """Create recovery instance with temporary database."""
    db_path = "/tmp/test_source_recovery.db"

    if os.path.exists(db_path):
        os.remove(db_path)

    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE,
            domain TEXT,
            location_id INTEGER,
            province TEXT,
            type TEXT DEFAULT 'diario',
            rss_url TEXT,
            wp_api_url TEXT,
            sitemap_url TEXT,
            extraction_method TEXT,
            reliability_score REAL DEFAULT 0.5,
            is_active BOOLEAN DEFAULT 1,
            deactivation_reason TEXT,
            last_fetch DATETIME,
            last_success DATETIME,
            fetch_count INTEGER DEFAULT 0,
            error_count INTEGER DEFAULT 0,
            news_count INTEGER DEFAULT 0,
            gacetilla_count INTEGER DEFAULT 0,
            avg_bias REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

    recovery = SourceRecovery(db_path)
    yield recovery

    recovery.close()
    if os.path.exists(db_path):
        os.remove(db_path)


def test_init_creates_instance():
    """Test that SourceRecovery initializes with db_path."""
    db_path = "/tmp/test_init_recovery.db"
    recovery = SourceRecovery(db_path)

    assert recovery.db_path == db_path
    assert recovery.FAILURE_THRESHOLD == 5

    recovery.close()
    if os.path.exists(db_path):
        os.remove(db_path)


def test_get_failed_sources_empty(recovery):
    """Test that no failed sources returns empty list."""
    sources = recovery.get_failed_sources()

    assert sources == []


def test_get_failed_sources_with_failures(recovery):
    """Test that sources with >=5 errors are returned."""
    conn = sqlite3.connect(recovery.db_path)
    conn.execute("""
        INSERT INTO sources (name, url, domain, error_count, is_active)
        VALUES ('Test Source', 'https://failed.com', 'failed.com', 8, 1)
    """)
    conn.commit()
    conn.close()

    sources = recovery.get_failed_sources()

    assert len(sources) == 1
    assert sources[0]["url"] == "https://failed.com"
    assert sources[0]["error_count"] == 8


def test_get_failed_sources_below_threshold(recovery):
    """Test that sources with <5 errors are not returned."""
    conn = sqlite3.connect(recovery.db_path)
    conn.execute("""
        INSERT INTO sources (name, url, domain, error_count, is_active)
        VALUES ('Minor Issues', 'https://minor.com', 'minor.com', 3, 1)
    """)
    conn.commit()
    conn.close()

    sources = recovery.get_failed_sources()

    assert sources == []


def test_get_recovery_stats_empty(recovery):
    """Test recovery stats with no data."""
    stats = recovery.get_recovery_stats()

    assert stats["total_failed"] == 0
    assert stats["recovered"] == 0
    assert stats["permanently_dead"] == 0


def test_recovery_result_dataclass():
    """Test RecoveryResult dataclass."""
    result = RecoveryResult(
        url="https://test.com",
        status=RecoveryStatus.RECOVERED,
        method_found="rss",
        new_url="https://test.com/feed/",
    )

    assert result.url == "https://test.com"
    assert result.status == RecoveryStatus.RECOVERED
    assert result.method_found == "rss"
