"""Google News Extractor - RSS-based extraction with location-aware queries."""

import asyncio
import logging
import urllib.parse
from typing import List, Optional

from extractors.base import BaseExtractor, ExtractedItem

logger = logging.getLogger("akira.extractors")


class GoogleNewsExtractor(BaseExtractor):
    """
    Google News RSS extractor.

    Not URL-based - uses search queries to find news.
    Query format: "noticias {location} {province}"

    Example:
        query = "noticias Córdoba Capital Córdoba"
        → extracts from Google News RSS search
    """

    NAME = "google_news"
    PRIORITY = 90  # Fallback after RSS (100) and WordPress (90)

    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        """
        Google News extractor is query-based, not URL-based.

        Always returns False - this extractor is invoked explicitly
        via /extract/google-news endpoint, not in cascade.
        """
        return False

    async def extract(
        self,
        url: str = "",
        timeout: int = 30,
        db_path: Optional[str] = None,
        source_id: Optional[int] = None,
        query: str = "",
        country: str = "AR",
        limit: int = 10,
    ) -> List[ExtractedItem]:
        """
        Extract news from Google News RSS search.

        Args:
            url: Ignored (kept for API compatibility)
            query: Search query (e.g., "noticias Córdoba")
            country: Country code (default AR for Argentina)
            limit: Max items to return
        """
        import feedparser

        # Build Google News RSS URL
        encoded_query = urllib.parse.quote(query)
        rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=es&gl={country}&ceid=AR:es"

        logger.info(f"google_news_extract query={query} url={rss_url}")

        # Parse RSS (synchronous, run in executor)
        loop = asyncio.get_running_loop()
        feed = await loop.run_in_executor(None, feedparser.parse, rss_url)

        items = []
        for entry in feed.entries[:limit]:
            # Extract source from entry
            source_title = ""
            if hasattr(entry, "source") and hasattr(entry.source, "title"):
                source_title = entry.source.title

            # Add method field to track extraction method
            item = ExtractedItem(
                title=entry.get("title", ""),
                url=entry.get("link", ""),
                summary=entry.get("summary", "")[:300],
                published_at=entry.get("published", ""),
                source=source_title,
                image_url=None,
                method=self.NAME,
            )
            items.append(item)

        logger.info(f"google_news_extracted query={query} items={len(items)}")

        return items
