"""Tests for extractor delta extraction support (db_path, source_id params)."""

import pytest
from extractors.base import BaseExtractor, ExtractedItem
from extractors.rss import RSSExtractor
from extractors.wordpress import WordPressExtractor
from extractors.newspaper import NewspaperExtractor
from extractors.goose import GooseExtractor
from extractors.sitemap import SitemapExtractor
from extractors.playwright import PlaywrightExtractor
from extractors.jina import JinaExtractor
from extractors.video import VideoExtractor
from extractors.social import SocialExtractor
from extractors.google_news import GoogleNewsExtractor


class TestExtractorSignatures:
    """All extractors must accept db_path and source_id params."""

    @pytest.mark.parametrize(
        "extractor_class",
        [
            RSSExtractor,
            WordPressExtractor,
            NewspaperExtractor,
            GooseExtractor,
            SitemapExtractor,
            PlaywrightExtractor,
            JinaExtractor,
            VideoExtractor,
            SocialExtractor,
            GoogleNewsExtractor,
        ],
    )
    def test_accepts_db_path(self, extractor_class):
        """extract() must have db_path parameter."""
        assert "db_path" in extractor_class.extract.__code__.co_varnames, (
            f"{extractor_class.NAME} missing db_path param"
        )

    @pytest.mark.parametrize(
        "extractor_class",
        [
            RSSExtractor,
            WordPressExtractor,
            NewspaperExtractor,
            GooseExtractor,
            SitemapExtractor,
            PlaywrightExtractor,
            JinaExtractor,
            VideoExtractor,
            SocialExtractor,
            GoogleNewsExtractor,
        ],
    )
    def test_accepts_source_id(self, extractor_class):
        """extract() must have source_id parameter."""
        assert "source_id" in extractor_class.extract.__code__.co_varnames, (
            f"{extractor_class.NAME} missing source_id param"
        )


class TestBaseExtractor:
    """Base extractor class tests."""

    def test_abstract_extract_has_kwargs(self):
        """Base.extract must accept **kwargs for LSP compliance."""
        assert "kwargs" in BaseExtractor.extract.__code__.co_varnames

    def test_extracted_item_valid(self):
        """Valid item passes validation."""
        item = ExtractedItem(
            title="Test Article Title",
            url="https://example.com/article",
            summary="This is a valid summary with enough content to pass.",
        )
        assert item.is_valid() is True

    def test_extracted_item_invalid_no_title(self):
        """Item without title fails validation."""
        item = ExtractedItem(
            title="",
            url="https://example.com/article",
            summary="Summary content here",
        )
        assert item.is_valid() is False

    def test_extracted_item_invalid_no_url(self):
        """Item without URL fails validation."""
        item = ExtractedItem(
            title="Test Title",
            url="",
            summary="Summary content here",
        )
        assert item.is_valid() is False

    def test_extracted_item_invalid_short_title(self):
        """Item with too-short title fails validation."""
        item = ExtractedItem(
            title="Hi",
            url="https://example.com/article",
            summary="Summary content here",
        )
        assert item.is_valid() is False

    def test_validate_items_filters_invalid(self):
        """validate_items removes invalid items."""
        items = [
            ExtractedItem(
                title="Valid Article",
                url="https://example.com/1",
                summary="Good summary content here",
            ),
            ExtractedItem(title="", url="https://example.com/2", summary="No title"),
            ExtractedItem(
                title="Another Valid",
                url="https://example.com/3",
                summary="Another good summary content",
            ),
        ]
        valid = BaseExtractor.validate_items(items)
        assert len(valid) == 2
        assert all(i.title != "" for i in valid)

    def test_validate_items_filters_error_pages(self):
        """validate_items removes error page items."""
        items = [
            ExtractedItem(
                title="404 Error Page",
                url="https://example.com/1",
                summary="Page not found error",
            ),
            ExtractedItem(
                title="Valid Content",
                url="https://example.com/2",
                summary="Good summary content here",
            ),
        ]
        valid = BaseExtractor.validate_items(items)
        assert len(valid) == 1
        assert valid[0].title == "Valid Content"


class TestGoogleNewsExtractor:
    """GoogleNews-specific tests."""

    def test_extract_accepts_query_param(self):
        """GoogleNews extract must accept query param."""
        code = GoogleNewsExtractor.extract.__code__
        assert "query" in code.co_varnames
        assert "country" in code.co_varnames
        assert "limit" in code.co_varnames

    def test_extract_accepts_url_for_compatibility(self):
        """GoogleNews extract must accept url param for engine compatibility."""
        code = GoogleNewsExtractor.extract.__code__
        assert "url" in code.co_varnames
