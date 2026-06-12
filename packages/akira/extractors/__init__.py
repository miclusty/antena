"""AKIRA Extractors — all extraction methods."""

from .base import BaseExtractor, ExtractedItem
from .rss import RSSExtractor
from .wordpress import WordPressExtractor
from .newspaper import NewspaperExtractor
from .goose import GooseExtractor
from .sitemap import SitemapExtractor
from .playwright import PlaywrightExtractor
from .jina import JinaExtractor
from .video import VideoExtractor
from .social import SocialExtractor
from .google_news import GoogleNewsExtractor

__all__ = [
    "BaseExtractor",
    "ExtractedItem",
    "RSSExtractor",
    "WordPressExtractor",
    "NewspaperExtractor",
    "GooseExtractor",
    "SitemapExtractor",
    "PlaywrightExtractor",
    "JinaExtractor",
    "VideoExtractor",
    "SocialExtractor",
    "GoogleNewsExtractor",
]
