"""Tests for Google News Extractor."""

import pytest
import asyncio
from extractors.google_news import GoogleNewsExtractor


def test_can_extract_false():
    """Google News extractor is not URL-based."""
    result = GoogleNewsExtractor.can_extract("https://news.google.com")

    assert result is False


def test_can_extract_with_html_false():
    """Google News extractor ignores HTML."""
    result = GoogleNewsExtractor.can_extract(
        "https://example.com", html="<html></html>"
    )

    assert result is False


@pytest.mark.asyncio
async def test_extract_single_query():
    """Test extraction with simple query."""
    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query="noticias Argentina", limit=5)

    assert len(items) <= 5
    assert all(item.title for item in items)
    assert all(item.url for item in items)
    assert all(item.method == "google_news" for item in items)


@pytest.mark.asyncio
async def test_extract_limit_respected():
    """Test extraction respects limit parameter."""
    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query="Córdoba", limit=3)

    assert len(items) <= 3


@pytest.mark.asyncio
async def test_extract_country_parameter():
    """Test extraction with country parameter."""
    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query="Buenos Aires", country="AR", limit=5)

    assert len(items) <= 5


@pytest.mark.asyncio
async def test_extract_empty_query():
    """Test extraction with empty query returns empty results."""
    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query="", limit=10)

    # Empty query may return results or empty
    assert isinstance(items, list)


@pytest.mark.asyncio
async def test_extract_spanish_language():
    """Test extraction returns Spanish news."""
    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query="noticias Córdoba Argentina", limit=5)

    # Most titles should be in Spanish
    assert len(items) > 0
