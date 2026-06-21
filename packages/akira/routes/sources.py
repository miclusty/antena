"""Source routes.

Public read-only endpoints for news sources:
  - GET /api/sources                  — all active sources (list view)
  - GET /api/sources/{source_id}/profile — single source with 30-day bias history

The profile endpoint is used by the source-detail page; it shows how a
source's bias has trended over time.
"""
from fastapi import APIRouter

from db.connection import get_db_connection

router = APIRouter(tags=["sources"])


@router.get("/api/sources")
async def get_sources():
    """List all active sources with bias info, ordered by article count."""
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, name, url, domain, avg_bias, news_count,
                   is_active, reliability_score
            FROM sources
            WHERE is_active = 1
            ORDER BY news_count DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/api/sources/{source_id}/profile")
async def get_source_profile(source_id: int):
    """Source bias profile with recent bias history (last 30 days)."""
    with get_db_connection() as conn:
        source = conn.execute(
            "SELECT * FROM sources WHERE id = ?", (source_id,)
        ).fetchone()

        if not source:
            return {"error": "Source not found"}

        bias_history = conn.execute(
            """
            SELECT DATE(created_at) as day,
                   AVG(bias_score) as avg_bias,
                   COUNT(*) as article_count
            FROM news_cards
            WHERE source_ids LIKE '%' || ? || '%'
              AND bias_score IS NOT NULL
              AND created_at > datetime('now', '-30 days')
            GROUP BY DATE(created_at)
            ORDER BY day DESC
            """,
            (str(source_id),),
        ).fetchall()

    return {
        "id": source["id"],
        "name": source["name"],
        "url": source["url"],
        "domain": source["domain"],
        "avg_bias": source["avg_bias"],
        "reliability_score": source["reliability_score"],
        "news_count": source["news_count"],
        "is_active": source["is_active"],
        "bias_history": [
            {"day": r["day"], "avg_bias": r["avg_bias"], "article_count": r["article_count"]}
            for r in bias_history
        ] if bias_history else [],
    }