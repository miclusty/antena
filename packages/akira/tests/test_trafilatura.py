"""Tests for the trafilatura extractor."""

import pytest
from extractors.trafilatura import TrafilaturaExtractor


def test_trafilatura_detector():
    """can_extract: should accept article URLs, reject feeds."""
    assert TrafilaturaExtractor.can_extract("https://example.com/article/123") is True
    assert TrafilaturaExtractor.can_extract("https://example.com/news/foo") is True
    # Feeds
    assert TrafilaturaExtractor.can_extract("https://example.com/rss") is False
    assert TrafilaturaExtractor.can_extract("https://example.com/feed") is False
    assert TrafilaturaExtractor.can_extract("https://example.com/sitemap.xml") is False
    # Tag/category
    assert TrafilaturaExtractor.can_extract("https://example.com/tag/foo") is False
    assert TrafilaturaExtractor.can_extract("https://example.com/category/news") is False


def test_trafilatura_priority():
    """Should sit between newspaper (70, broken) and goose (60)."""
    assert TrafilaturaExtractor.PRIORITY < 70  # after broken newspaper
    assert TrafilaturaExtractor.PRIORITY > 60  # before goose


@pytest.mark.asyncio
async def test_trafilatura_extracts_real_article():
    """Smoke test: extract from a real Argentine news site."""
    # cba24n has open articles. Use a known article URL.
    url = "https://www.cba24n.com.ar/argentina/a-los-95-anos-murio-taty-almeida--presidenta-de-madres-de-plaza-de-mayo-linea-fundadora_a6a2f3ba6f8148d8e7ba38ca8"
    items = await TrafilaturaExtractor().extract(url, timeout=20)
    if not items:
        pytest.skip("Network unavailable or article not found")
    assert len(items) == 1
    item = items[0]
    assert item.url == url
    # Body should be substantial (at least one of body or text)
    body_len = len(item.body or "")
    text_len = len(item.text or "")
    best_len = max(body_len, text_len)
    assert best_len > 200, f"body+text too short: {best_len}"
    # Summary should be non-empty
    assert len(item.summary) > 50
    # Title should be the real article title (not the site name)
    assert item.title and "cba24n" not in item.title.lower()
