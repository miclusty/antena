"""Jina Reader API extractor - last resort for difficult sites."""

import logging
from typing import List, Optional
import aiohttp
from .base import BaseExtractor, ExtractedItem
from core.http_client import get_user_agent

logger = logging.getLogger("akira.extractors")


class JinaExtractor(BaseExtractor):
    """Jina Reader API - uses r.jina.ai service."""

    NAME = "jina"
    PRIORITY = 10  # Lowest priority, last resort

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
        jina_url = f"https://r.jina.ai/{url}"
        headers = {
            "Accept": "application/json",
            "X-Return-Format": "json",
            "User-Agent": get_user_agent(),
        }

        own_session = self._session is None
        if own_session:
            self._session = aiohttp.ClientSession()
            self._owns_session = True

        data = None
        try:
            async with self._session.get(
                jina_url, headers=headers, timeout=aiohttp.ClientTimeout(total=timeout)
            ) as resp:
                resp.raise_for_status()
                data = await resp.json()
        except aiohttp.ClientResponseError as e:
            logger.warning("Jina API returned %d for %s", e.status, url)
            return []
        except Exception as e:
            logger.error("Jina extraction failed for %s: %s", url, e)
            return []
        finally:
            if self._owns_session:
                await self._session.close()
                self._session = None
                self._owns_session = False

        # Safe navigation - handle malformed responses
        data_obj = data.get("data") if isinstance(data, dict) else None
        content = data_obj.get("content", "") if isinstance(data_obj, dict) else ""

        if not content:
            logger.warning("Jina returned empty content for %s", url)
            return []

        title = data_obj.get("title", "") if isinstance(data_obj, dict) else ""
        if not title:
            title = url.split("/")[-1].replace("-", " ").replace(".html", "").title()

        return [
            ExtractedItem(
                title=title,
                url=url,
                summary=content[:3000],
                source=url,
                text=content[:3000],
            )
        ]

    def _default_timeout(self) -> int:
        return 60
