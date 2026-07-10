"""Social media extractor - X (Twitter), TikTok, Instagram via oEmbed."""

import logging
from typing import Any, List, Optional
import aiohttp
from .base import BaseExtractor, ExtractedItem
from core.http_client import get_user_agent

logger = logging.getLogger("akira.extractors")


class SocialExtractor(BaseExtractor):
    """Extract embed data from X (Twitter), TikTok, and Instagram via oEmbed."""

    NAME = "social"
    PRIORITY = 35

    X_DOMAINS = ("x.com", "twitter.com", "www.x.com", "www.twitter.com")
    TIKTOK_DOMAINS = ("tiktok.com", "www.tiktok.com")
    INSTAGRAM_DOMAINS = ("instagram.com", "www.instagram.com")

    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        url_lower = url.lower()
        all_domains = cls.X_DOMAINS + cls.TIKTOK_DOMAINS + cls.INSTAGRAM_DOMAINS
        return any(d in url_lower for d in all_domains)

    async def extract(
        self,
        url: str,
        timeout: int = 30,
        db_path: Optional[str] = None,
        source_id: Optional[int] = None,
        **kwargs: object,
    ) -> List[ExtractedItem]:
        oembed_url = self._build_oembed_url(url)
        if not oembed_url:
            logger.warning("Unsupported social media URL: %s", url)
            return []

        headers = {"User-Agent": get_user_agent()}
        if any(d in url.lower() for d in self.INSTAGRAM_DOMAINS):
            headers["Accept"] = "application/json"

        own_session = self._session is None
        if own_session:
            self._session = aiohttp.ClientSession()
        session: Any = self._session
        assert session is not None  # nosec — just-narrowed

        try:
            async with session.get(
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
                await session.close()
                self._session = None

        if not isinstance(data, dict):
            logger.warning("Invalid oEmbed response format for %s", url)
            return []

        if "error" in data:
            logger.warning("oEmbed error for %s: %s", url, data["error"])
            return []

        item = ExtractedItem(
            title=data.get("title", "") or f"Post by {data.get('author_name', '')}",
            url=url,
            summary=data.get("author_name", "") or self._detect_source(url),
            published_at=data.get("created_at") or data.get("upload_date"),
            image_url=data.get("thumbnail_url"),
            source=data.get("author_name", "") or self._detect_source(url),
            text=data.get("html", ""),
        )

        return [item]

    def _build_oembed_url(self, url: str) -> Optional[str]:
        url_lower = url.lower()
        if any(d in url_lower for d in self.X_DOMAINS):
            return f"https://publish.twitter.com/oembed?url={url}"
        if any(d in url_lower for d in self.TIKTOK_DOMAINS):
            return f"https://www.tiktok.com/oembed?url={url}"
        if any(d in url_lower for d in self.INSTAGRAM_DOMAINS):
            return f"https://graph.facebook.com/v18.0/instagram_oembed?url={url}"
        return None

    def _detect_source(self, url: str) -> str:
        url_lower = url.lower()
        if any(d in url_lower for d in self.X_DOMAINS):
            return "X"
        if any(d in url_lower for d in self.TIKTOK_DOMAINS):
            return "TikTok"
        if any(d in url_lower for d in self.INSTAGRAM_DOMAINS):
            return "Instagram"
        return url

    def _default_timeout(self) -> int:
        return 30
