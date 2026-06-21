"""Locations routes.

GET /api/locations       — all locations (flat list, ordered by type/province/name)
GET /api/locations/tree  — same data, alias for the original tree endpoint

Note: the original `tree` endpoint returned the same flat list, not a
nested tree. The name is preserved for backward compat.
"""
from fastapi import APIRouter

from db.connection import get_db_connection

router = APIRouter(tags=["locations"])


@router.get("/api/locations")
async def get_locations():
    """All locations from the locations table."""
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM locations ORDER BY type, province, name"
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/api/locations/tree")
async def get_locations_tree():
    """Alias for get_locations. Preserved for backward compat (same data)."""
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM locations ORDER BY type, province, name"
        ).fetchall()
    return [dict(r) for r in rows]