"""Tests for Google News Service."""

import pytest
import sqlite3
import os
from services.google_news_service import GoogleNewsService


@pytest.fixture
def service():
    """Create service with test database."""
    db_path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "data", "locations.db")
    )
    service = GoogleNewsService(db_path)
    yield service
    service.close()


def test_get_location_exists(service):
    """Test retrieving existing location."""
    location = service.get_location(103)

    assert location is not None
    assert location["id"] == 103
    assert location["name"] == "Mendoza Capital"
    assert location["province"] == "Mendoza"
    assert location["type"] == "ciudad"


def test_get_location_not_found(service):
    """Test retrieving non-existent location."""
    location = service.get_location(9999)

    assert location is None


def test_build_query_ciudad(service):
    """Test query builder for ciudad type."""
    query = service.build_query(101)  # Córdoba Capital

    assert query == "noticias Córdoba Capital Córdoba"


def test_build_query_provincia(service):
    """Test query builder for provincia type."""
    query = service.build_query(3)  # Córdoba (provincia)

    assert query == "noticias Córdoba"


def test_build_query_not_found(service):
    """Test query builder raises error for invalid location."""
    with pytest.raises(ValueError, match="Location 9999 not found"):
        service.build_query(9999)


def test_get_locations_by_type(service):
    """Test retrieving all locations of a specific type."""
    locations = service.get_locations_by_type("ciudad")

    assert len(locations) > 0
    assert all(loc["type"] == "ciudad" for loc in locations)


def test_get_locations_by_type_with_province_filter(service):
    """Test retrieving locations filtered by province."""
    locations = service.get_locations_by_type("ciudad", province_filter="Buenos Aires")

    assert len(locations) > 0
    assert all(loc["province"] == "Buenos Aires" for loc in locations)
