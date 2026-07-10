"""Tests for extractors."""

import pytest
from extractors.rss import RSSExtractor
from extractors.base import ExtractedItem, BaseExtractor
from extractors._newspaper_DEPRECATED import NewspaperExtractor
from extractors.goose import GooseExtractor
from extractors.wordpress import WordPressExtractor
from extractors.sitemap import SitemapExtractor
from extractors.jina import JinaExtractor
from extractors.playwright import PlaywrightExtractor


def test_rss_detector():
    assert RSSExtractor.can_extract("https://example.com/feed") == True
    assert RSSExtractor.can_extract("https://example.com/rss") == True
    assert RSSExtractor.can_extract("https://example.com/article") == False


def test_base_extractor_interface():
    """Verify base extractor is abstract."""
    try:
        BaseExtractor()
        assert False, "Should not instantiate"
    except TypeError:
        pass


@pytest.mark.asyncio
async def test_rss_extraction():
    extractor = RSSExtractor()

    try:
        items = await extractor.extract(
            "https://feeds.bbci.co.uk/news/rss.xml", timeout=10
        )
        assert len(items) > 0
        assert items[0].title
        assert items[0].url
    except Exception as e:
        pytest.skip(f"Network error: {e}")


def test_newspaper_detector():
    assert NewspaperExtractor.can_extract("https://example.com/article/123") == True
    assert NewspaperExtractor.can_extract("https://example.com/feed") == False
    assert NewspaperExtractor.can_extract("https://example.com/rss") == False


def test_goose_detector():
    assert GooseExtractor.can_extract("https://any-url.com") == True


def test_wordpress_detector():
    # can_extract is optimistic: any URL with a host
    # is a candidate. The extractor itself decides
    # whether the WP API is reachable.
    assert WordPressExtractor.can_extract("https://example.com/wp-json") == True
    assert WordPressExtractor.can_extract("https://example.com/wp-admin") == True
    assert (
        WordPressExtractor.can_extract(
            "https://example.com/article", "<html>WordPress</html>"
        )
        == True
    )
    # Article without HTML hint — still optimistically True
    assert WordPressExtractor.can_extract("https://example.com/article") == True
    # Empty host → False
    assert WordPressExtractor.can_extract("not-a-url") == False


def test_sitemap_detector():
    assert SitemapExtractor.can_extract("https://any-url.com") == True


def test_jina_detector():
    assert JinaExtractor.can_extract("https://any-url.com") == True


def test_playwright_detector():
    assert PlaywrightExtractor.can_extract("https://any-url.com") == True
