"""Tests for Method Learner."""

import pytest
import sqlite3
import os
import json
from core.method_learner import MethodLearner


@pytest.fixture
def learner():
    """Create learner with temporary database."""
    db_path = "/tmp/test_method_learner.db"

    # Remove if exists
    if os.path.exists(db_path):
        os.remove(db_path)

    learner = MethodLearner(db_path)
    yield learner

    learner.close()
    os.remove(db_path)


def test_init_schema(learner):
    """Test that schema is initialized correctly."""
    # Check tables exist
    conn = sqlite3.connect(learner.db_path)

    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()

    table_names = [t[0] for t in tables]

    assert "source_health" in table_names
    assert "extraction_stats" in table_names

    conn.close()


def test_get_best_method_none(learner):
    """Test get_best_method returns None for unknown URL."""
    result = learner.get_best_method("https://unknown.com/feed/")

    assert result is None


def test_get_best_method_found(learner):
    """Test get_best_method returns method after success recorded."""
    url = "https://test.com/feed/"

    # Record success
    learner.record_success(url, "rss", 3000, 10)

    # Get best method
    result = learner.get_best_method(url)

    assert result == "rss"


def test_get_best_method_circuit_open(learner):
    """Test get_best_method returns None when circuit is open."""
    url = "https://failed.com/feed/"

    # Record 5 failures
    for i in range(5):
        learner.record_failure(url, "rss", 1000, "timeout")

    # Circuit should be open
    result = learner.get_best_method(url)

    assert result is None


def test_record_success_new_url(learner):
    """Test recording success for new URL."""
    url = "https://new.com/feed/"

    learner.record_success(url, "rss", 3000, 10)

    # Verify recorded
    conn = sqlite3.connect(learner.db_path)
    conn.row_factory = sqlite3.Row

    row = conn.execute("SELECT * FROM source_health WHERE url = ?", (url,)).fetchone()

    assert row is not None
    assert row["last_success_method"] == "rss"
    assert row["consecutive_failures"] == 0
    assert row["is_circuit_open"] == 0

    # Verify success count
    success_count = json.loads(row["success_count"])
    assert success_count["rss"] == 1

    conn.close()


def test_record_success_existing_url(learner):
    """Test recording success updates existing URL."""
    url = "https://existing.com/feed/"

    # First success
    learner.record_success(url, "rss", 3000, 10)

    # Second success with different method
    learner.record_success(url, "wp_api", 2500, 8)

    # Verify updated
    conn = sqlite3.connect(learner.db_path)
    conn.row_factory = sqlite3.Row

    row = conn.execute("SELECT * FROM source_health WHERE url = ?", (url,)).fetchone()

    assert row["last_success_method"] == "wp_api"
    assert row["consecutive_failures"] == 0

    # Verify success counts
    success_count = json.loads(row["success_count"])
    assert success_count["rss"] == 1
    assert success_count["wp_api"] == 1

    conn.close()


def test_record_failure(learner):
    """Test recording failure."""
    url = "https://failed.com/feed/"

    learner.record_failure(url, "rss", 1000, "timeout")

    # Verify recorded
    conn = sqlite3.connect(learner.db_path)
    conn.row_factory = sqlite3.Row

    row = conn.execute("SELECT * FROM source_health WHERE url = ?", (url,)).fetchone()

    assert row is not None
    assert row["consecutive_failures"] == 1
    assert row["is_circuit_open"] == 0

    conn.close()


def test_record_failure_multiple(learner):
    """Test multiple failures open circuit."""
    url = "https://multifail.com/feed/"

    # Record 5 failures
    for i in range(5):
        learner.record_failure(url, "rss", 1000, "timeout")

    # Verify circuit open
    conn = sqlite3.connect(learner.db_path)
    conn.row_factory = sqlite3.Row

    row = conn.execute("SELECT * FROM source_health WHERE url = ?", (url,)).fetchone()

    assert row["consecutive_failures"] == 5
    assert row["is_circuit_open"] == 1

    conn.close()


def test_reset_learning_specific_url(learner):
    """Test resetting learning for specific URL."""
    url = "https://reset.com/feed/"

    # Record data
    learner.record_success(url, "rss", 3000, 10)

    # Reset
    learner.reset_learning(url)

    # Verify removed
    conn = sqlite3.connect(learner.db_path)

    row = conn.execute("SELECT * FROM source_health WHERE url = ?", (url,)).fetchone()

    assert row is None

    conn.close()


def test_reset_learning_all(learner):
    """Test resetting learning for all URLs."""
    # Record data for multiple URLs
    learner.record_success("https://a.com/feed/", "rss", 3000, 10)
    learner.record_success("https://b.com/feed/", "wp_api", 2500, 8)

    # Reset all
    learner.reset_learning()

    # Verify all removed
    conn = sqlite3.connect(learner.db_path)

    count = conn.execute("SELECT COUNT(*) FROM source_health").fetchone()[0]

    assert count == 0

    conn.close()


def test_get_stats(learner):
    """Test getting learning statistics."""
    # Record some data
    learner.record_success("https://a.com/feed/", "rss", 3000, 10)
    learner.record_success("https://b.com/feed/", "wp_api", 2500, 8)
    learner.record_success("https://c.com/feed/", "rss", 3500, 12)

    # Get stats
    stats = learner.get_stats()

    assert stats["total_sources_tracked"] == 3
    assert stats["circuit_open_sources"] == 0
    assert stats["method_distribution"]["rss"] == 2
    assert stats["method_distribution"]["wp_api"] == 1
