"""Feed service.

Format a news_cards row for the public API response. Resolves source
information (names, URLs, bias) via services.source_resolver.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from services.source_resolver import (
    calculate_cluster_bias,
    get_heuristic_bias,
    resolve_source_names,
    resolve_source_urls,
)


def format_news_card(row, source_resolve: Optional[dict] = None) -> dict:
    """Format a news card row for the API response.

    If source_resolve is provided (the optimized batch path), uses it
    directly. Otherwise falls back to per-card source resolution.
    """
    source_ids = row["source_ids"] or ""
    ids = [int(x.strip()) for x in source_ids.split(",") if x.strip().isdigit()]

    if source_resolve:
        sr = source_resolve
    else:
        # Fallback to old per-card queries
        sr = {
            "names": resolve_source_names(source_ids),
            "urls": resolve_source_urls(source_ids),
            "bias_score": row["bias_score"] or 0.0,
            "sources_count": len(ids) or 1,
        }
        if sr["bias_score"] == 0.0:
            sr["bias_score"] = calculate_cluster_bias(source_ids)
            if sr["bias_score"] == 0.0:
                sr["bias_score"] = get_heuristic_bias(source_ids)

    return {
        "id": row["id"],
        "location_id": row["location_id"],
        "title": row["title"],
        "summary": row["summary"],
        "body": row["body"] if "body" in row.keys() and row["body"] else row["summary"],
        "image_url": row["image_url"],
        "bias_score": sr["bias_score"],
        "is_gacetilla": row["is_gacetilla"] or 0,
        "cluster_id": row["cluster_id"],
        "category": row["category"],
        "source_ids": source_ids,
        "source_names": sr["names"][:3],
        "source_name": sr["names"][0] if sr["names"] else None,
        "source_url": sr["urls"][0] if sr["urls"] else None,
        "location_name": row["location_name"] if "location_name" in row.keys() else None,
        "location_province": (
            row["location_province"] if "location_province" in row.keys() else None
        ),
        "published_at": row["published_at"],
        "created_at": row["created_at"],
        "sources_count": sr["sources_count"],
        "quality_score": (
            row["quality_score"] if "quality_score" in row.keys() else None
        ),
    }


def format_news_cards_batch(rows: List) -> List[dict]:
    """Format multiple news card rows in a single SQL round-trip.

    Uses _batch_resolve_sources to fetch source info for all unique IDs
    in one query, then formats each row.
    """
    from services.source_resolver import _batch_resolve_sources

    resolved = _batch_resolve_sources(rows)
    return [format_news_card(row, sr) for row, sr in zip(rows, resolved)]