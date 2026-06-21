"""Source resolver service.

Resolves comma-separated source_ids CSV into names/URLs/bias scores
by querying the `sources` table. Used by the news feed and blindspot routes.
"""
from __future__ import annotations

from typing import Dict, List

from db.connection import get_db_connection


def _parse_source_ids(source_ids_csv: str) -> List[int]:
    """Parse a comma-separated source IDs string into a list of ints.

    Empty or invalid input returns an empty list. Used internally by all
    resolve_* functions.
    """
    if not source_ids_csv:
        return []
    return [
        int(x.strip())
        for x in source_ids_csv.split(",")
        if x.strip().isdigit()
    ]


def resolve_source_names(source_ids_csv: str) -> List[str]:
    """Resolve comma-separated source IDs to names.

    Returns an empty list when source_ids_csv is empty or contains no valid
    IDs. Unknown IDs are returned as 'Fuente {id}' placeholders.
    """
    ids = _parse_source_ids(source_ids_csv)
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    with get_db_connection() as conn:
        rows = conn.execute(
            f"SELECT id, name FROM sources WHERE id IN ({placeholders})", ids
        ).fetchall()
    name_map: Dict[int, str] = {row["id"]: row["name"] for row in rows}
    return [name_map.get(sid, f"Fuente {sid}") for sid in ids]


def resolve_source_urls(source_ids_csv: str) -> List[str | None]:
    """Resolve comma-separated source IDs to URLs.

    Returns None for unknown IDs.
    """
    ids = _parse_source_ids(source_ids_csv)
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    with get_db_connection() as conn:
        rows = conn.execute(
            f"SELECT id, url FROM sources WHERE id IN ({placeholders})", ids
        ).fetchall()
    url_map: Dict[int, str] = {row["id"]: row["url"] for row in rows}
    return [url_map.get(sid, None) for sid in ids]


def calculate_cluster_bias(source_ids_csv: str) -> float:
    """Calculate bias from source avg_bias values.

    If sources have avg_bias populated, return their average. Otherwise
    return 0.0 (bias unknown until ANALYST pipeline runs).
    """
    ids = _parse_source_ids(source_ids_csv)
    if not ids:
        return 0.0
    placeholders = ",".join("?" * len(ids))
    with get_db_connection() as conn:
        rows = conn.execute(
            f"SELECT avg_bias FROM sources WHERE id IN ({placeholders}) AND avg_bias IS NOT NULL",
            ids,
        ).fetchall()
    biases = [row["avg_bias"] for row in rows if row["avg_bias"] is not None]
    if biases:
        avg: float = sum(biases) / len(biases)
        return avg
    return 0.0


def get_heuristic_bias(source_ids_csv: str) -> float:
    """Fallback heuristic bias based on source reliability patterns.

    Temporary measure until the ANALYST pipeline provides real bias scores.
    Uses source reliability_score as a proxy (higher reliability = slight
    officialist tendency).
    """
    ids = _parse_source_ids(source_ids_csv)
    if not ids:
        return 0.0
    placeholders = ",".join("?" * len(ids))
    with get_db_connection() as conn:
        rows = conn.execute(
            f"SELECT reliability_score FROM sources WHERE id IN ({placeholders}) AND reliability_score IS NOT NULL",
            ids,
        ).fetchall()
    scores = [
        row["reliability_score"] for row in rows if row["reliability_score"] is not None
    ]
    if not scores:
        return 0.0
    avg_reliability = sum(scores) / len(scores)
    # Reliability 0.5-0.7 tends toward neutral, above 0.7 slight officialist,
    # below 0.5 slight opposition
    if avg_reliability > 0.7:
        return 0.15  # slight officialist
    elif avg_reliability < 0.5:
        return -0.15  # slight opposition
    return 0.0


def _batch_resolve_sources(rows: List) -> List[dict]:
    """Batch-resolve source names, URLs, and biases for news card rows.

    Returns a list of dicts with keys: names, urls, bias_score, sources_count.
    One dict per row, in the same order. Performs a single SQL query for
    all unique source IDs across all rows (vs. N queries in the per-card
    fallback).
    """
    # Collect all unique source IDs across all rows
    all_ids: set[int] = set()
    source_id_lists: List[List[int]] = []
    for row in rows:
        source_ids = row["source_ids"] or ""
        ids = _parse_source_ids(source_ids)
        source_id_lists.append(ids)
        all_ids.update(ids)

    if not all_ids:
        return [
            {"names": [], "urls": [], "bias_score": 0.0, "sources_count": 0}
            for _ in rows
        ]

    placeholders = ",".join("?" * len(all_ids))
    with get_db_connection() as conn:
        db_rows = conn.execute(
            f"SELECT id, name, url, avg_bias, reliability_score "
            f"FROM sources WHERE id IN ({placeholders})",
            list(all_ids),
        ).fetchall()

    sources_by_id: Dict[int, dict] = {row["id"]: row for row in db_rows}

    results: List[dict] = []
    for ids in source_id_lists:
        if not ids:
            results.append(
                {"names": [], "urls": [], "bias_score": 0.0, "sources_count": 0}
            )
            continue

        names: List[str] = []
        urls: List[str | None] = []
        biases: List[float] = []
        reliability_scores: List[float] = []

        for sid in ids:
            src = sources_by_id.get(sid)
            if src:
                names.append(src["name"])
                urls.append(src["url"])
                if src["avg_bias"] is not None:
                    biases.append(src["avg_bias"])
                if src["reliability_score"] is not None:
                    reliability_scores.append(src["reliability_score"])

        bias_score = 0.0
        if biases:
            bias_score = sum(biases) / len(biases)
        elif reliability_scores:
            avg_rel = sum(reliability_scores) / len(reliability_scores)
            if avg_rel > 0.7:
                bias_score = 0.15
            elif avg_rel < 0.5:
                bias_score = -0.15

        results.append(
            {
                "names": names,
                "urls": urls,
                "bias_score": bias_score,
                "sources_count": len(ids),
            }
        )

    return results