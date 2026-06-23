"""RSS/Atom feed extractor with auto-discovery and persistent incremental fetching."""

import asyncio
import calendar
import logging
import re
import time
from datetime import datetime
from typing import List, Optional
from urllib.parse import urljoin


from db.dedup import filter_new_urls
from db.connection import get_db_connection

import feedparser
import aiohttp

from .base import BaseExtractor, ExtractedItem
from core.http_client import get_user_agent

logger = logging.getLogger("akira.extractors")

# NOTE: module-level cache, refactor to app state or class attribute
_last_fetch: dict[str, float] = {}


def _get_last_harvest(db_path: str, feed_url: str) -> float:
    """Get last harvest time from DB (persistent across restarts)."""
    try:
        with get_db_connection(db_path) as conn:
            row = conn.execute(
                "SELECT last_harvest_at FROM sources WHERE rss_url = ? OR url = ?",
                (feed_url, feed_url),
            ).fetchone()
        if row and row[0]:
            dt = datetime.fromisoformat(row[0].replace("Z", "+00:00"))
            return dt.timestamp()
    except Exception:
        pass
    return _last_fetch.get(feed_url, 0)





class RSSExtractor(BaseExtractor):
    """RSS/Atom feed extractor with auto-discovery and persistent incremental fetching."""

    NAME = "rss"
    PRIORITY = 100

    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        rss_patterns = ["/feed", "/rss", ".xml", "feedburner"]
        if any(pattern in url.lower() for pattern in rss_patterns):
            return True
        if html:
            return (
                'type="application/rss+xml"' in html
                or 'type="application/atom+xml"' in html
            )
        return False

    async def extract(
        self,
        url: str,
        timeout: int = 30,
        db_path: Optional[str] = None,
        source_id: Optional[int] = None,
    ) -> List[ExtractedItem]:
        hard_timeout = timeout * 1.5
        loop = asyncio.get_running_loop()

        # Try auto-discovery if URL is not a feed
        feed_url = url
        if not any(p in url.lower() for p in ["/feed", "/rss", ".xml", "feedburner"]):
            discovered = await self._discover_feed(url, timeout)
            if discovered:
                feed_url = discovered
                logger.info(f"rss_auto_discovered url={url} feed={discovered}")

        try:
            feed = await asyncio.wait_for(
                loop.run_in_executor(None, feedparser.parse, feed_url),
                timeout=hard_timeout,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "RSS extraction timed out after %.1fs: %s", hard_timeout, url
            )
            return []
        except Exception as e:
            logger.error("RSS extraction failed for %s: %s", url, e)
            return []

        if feed.bozo and not feed.entries:
            logger.warning("Invalid RSS feed at %s: %s", url, feed.bozo_exception)
            return []

        # Persistent incremental filtering
        last_harvest = (
            _get_last_harvest(db_path, feed_url)
            if db_path
            else _last_fetch.get(feed_url, 0)
        )
        current_time = time.time()
        _last_fetch[feed_url] = current_time

        items = []
        new_count = 0

        # Collect entry data: (url, entry) mapping
        entry_data = []
        for entry in feed.entries[:20]:
            entry_url = entry.get("link", "")
            if not entry_url:
                continue
            entry_data.append((entry_url, entry))

        # Batch DB dedup: filter out already-seen URLs
        if db_path and entry_data:
            all_urls = [e[0] for e in entry_data]
            new_urls = set(filter_new_urls(db_path, all_urls, source_id))
        else:
            new_urls = {e[0] for e in entry_data}

        for entry_url, entry in entry_data:
            if entry_url not in new_urls:
                continue

            try:
                # Time-based incremental filtering
                entry_time = self._parse_entry_time(entry)
                if entry_time and last_harvest > 0 and entry_time <= last_harvest:
                    continue

                new_count += 1

                image_url = None
                if hasattr(entry, "media_content"):
                    for media in entry.media_content:
                        if "image" in media.get("type", ""):
                            image_url = media.get("url")
                            break

                if not image_url and hasattr(entry, "enclosures"):
                    for enc in entry.enclosures:
                        if enc.get("type", "").startswith("image/"):
                            image_url = enc.get("href")
                            break

                # Prefer content:encoded (the full article
                # body in many WordPress/Medium feeds) over
                # <description> (which is just the teaser).
                # The previous code only read `summary`, which
                # capped cards at ~200-400 chars of plain text
                # even when the feed had the full article.
                body_html = (
                    entry.get("content", [{}])[0].get("value", "")
                    if entry.get("content")
                    else ""
                )
                teaser_html = entry.get("summary", "")
                # If content:encoded is meaningfully longer
                # than the teaser, use it as the body and let
                # the teaser stand as the summary. Otherwise
                # the body is just a duplicate of the summary.
                body = body_html if len(body_html) > len(teaser_html) * 1.5 else ""
                # summary = the longest available text,
                # truncated to 1200 chars. Most feeds use
                # HTML in this field; we don't strip here
                # because the API layer (sanitizeCard) does
                # that at delivery time.
                summary = body_html if len(body_html) > len(teaser_html) else teaser_html
                summary = summary[:3000]

                items.append(
                    ExtractedItem(
                        title=entry.get("title", ""),
                        url=entry_url,
                        summary=summary,
                        body=body[:8000] if body else None,
                        published_at=entry.get("published", ""),
                        image_url=image_url,
                        source=url,
                    )
                )
            except Exception as e:
                logger.warning("Failed to parse RSS entry: %s", e)
                continue

        if last_harvest > 0:
            logger.info(
                f"rss_incremental url={url} total={len(feed.entries)} "
                f"new={new_count} filtered={len(feed.entries) - new_count}"
            )

        return items

    async def _discover_feed(self, url: str, timeout: int) -> Optional[str]:
        """Discover RSS feed URL from HTML page."""
        own_session = self._session is None
        if own_session:
            self._session = aiohttp.ClientSession()
            self._owns_session = True

        headers = {"User-Agent": get_user_agent()}

        try:
            async with self._session.get(
                url, headers=headers, timeout=aiohttp.ClientTimeout(total=timeout)
            ) as resp:
                if resp.status != 200:
                    return None
                html = await resp.text()

            # Look for RSS/Atom link tags
            patterns = [
                r'<link[^>]+type=["\']application/rss\+xml["\'][^>]+href=["\']([^"\']+)["\']',
                r'<link[^>]+href=["\']([^"\']+)["\'][^>]+type=["\']application/rss\+xml["\']',
                r'<link[^>]+type=["\']application/atom\+xml["\'][^>]+href=["\']([^"\']+)["\']',
                r'<link[^>]+href=["\']([^"\']+)["\'][^>]+type=["\']application/atom\+xml["\']',
            ]

            for pattern in patterns:
                match = re.search(pattern, html)
                if match:
                    feed_url = match.group(1)
                    if not feed_url.startswith("http"):
                        feed_url = urljoin(url, feed_url)
                    return feed_url

            # Fallback: try common feed paths
            base = url.rstrip("/")
            for path in ["/feed", "/rss", "/feed/", "/rss.xml", "/index.xml"]:
                feed_url = urljoin(base, path)
                async with self._session.get(
                    feed_url,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=5),
                ) as feed_resp:
                    if feed_resp.status == 200:
                        content_type = feed_resp.headers.get("Content-Type", "")
                        if "xml" in content_type or "rss" in content_type:
                            return feed_url

        except Exception as e:
            logger.debug(f"rss_discovery_failed url={url} error={e}")

        finally:
            if own_session:
                await self._session.close()
                self._session = None
                self._owns_session = False

        return None

    def _parse_entry_time(self, entry) -> Optional[float]:
        """Parse entry published time to timestamp."""
        try:
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                return calendar.timegm(entry.published_parsed)
            if hasattr(entry, "updated_parsed") and entry.updated_parsed:
                return calendar.timegm(entry.updated_parsed)
        except Exception:
            pass
        return None

    def _default_timeout(self) -> int:
        return 30
