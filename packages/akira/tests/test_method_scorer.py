"""Tests for Method Scorer."""

import pytest
import sqlite3
import os
from core.method_scorer import MethodScorer, MethodScore


@pytest.fixture
def scorer():
    """Create scorer with temporary database."""
    db_path = "/tmp/test_method_scorer.db"

    # Remove if exists
    if os.path.exists(db_path):
        os.remove(db_path)

    scorer = MethodScorer(db_path)
    yield scorer

    scorer.close()
    os.remove(db_path)


def test_init_creates_table(scorer):
    """Test that schema is initialized correctly."""
    conn = sqlite3.connect(scorer.db_path)

    tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()

    table_names = [t[0] for t in tables]

    assert "method_history" in table_names

    # Check columns
    columns = conn.execute("PRAGMA table_info(method_history)").fetchall()
    column_names = [c[1] for c in columns]

    assert "id" in column_names
    assert "url" in column_names
    assert "method" in column_names
    assert "duration_ms" in column_names
    assert "success" in column_names
    assert "hour_of_day" in column_names
    assert "timestamp" in column_names

    conn.close()


def test_record_attempt(scorer):
    """Test recording an attempt."""
    scorer.record_attempt(
        url="https://test.com", method="rss", duration_ms=5000, success=True, hour=10
    )

    conn = sqlite3.connect(scorer.db_path)
    rows = conn.execute("SELECT * FROM method_history").fetchall()

    assert len(rows) == 1
    assert rows[0][1] == "https://test.com"
    assert rows[0][2] == "rss"
    assert rows[0][3] == 5000
    assert rows[0][4] == 1
    assert rows[0][5] == 10

    conn.close()


def test_get_scores_for_url(scorer):
    """Test getting scores for a specific URL."""
    # Record multiple attempts
    scorer.record_attempt("https://test.com", "rss", 5000, True, 10)
    scorer.record_attempt("https://test.com", "rss", 6000, True, 10)
    scorer.record_attempt("https://test.com", "rss", 7000, False, 10)
    scorer.record_attempt("https://test.com", "wp_api", 3000, True, 10)
    scorer.record_attempt("https://test.com", "wp_api", 4000, True, 10)

    scores = scorer.get_scores_for_url("https://test.com")

    assert len(scores) == 2
    assert scores[0].method == "wp_api"
    assert scores[1].method == "rss"
    assert scores[0].score > scores[1].score


def test_weighted_scoring(scorer):
    """Test that WP API scores higher than RSS due to speed."""
    # RSS: slower but same success rate
    for _ in range(5):
        scorer.record_attempt("https://test.com", "rss", 15000, True, 10)

    # WP API: faster with same success rate
    for _ in range(5):
        scorer.record_attempt("https://test.com", "wp_api", 3000, True, 10)

    scores = scorer.get_scores_for_url("https://test.com")

    wp_score = next(s for s in scores if s.method == "wp_api")
    rss_score = next(s for s in scores if s.method == "rss")

    # Both have 100% success rate, but WP API is faster
    assert abs(wp_score.success_rate - 1.0) < 0.01
    assert abs(rss_score.success_rate - 1.0) < 0.01
    assert wp_score.speed_score > rss_score.speed_score
    assert wp_score.score > rss_score.score


def test_get_best_method(scorer):
    """Test getting the best method for a URL."""
    scorer.record_attempt("https://test.com", "rss", 10000, False, 10)
    scorer.record_attempt("https://test.com", "rss", 12000, False, 10)
    scorer.record_attempt("https://test.com", "wp_api", 3000, True, 10)
    scorer.record_attempt("https://test.com", "wp_api", 4000, True, 10)

    best = scorer.get_best_method("https://test.com")

    assert best == "wp_api"

    # Test with no data
    best_none = scorer.get_best_method("https://unknown.com")
    assert best_none is None

    # Test with hour filter
    best_hour = scorer.get_best_method("https://test.com", hour=10)
    assert best_hour == "wp_api"


def test_get_scores_for_hour(scorer):
    """Test getting scores filtered by hour."""
    # Hour 10 data
    scorer.record_attempt("https://test.com", "rss", 5000, True, 10)
    scorer.record_attempt("https://test.com", "rss", 6000, True, 10)

    # Hour 14 data (different performance)
    scorer.record_attempt("https://test.com", "rss", 20000, False, 14)
    scorer.record_attempt("https://test.com", "rss", 25000, False, 14)

    scores_hour10 = scorer.get_scores_for_hour("https://test.com", 10)
    scores_hour14 = scorer.get_scores_for_hour("https://test.com", 14)

    assert len(scores_hour10) == 1
    assert len(scores_hour14) == 1
    assert scores_hour10[0].score > scores_hour14[0].score


def test_get_all_scores(scorer):
    """Test getting scores for all URLs."""
    scorer.record_attempt("https://test1.com", "rss", 5000, True, 10)
    scorer.record_attempt("https://test2.com", "wp_api", 3000, True, 10)
    scorer.record_attempt("https://test1.com", "wp_api", 4000, True, 10)

    all_scores = scorer.get_all_scores()

    assert len(all_scores) == 3
    # All have 100% success, but different speeds
    methods = {s.method + "@" + s.url for s in all_scores}
    assert "rss@https://test1.com" in methods
    assert "wp_api@https://test1.com" in methods
    assert "wp_api@https://test2.com" in methods


def test_reset_scores_for_url(scorer):
    """Test resetting scores for a URL."""
    scorer.record_attempt("https://test1.com", "rss", 5000, True, 10)
    scorer.record_attempt("https://test1.com", "wp_api", 3000, True, 10)
    scorer.record_attempt("https://test2.com", "rss", 6000, True, 10)

    # Reset test1
    scorer.reset_scores("https://test1.com")

    scores_test1 = scorer.get_scores_for_url("https://test1.com")
    scores_test2 = scorer.get_scores_for_url("https://test2.com")

    assert len(scores_test1) == 0
    assert len(scores_test2) == 1


def test_method_score_dataclass():
    """Test MethodScore dataclass."""
    score = MethodScore(
        url="https://test.com",
        method="rss",
        success_rate=0.9,
        avg_duration=3000,
        speed_score=0.95,
        score=0.92,
    )

    assert score.url == "https://test.com"
    assert score.method == "rss"
    assert abs(score.score - 0.92) < 0.01
    assert score.attempts == 0
