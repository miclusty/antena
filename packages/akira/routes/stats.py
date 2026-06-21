"""Pipeline stats endpoint.

GET /api/stats/health — public (no auth) summary of pipeline state.
Cheap query — single SELECT with counts.
"""
from fastapi import APIRouter

from db.connection import get_db_connection

router = APIRouter(tags=["stats"])


@router.get("/api/stats/health")
async def get_stats_health():
    """Pipeline health stats (total news, active sources, locations, news/hour)."""
    with get_db_connection() as conn:
        total_news = conn.execute(
            "SELECT COUNT(*) as count FROM news_cards"
        ).fetchone()["count"]
        active_sources = conn.execute(
            "SELECT COUNT(*) as count FROM sources WHERE is_active = 1"
        ).fetchone()["count"]
        total_locations = conn.execute(
            "SELECT COUNT(*) as count FROM locations"
        ).fetchone()["count"]
        import time
        news_last_hour = conn.execute(
            "SELECT COUNT(*) as count FROM news_cards "
            "WHERE created_at > datetime('now', '-1 hour')"
        ).fetchone()["count"]

    return {
        "status": "ok",
        "stats": {
            "total_news": total_news,
            "active_sources": active_sources,
            "total_locations": total_locations,
            "news_last_hour": news_last_hour,
        },
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }