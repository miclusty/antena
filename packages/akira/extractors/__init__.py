"""AKIRA Extractors — all extraction methods."""

from .base import BaseExtractor, ExtractedItem
from .rss import RSSExtractor
from .wordpress import WordPressExtractor
from .goose import GooseExtractor
from .sitemap import SitemapExtractor
from .playwright import PlaywrightExtractor
from .jina import JinaExtractor
from .video import VideoExtractor
from .social import SocialExtractor
from .google_news import GoogleNewsExtractor
from .trafilatura import TrafilaturaExtractor

# NewspaperExtractor (newspaper4k) is intentionally NOT exported — its
# import path is broken in our venv. The deprecated module still ships
# at extractors/_newspaper_DEPRECATED.py for archeology; do NOT import it.

__all__ = [
    "BaseExtractor",
    "ExtractedItem",
    "RSSExtractor",
    "WordPressExtractor",
    "TrafilaturaExtractor",
    "GooseExtractor",
    "SitemapExtractor",
    "PlaywrightExtractor",
    "JinaExtractor",
    "VideoExtractor",
    "SocialExtractor",
    "GoogleNewsExtractor",
]  # type: ignore[no-any-return]  # NewspaperExtractor deprecated → see _newspaper_DEPRECATED.py
