"""Composite source credibility scoring.

Five subscores combined into a single 0-100 credibility score:
- factuality (30%): retraction_count / news_count
- uniqueness (25%): unique_count / news_count
- reliability (20%): sources.reliability_score (0-1) × 100
- freshness (15%): publishing pattern (regular vs burst-and-die)
- diversity (10%): Shannon entropy of categories
"""
from __future__ import annotations

import math
from typing import Any

WEIGHTS = {
    "factuality": 0.30,
    "uniqueness": 0.25,
    "reliability": 0.20,
    "freshness": 0.15,
    "diversity": 0.10,
}


def compute_factuality_score(retraction_count: int, news_count: int) -> int:
    """100 if no retractions. Each retraction subtracts proportional amount."""
    if news_count == 0:
        return 50
    ratio = retraction_count / news_count
    score = max(50, int(100 * (1 - ratio * 5)))  # 5x penalty per retraction
    return min(100, score)


def compute_uniqueness_score(unique_count: int, total_count: int) -> int:
    """Percentage of news that isn't a duplicate of another source."""
    if total_count == 0:
        return 50
    return int(100 * unique_count / total_count)


def compute_freshness_score(
    fetch_count: int,
    days_since_first_fetch: int,
    days_since_last_fetch: int,
) -> int:
    """High if source publishes regularly. Low for burst-and-die.

    Penalizes sources that have stopped publishing (high
    days_since_last_fetch) more aggressively than sources with
    sparse but ongoing output.
    """
    if fetch_count == 0 or days_since_first_fetch == 0:
        return 50
    cadence = fetch_count / max(days_since_first_fetch, 1)
    # Strong recency penalty: every silent day costs 3 points (capped
    # at 80). A source silent for 14 days drops to 50 max.
    recency_penalty = min(80, days_since_last_fetch * 3)
    score = int(min(100, cadence * 30) - recency_penalty)
    return max(0, min(100, score))


def compute_diversity_score(category_counts: dict[str, int]) -> int:
    """Shannon entropy normalized to 0-100. Higher = more diverse topics.

    A source that only ever publishes in ONE category has zero
    diversity (score = 0). A source that publishes equally across
    N categories has maximum diversity (score = 100).
    """
    total = sum(category_counts.values())
    if total == 0:
        return 50
    probs = [c / total for c in category_counts.values() if c > 0]
    if len(probs) <= 1:
        # One category = no diversity at all
        return 0
    entropy = -sum(p * math.log(p) for p in probs)
    max_entropy = math.log(len(probs))
    return int(100 * entropy / max_entropy)


def compute_credibility(
    source_id: int,
    retraction_count: int,
    news_count: int,
    unique_count: int,
    reliability_score: float,
    fetch_count: int,
    days_since_first_fetch: int,
    days_since_last_fetch: int,
    category_counts: dict[str, int],
) -> dict[str, Any]:
    """Compute composite credibility_score and return subscores."""
    subscores = {
        "factuality": compute_factuality_score(retraction_count, news_count),
        "uniqueness": compute_uniqueness_score(unique_count, news_count),
        "reliability": int(reliability_score * 100),
        "freshness": compute_freshness_score(
            fetch_count, days_since_first_fetch, days_since_last_fetch
        ),
        "diversity": compute_diversity_score(category_counts),
    }
    composite = sum(subscores[k] * WEIGHTS[k] for k in WEIGHTS)
    return {
        "source_id": source_id,
        "credibility_score": int(round(composite)),
        "subscores": subscores,
    }