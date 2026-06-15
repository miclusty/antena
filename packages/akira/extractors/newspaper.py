"""Article extractor using newspaper4k."""

import asyncio
import logging
from typing import List, Optional
from .base import BaseExtractor, ExtractedItem

logger = logging.getLogger("akira.extractors")


class NewspaperExtractor(BaseExtractor):
    """Article extractor using newspaper4k. Best for full article content."""

    NAME = "newspaper"
    PRIORITY = 70

    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        skip_patterns = ["/feed", "/rss", ".xml", "/tag/", "/category/"]
        return not any(pattern in url.lower() for pattern in skip_patterns)

    async def extract(
        self,
        url: str,
        timeout: int = 60,
        db_path: Optional[str] = None,
        source_id: Optional[int] = None,
    ) -> List[ExtractedItem]:
        from newspaper import Article as NewspaperArticle

        hard_timeout = timeout * 1.5
        loop = asyncio.get_running_loop()

        def _extract():
            article = NewspaperArticle(url, language="es")
            article.download()
            article.parse()
            return article

        try:
            article = await asyncio.wait_for(
                loop.run_in_executor(None, _extract), timeout=hard_timeout
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Newspaper extraction timed out after %.1fs: %s", hard_timeout, url
            )
            return []
        except Exception as e:
            logger.error("Newspaper extraction failed for %s: %s", url, e)
            return []

        if not article.title or len(article.text or "") < 50:
            logger.warning("Newspaper extraction yielded no content for %s", url)
            return []

        try:
            return [
                ExtractedItem(
                    title=article.title or "",
                    url=url,
                    summary=(article.summary or "")[:1200],
                    published_at=article.publish_date.isoformat()
                    if article.publish_date
                    else None,
                    image_url=article.top_image,
                    source=url,
                    text=article.text[:3000] if article.text else None,
                    body=article.text[:8000] if article.text else None,
                )
            ]
        except Exception as e:
            logger.error("Failed to build Newspaper ExtractedItem for %s: %s", url, e)
            return []

    def _default_timeout(self) -> int:
        return 60
