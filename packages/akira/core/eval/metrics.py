"""
Retrieval quality metrics for the AKIRA RAG eval harness.

Implements the 4 metrics that the design doc §1.4 weakness T1
says are missing: recall@K, MRR, nDCG, and hit_rate. These
are computed against a hand-curated golden set (see
data/golden_set.jsonl).

Each metric takes:
  - candidates: list of card_ids the RAG system returned, ordered
    by relevance (best first)
  - relevant: set of card_ids that are actually relevant (from
    the golden set)
  - k: cutoff for the metric

Returns a float in [0, 1] where higher is better.

All metrics are pure-Python / numpy; no external deps beyond
numpy (already a dep of the embedding code).
"""

from __future__ import annotations

import math
from typing import Iterable, List, Set


def recall_at_k(candidates: List[str], relevant: Set[str], k: int) -> float:
    """recall@K = |relevant ∩ top_k(candidates)| / |relevant|

    Measures: what fraction of relevant items did we surface
    in the top-K? High recall means "we didn't miss anything
    important" but doesn't care about ranking precision.
    """
    if not relevant:
        return 0.0
    if k <= 0:
        return 0.0
    top_k = set(candidates[:k])
    return len(top_k & relevant) / len(relevant)


def mrr(candidates: List[str], relevant: Set[str]) -> float:
    """Mean Reciprocal Rank: 1 / position of the FIRST relevant
    item. 1.0 if the first candidate is relevant, 0.5 if the
    second is, 0.0 if none of the top-K are relevant.

    Measures: how high do we rank the most-relevant item?
    Sensitive to ranking quality at the very top.
    """
    if not relevant:
        return 0.0
    for i, cid in enumerate(candidates, 1):
        if cid in relevant:
            return 1.0 / i
    return 0.0


def ndcg_at_k(candidates: List[str], relevant: Set[str], k: int) -> float:
    """Normalized Discounted Cumulative Gain.

    Each relevant item contributes 1 / log2(position+1). The
    result is divided by the ideal DCG (all relevant items at
    the top) to normalize to [0, 1].

    Measures: ranking quality with logarithmic discount for
    position. Less punishing than MRR for near-miss, more
    punishing than recall@K for low-ranked hits.
    """
    if not relevant:
        return 0.0
    if k <= 0:
        return 0.0
    # DCG of the candidates
    dcg = 0.0
    for i, cid in enumerate(candidates[:k], 1):
        if cid in relevant:
            # Use the standard log2 discount. Position 1 → 1.0,
            # position 2 → 0.63, position 3 → 0.5, etc.
            dcg += 1.0 / math.log2(i + 1)
    # IDCG: what if all relevant were at the top?
    n_relevant = min(len(relevant), k)
    idcg = sum(1.0 / math.log2(i + 1) for i in range(1, n_relevant + 1))
    if idcg <= 0:
        return 0.0
    return dcg / idcg


def hit_rate(candidates: List[str], relevant: Set[str], k: int) -> float:
    """hit_rate@K = 1.0 if any of top-K is relevant, else 0.0.

    Binarized: 1 if at least one hit, 0 otherwise. Useful for
    "did we find anything at all?" questions.

    Aggregated over multiple queries by averaging.
    """
    if not relevant:
        return 0.0
    if k <= 0:
        return 0.0
    return 1.0 if any(c in relevant for c in candidates[:k]) else 0.0


def precision_at_k(candidates: List[str], relevant: Set[str], k: int) -> float:
    """precision@K = |relevant ∩ top_k(candidates)| / K

    Measures: of the top-K we returned, what fraction was
    actually relevant? High precision means "we don't waste
    the LLM's attention on noise". The complement of recall
    at the same K.
    """
    if k <= 0:
        return 0.0
    top_k = candidates[:k]
    if not top_k:
        return 0.0
    return len([c for c in top_k if c in relevant]) / len(top_k)


def all_metrics(
    candidates: List[str], relevant: Set[str], k_values: Iterable[int] = (5, 10, 20)
) -> dict:
    """Compute the full metrics suite for a single query.

    Returns a dict of {metric_name: value}. Convenience for
    the eval harness so it doesn't have to call each metric
    separately.
    """
    out = {
        "mrr": mrr(candidates, relevant),
        "hit_rate_at_1": hit_rate(candidates, relevant, 1),
        "hit_rate_at_5": hit_rate(candidates, relevant, 5),
    }
    for k in k_values:
        out[f"recall_at_{k}"] = recall_at_k(candidates, relevant, k)
        out[f"precision_at_{k}"] = precision_at_k(candidates, relevant, k)
        out[f"ndcg_at_{k}"] = ndcg_at_k(candidates, relevant, k)
    return out


def aggregate(per_query: List[dict]) -> dict:
    """Mean-aggregate a list of per-query metric dicts.

    Each input dict has the same keys (as produced by
    all_metrics()). Returns a single dict with each key's
    mean across all queries. The aggregate is what the eval
    harness writes to its JSON report.

    Nested dicts (e.g. semantic_overlap_in_cluster) are
    recursively aggregated. Keys whose values are int/float
    are averaged; non-numeric values are skipped.
    """
    if not per_query:
        return {}

    def avg_numeric(values):
        return sum(v for v in values if isinstance(v, (int, float))) / max(
            len([v for v in values if isinstance(v, (int, float))]), 1
        )

    def walk(items):
        if not items:
            return {}
        keys = set()
        for it in items:
            keys.update(it.keys())
        out = {}
        for k in keys:
            values = [it.get(k) for it in items]
            # If all values are dicts, recurse
            if all(isinstance(v, dict) for v in values if v is not None):
                out[k] = walk([v for v in values if v is not None])
            elif all(isinstance(v, (int, float)) for v in values if v is not None):
                out[k] = avg_numeric(values)
            else:
                # Mixed or non-numeric: skip
                continue
        return out

    return walk(per_query)
