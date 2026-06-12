"""Fallback article extractor using goose3."""

import asyncio
import logging
from typing import List, Optional
from .base import BaseExtractor, ExtractedItem

logger = logging.getLogger("akira.extractors")

# NOTE: module-level singleton, refactor to app state or class attribute
_goose_instance = None


def _get_goose():
    global _goose_instance
    if _goose_instance is None:
        from goose3 import Goose

        _goose_instance = Goose()
    return _goose_instance


class GooseExtractor(BaseExtractor):
    """Fallback article extractor using goose3."""

    NAME = "goose"
    PRIORITY = 60

    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        return True

    async def extract(
        self,
        url: str,
        timeout: int = 60,
        db_path: Optional[str] = None,
        source_id: Optional[int] = None,
    ) -> List[ExtractedItem]:
        hard_timeout = timeout * 1.5
        loop = asyncio.get_running_loop()

        def _extract():
            g = _get_goose()
            return g.extract(url=url)

        try:
            article = await asyncio.wait_for(
                loop.run_in_executor(None, _extract), timeout=hard_timeout
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Goose extraction timed out after %.1fs: %s", hard_timeout, url
            )
            return []
        except Exception as e:
            logger.error("Goose extraction failed for %s: %s", url, e)
            return []

        if not article.title or len(article.cleaned_text or "") < 50:
            logger.warning("Goose extraction yielded no content for %s", url)
            return []

        try:
            return [
                ExtractedItem(
                    title=article.title or "",
                    url=url,
                    summary=(article.meta_description or "")[:500],
                    published_at=article.publish_date.isoformat()
                    if article.publish_date
                    else None,
                    image_url=getattr(article.top_image, "src", None)
                    if article.top_image
                    else None,
                    source=url,
                    text=(article.cleaned_text or "")[:3000],
                )
            ]
        except Exception as e:
            logger.error("Failed to build Goose ExtractedItem for %s: %s", url, e)
            return []

    def _default_timeout(self) -> int:
        return 60
