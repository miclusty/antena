"""Sitemap.xml parser to find recent article URLs."""

import asyncio
import logging
from typing import Any, List, Optional
import aiohttp
import xml.etree.ElementTree as ET
from .base import BaseExtractor, ExtractedItem
from core.http_client import get_user_agent

logger = logging.getLogger("akira.extractors")


class SitemapExtractor(BaseExtractor):
    """Sitemap.xml parser. Returns URLs for further processing."""

    NAME = "sitemap"
    PRIORITY = 50

    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        return True

    async def extract(
        self,
        url: str,
        timeout: int = 15,
        db_path: Optional[str] = None,
        source_id: Optional[int] = None,
        **kwargs: object,
    ) -> List[ExtractedItem]:
        base_url = url.rstrip("/")
        sitemap_paths = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"]
        headers = {"User-Agent": get_user_agent()}

        own_session = self._session is None
        if own_session:
            self._session = aiohttp.ClientSession()
            self._owns_session = True
        session: Any = self._session
        assert session is not None  # nosec — just-narrowed

        try:
            for path in sitemap_paths:
                try:
                    sitemap_url = base_url + path
                    resp = await asyncio.wait_for(
                        session.get(
                            sitemap_url,
                            headers=headers,
                            timeout=aiohttp.ClientTimeout(total=timeout),
                        ),
                        timeout=timeout * 1.5,
                    )
                    async with resp:
                        if resp.status != 200:
                            continue

                        content = await asyncio.wait_for(
                            resp.text(), timeout=timeout * 1.5
                        )
                        root = ET.fromstring(content)
                        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

                        items = []
                        for url_elem in root.findall(".//sm:url", ns)[:20]:
                            try:
                                loc = url_elem.find("sm:loc", ns)
                                lastmod = url_elem.find("sm:lastmod", ns)

                                if loc is not None:
                                    loc_text: str = loc.text or ""
                                    title = (
                                        loc_text.split("/")[-1]
                                        .replace("-", " ")
                                        .replace(".html", "")
                                    )
                                    items.append(
                                        ExtractedItem(
                                            title=title.title(),
                                            url=loc_text,
                                            summary=f"URL discovered via sitemap: {loc.text}",
                                            published_at=lastmod.text
                                            if lastmod is not None
                                            else None,
                                            source=url,
                                        )
                                    )
                            except Exception as e:
                                logger.warning("Failed to parse sitemap entry: %s", e)
                                continue

                        if items:
                            return items
                except asyncio.TimeoutError:
                    logger.warning("Sitemap request timed out: %s", sitemap_url)
                    continue
                except ET.ParseError as e:
                    logger.warning("Sitemap XML parse error for %s: %s", sitemap_url, e)
                    continue
                except Exception as e:
                    logger.warning("Sitemap fetch failed for %s: %s", sitemap_url, e)
                    continue
        finally:
            if self._owns_session:
                await session.close()
                self._session = None
                self._owns_session = False

        return []

    def _default_timeout(self) -> int:
        return 15
