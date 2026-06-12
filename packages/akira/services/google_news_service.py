"""Google News Service - Location-aware query builder."""

import sqlite3
import logging
from typing import Optional, List, Dict

logger = logging.getLogger("akira")


class GoogleNewsService:
    """
    Service for building location-aware Google News queries.

    Uses local SQLite database with Argentine locations (provinces, cities, towns).
    """

    def __init__(self, locations_db_path: str):
        """
        Initialize service with locations database.

        Args:
            locations_db_path: Path to locations SQLite database
        """
        self.locations_db = sqlite3.connect(locations_db_path)
        self.locations_db.row_factory = sqlite3.Row
        logger.info(f"google_news_service_initialized db={locations_db_path}")

    def get_location(self, location_id: int) -> Optional[Dict]:
        """
        Get location from database.

        Args:
            location_id: Location ID

        Returns:
            Location dict with id, name, province, type, etc. or None if not found
        """
        row = self.locations_db.execute(
            "SELECT * FROM locations WHERE id = ?", (location_id,)
        ).fetchone()

        return dict(row) if row else None

    def build_query(self, location_id: int) -> str:
        """
        Build Google News search query for location.

        Examples:
            location_id=101 (Córdoba Capital, ciudad) → "noticias Córdoba Capital Córdoba"
            location_id=3 (Córdoba, provincia) → "noticias Córdoba"
            location_id=1 (Argentina, pais) → "noticias Argentina"

        Args:
            location_id: Location ID

        Returns:
            Google News search query

        Raises:
            ValueError: If location not found
        """
        location = self.get_location(location_id)

        if not location:
            raise ValueError(f"Location {location_id} not found")

        name = location["name"]
        province = location.get("province", "")
        location_type = location.get("type", "ciudad")

        if location_type == "ciudad":
            return f"noticias {name} {province}"
        elif location_type == "provincia":
            return f"noticias {name}"
        elif location_type == "autonomous_city":
            return f"noticias {name}"
        else:
            return f"noticias {name}"

    def get_locations_by_type(
        self, location_type: str, province_filter: Optional[str] = None
    ) -> List[Dict]:
        """
        Get all locations of a specific type.

        Args:
            location_type: Location type (provincia, ciudad, pueblo, autonomous_city)
            province_filter: Optional province filter

        Returns:
            List of location dicts
        """
        query = "SELECT * FROM locations WHERE type = ?"
        params = [location_type]

        if province_filter:
            query += " AND province = ?"
            params.append(province_filter)

        rows = self.locations_db.execute(query, params).fetchall()

        return [dict(row) for row in rows]

    def close(self):
        """Close database connection."""
        self.locations_db.close()
        logger.info("google_news_service_closed")
