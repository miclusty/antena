"""Tests for source credibility scoring."""
import pytest

from core.credibility import (
    compute_factuality_score,
    compute_uniqueness_score,
    compute_freshness_score,
    compute_diversity_score,
    compute_credibility,
)


def test_factuality_score_no_retractions_is_100():
    """No retractions = 100."""
    assert compute_factuality_score(retraction_count=0, news_count=100) == 100


def test_factuality_score_drops_with_retractions():
    """Each retraction reduces score proportionally."""
    s0 = compute_factuality_score(retraction_count=0, news_count=100)
    s5 = compute_factuality_score(retraction_count=5, news_count=100)
    assert s5 < s0
    assert s5 >= 50  # never below 50


def test_factuality_no_news_returns_50():
    """No news yet = neutral 50."""
    assert compute_factuality_score(retraction_count=0, news_count=0) == 50


def test_uniqueness_score_all_duplicates_is_low():
    """All duplicates = 0."""
    assert compute_uniqueness_score(unique_count=0, total_count=100) == 0


def test_uniqueness_score_all_unique_is_100():
    """All unique = 100."""
    assert compute_uniqueness_score(unique_count=100, total_count=100) == 100


def test_uniqueness_score_empty_returns_50():
    """No news = neutral 50."""
    assert compute_uniqueness_score(unique_count=0, total_count=0) == 50


def test_freshness_score_regular_publisher_is_high():
    """Regular publishing pattern = high score."""
    score = compute_freshness_score(
        fetch_count=100,
        days_since_first_fetch=30,
        days_since_last_fetch=1,
    )
    assert score >= 80


def test_freshness_score_burst_then_die_is_low():
    """Burst-and-die pattern penalized."""
    score = compute_freshness_score(
        fetch_count=100,
        days_since_first_fetch=10,
        days_since_last_fetch=30,  # hasn't published in 30 days
    )
    assert score < 50


def test_diversity_score_single_category_is_low():
    """Only one category = low diversity."""
    counts = {"politica": 100}
    assert compute_diversity_score(counts) < 30


def test_diversity_score_balanced_categories_is_high():
    """Balanced across categories = high diversity."""
    counts = {"politica": 25, "economia": 25, "deportes": 25, "cultura": 25}
    assert compute_diversity_score(counts) >= 90


def test_compute_credibility_combines_subscores():
    """Composite score = weighted average."""
    result = compute_credibility(
        source_id=1,
        retraction_count=2,
        news_count=100,
        unique_count=80,
        reliability_score=0.85,
        fetch_count=100,
        days_since_first_fetch=60,
        days_since_last_fetch=1,
        category_counts={"politica": 30, "economia": 30, "deportes": 40},
    )
    assert "credibility_score" in result
    assert 0 <= result["credibility_score"] <= 100
    assert "subscores" in result
    assert set(result["subscores"]) == {
        "factuality", "uniqueness", "reliability", "freshness", "diversity"
    }