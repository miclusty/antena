"""Categories route.

GET /api/categories — distinct categories with article counts and Material
icon names. Used by the front-end category filter.
"""
from __future__ import annotations

import unicodedata

from fastapi import APIRouter

from db.connection import get_db_connection

router = APIRouter(tags=["categories"])

_CATEGORY_ICONS = {
    "generales": "article",
    "sociedad": "groups",
    "deportes": "sports_soccer",
    "tecnología": "devices",
    "judiciales": "gavel",
    "política": "gavel",
    "internacional": "public",
    "economía": "trending_up",
    "culturales": "theater_comedy",
}


@router.get("/api/categories")
async def get_categories():
    """All categories with icons. Derived from news_cards.category."""
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT category, COUNT(*) as count
            FROM news_cards
            WHERE category IS NOT NULL AND category != ''
            GROUP BY category
            ORDER BY count DESC
            """
        ).fetchall()

    categories = []
    for i, row in enumerate(rows):
        cat_name = row["category"]
        slug = (
            unicodedata.normalize("NFD", cat_name.lower())
            .encode("ascii", "ignore")
            .decode("ascii")
        )
        slug = slug.replace(" ", "-")
        categories.append({
            "id": i + 1,
            "slug": slug,
            "name": cat_name.capitalize(),
            "icon": _CATEGORY_ICONS.get(cat_name.lower(), "article"),
        })

    return categories