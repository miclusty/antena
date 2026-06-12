"""YouTube and Vimeo video extractor using oEmbed API."""

import logging
from typing import List, Optional
import aiohttp
from .base import BaseExtractor, ExtractedItem
from core.http_client import get_user_agent

logger = logging.getLogger("akira.extractors")


class VideoExtractor(BaseExtractor):
    """Extract video metadata from YouTube and Vimeo via oEmbed."""

    NAME = "video"
    PRIORITY = 40

    YOUTUBE_DOMAINS = ("youtube.com", "youtu.be", "www.youtube.com")
    VIMEO_DOMAINS = ("vimeo.com", "www.vimeo.com")

    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        url_lower = url.lower()
        return any(d in url_lower for d in cls.YOUTUBE_DOMAINS + cls.VIMEO_DOMAINS)

    async def extract(
        self,
        url: str,
        timeout: int = 30,
        db_path: Optional[str] = None,
        source_id: Optional[int] = None,
    ) -> List[ExtractedItem]:
        oembed_url = self._build_oembed_url(url)
        if not oembed_url:
            logger.warning("Unsupported video URL: %s", url)
            return []

        headers = {"User-Agent": get_user_agent()}

        own_session = self._session is None
        if own_session:
            self._session = aiohttp.ClientSession()

        try:
            async with self._session.get(
                oembed_url,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                resp.raise_for_status()
                data = await resp.json()
        except aiohttp.ClientError as e:
            logger.warning("Failed to fetch oEmbed data for %s: %s", url, e)
            return []
        finally:
            if own_session:
                await self._session.close()
                self._session = None

        if not isinstance(data, dict):
            logger.warning("Invalid oEmbed response format for %s", url)
            return []

        if "error" in data:
            logger.warning("oEmbed error for %s: %s", url, data["error"])
            return []

        item = ExtractedItem(
            title=data.get("title", ""),
            url=url,
            summary=data.get("description", "")[:500] or data.get("title", ""),
            published_at=data.get("upload_date"),
            image_url=data.get("thumbnail_url"),
            source=data.get("author_name", "") or self._detect_source(url),
            text=data.get("html", ""),
        )

        return [item]

    def _build_oembed_url(self, url: str) -> Optional[str]:
        url_lower = url.lower()
        if any(d in url_lower for d in self.YOUTUBE_DOMAINS):
            return f"https://www.youtube.com/oembed?url={url}&format=json"
        if any(d in url_lower for d in self.VIMEO_DOMAINS):
            return f"https://vimeo.com/api/oembed.json?url={url}"
        return None

    def _detect_source(self, url: str) -> str:
        url_lower = url.lower()
        if any(d in url_lower for d in self.YOUTUBE_DOMAINS):
            return "YouTube"
        if any(d in url_lower for d in self.VIMEO_DOMAINS):
            return "Vimeo"
        return url

    def _default_timeout(self) -> int:
        return 30
