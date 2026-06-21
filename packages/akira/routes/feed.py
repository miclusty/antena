"""News feed routes.

Public read-only endpoints for the news cards collection:
  - GET /api/news/feed         — paginated, filterable feed
  - GET /api/news/blindspot    — clusters covered by only one political side
  - GET /api/news/{news_id}    — single card
  - GET /api/news/{news_id}/cluster — all cards in the same cluster

All queries use the canonical get_db_connection() helper (full PRAGMA set).
"""
from __future__ import annotations

import unicodedata
from typing import Optional

from fastapi import APIRouter, Query

from db.connection import get_db_connection
from services.feed_service import format_news_card
from services.source_resolver import (
    _batch_resolve_sources,
    resolve_source_names,
)

router = APIRouter(tags=["news"])


@router.get("/api/news/feed")
async def get_news_feed(
    category: Optional[str] = None,
    location_id: Optional[int] = None,
    bias: Optional[str] = None,  # 'officialist', 'opposition', 'neutral'
    time: Optional[str] = None,  # 'hour', 'today', 'week', or None for all
    min_quality: Optional[float] = Query(default=None, ge=0, le=1),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """Paginated news feed with filters."""
    query = """
        SELECT nc.*, l.name as location_name, l.province as location_province
        FROM news_cards nc
        LEFT JOIN locations l ON l.id = nc.location_id
        WHERE 1=1
    """
    params: list = []

    # Time filter — server-side so pagination works correctly
    if time == "hour":
        query += " AND nc.created_at >= datetime('now', '-1 hour')"
    elif time == "today":
        query += " AND nc.created_at >= datetime('now', '-1 day')"
    elif time == "week":
        query += " AND nc.created_at >= datetime('now', '-7 days')"
    # "all" or None: no additional time constraint

    if category:
        cat_normalized = (
            unicodedata.normalize("NFD", category.lower())
            .encode("ascii", "ignore")
            .decode("ascii")
        )
        cat_normalized = cat_normalized.replace("-", " ")
        query += " AND LOWER(to_ascii(nc.category)) = ?"
        params.append(cat_normalized)
    if location_id:
        query += " AND nc.location_id = ?"
        params.append(location_id)
    if bias == "officialist":
        query += " AND nc.bias_score > 0.1"
    elif bias == "opposition":
        query += " AND nc.bias_score < -0.1"
    elif bias == "neutral":
        query += " AND nc.bias_score BETWEEN -0.1 AND 0.1"

    # Quality filter — min_quality parameter (0.0 to 1.0).
    # NULL quality_score means unscored — COALESCE treats NULL as 0, which
    # passes low thresholds (so unscored cards appear in results).
    if min_quality is not None:
        query += " AND COALESCE(nc.quality_score, 0) >= ?"
        params.append(min_quality)

    count_query = query.replace(
        "SELECT nc.*, l.name as location_name, l.province as location_province",
        "SELECT COUNT(*) as count",
    )
    with get_db_connection() as conn:
        total = conn.execute(count_query, params).fetchone()["count"]
        query += " ORDER BY nc.created_at DESC LIMIT ? OFFSET ?"
        rows = conn.execute(query, params + [limit, offset]).fetchall()

    # Batch-resolve all source data in a single query (avoids N+1)
    source_resolve_list = _batch_resolve_sources(rows)
    news = [format_news_card(row, sr) for row, sr in zip(rows, source_resolve_list)]

    return {
        "news": news,
        "total": total,
        "page": (offset // limit) + 1 if limit > 0 else 1,
        "per_page": limit,
        "location": None,
        "category": category,
        "bias": bias,
    }


@router.get("/api/news/blindspot")
async def get_blindspot(
    limit: int = Query(default=10, ge=1, le=50),
):
    """Stories covered by only one side of the political spectrum — 'blindspots'.

    A cluster qualifies if it has >=3 cards on one side (officialist or
    opposition) and 0 on the other.
    """
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT nc.cluster_id,
                   nc.title,
                   nc.summary,
                   nc.category,
                   nc.image_url,
                   nc.bias_score,
                   nc.published_at,
                   nc.created_at,
                   nc.source_ids,
                   l.name as location_name,
                   l.province as location_province,
                   COUNT(*) as source_count,
                   SUM(CASE WHEN nc.bias_score > 0.1 THEN 1 ELSE 0 END) as officialist_count,
                   SUM(CASE WHEN nc.bias_score < -0.1 THEN 1 ELSE 0 END) as opposition_count
            FROM news_cards nc
            LEFT JOIN locations l ON l.id = nc.location_id
            WHERE nc.cluster_id IS NOT NULL AND nc.cluster_id != ''
              AND nc.bias_score IS NOT NULL
            GROUP BY nc.cluster_id
            HAVING (SUM(CASE WHEN nc.bias_score > 0.1 THEN 1 ELSE 0 END) >= 3
                    AND SUM(CASE WHEN nc.bias_score < -0.1 THEN 1 ELSE 0 END) = 0)
                OR (SUM(CASE WHEN nc.bias_score < -0.1 THEN 1 ELSE 0 END) >= 3
                    AND SUM(CASE WHEN nc.bias_score > 0.1 THEN 1 ELSE 0 END) = 0)
            ORDER BY MAX(nc.created_at) DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    results = []
    for row in rows:
        source_ids = row["source_ids"] or ""
        source_names = resolve_source_names(source_ids)
        is_officialist_only = row["opposition_count"] == 0

        results.append({
            "cluster_id": row["cluster_id"],
            "title": row["title"],
            "summary": row["summary"],
            "category": row["category"],
            "image_url": row["image_url"],
            "bias_score": row["bias_score"],
            "published_at": row["published_at"],
            "created_at": row["created_at"],
            "location_name": row["location_name"],
            "location_province": row["location_province"],
            "source_names": source_names[:3],
            "source_count": row["source_count"],
            "officialist_count": row["officialist_count"],
            "opposition_count": row["opposition_count"],
            "bias_type": "Solo oficialista" if is_officialist_only else "Solo opositor",
        })

    return {"items": results, "total": len(results)}


@router.get("/api/news/{news_id}")
async def get_news_by_id(news_id: str):
    """Single news card by ID. Returns {error: ...} on miss (legacy shape)."""
    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT nc.*, l.name as location_name, l.province as location_province
            FROM news_cards nc
            LEFT JOIN locations l ON l.id = nc.location_id
            WHERE nc.id = ?
            """,
            (news_id,),
        ).fetchone()

    if not row:
        return {"error": "Not found"}

    card = format_news_card(row)
    card["location_name"] = row["location_name"]
    card["location_province"] = row["location_province"]
    return card


@router.get("/api/news/{news_id}/cluster")
async def get_news_cluster(news_id: str):
    """All news cards in the same cluster as the given card."""
    with get_db_connection() as conn:
        news_row = conn.execute(
            "SELECT cluster_id FROM news_cards WHERE id = ?", (news_id,)
        ).fetchone()
        if not news_row or not news_row["cluster_id"]:
            return {"error": "Not found or no cluster"}

        cluster_id = news_row["cluster_id"]

        rows = conn.execute(
            """
            SELECT nc.*, l.name as location_name, l.province as location_province
            FROM news_cards nc
            LEFT JOIN locations l ON l.id = nc.location_id
            WHERE nc.cluster_id = ?
            ORDER BY nc.created_at DESC
            """,
            (cluster_id,),
        ).fetchall()

    news = []
    for row in rows:
        card = format_news_card(row)
        card["location_name"] = row["location_name"]
        card["location_province"] = row["location_province"]
        news.append(card)

    return {"cluster_id": cluster_id, "news": news}