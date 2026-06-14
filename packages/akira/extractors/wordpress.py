"""WordPress REST API extractor with delta extraction."""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import List, Optional
import aiohttp
import sqlite3

from core.db_helpers import filter_new_urls
from .base import BaseExtractor, ExtractedItem
from core.http_client import get_user_agent

logger = logging.getLogger(__name__)


def _get_last_harvest(db_path: str, source_url: str) -> Optional[str]:
    """Get last harvest time as ISO date for WP API ?after param."""
    try:
        with sqlite3.connect(db_path) as conn:
            row = conn.execute(
                "SELECT last_harvest_at FROM sources WHERE wp_api_url = ? OR url = ?",
                (source_url, source_url),
            ).fetchone()
        if row and row[0]:
            # Return date 1 hour before last harvest to catch edge cases
            dt = datetime.fromisoformat(row[0].replace("Z", "+00:00"))
            dt = dt - timedelta(hours=1)
            return dt.strftime("%Y-%m-%dT%H:%M:%S")
    except Exception:
        pass
    return None


class WordPressExtractor(BaseExtractor):
    """WordPress REST API extractor with delta extraction. Fastest for WP sites."""

    NAME = "wordpress"
    PRIORITY = 90

    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        if html:
            return "wp-json" in html or "WordPress" in html
        return "/wp-" in url

    async def extract(
        self,
        url: str,
        timeout: int = 30,
        db_path: Optional[str] = None,
        source_id: Optional[int] = None,
    ) -> List[ExtractedItem]:
        api_url = url.rstrip("/") + "/wp-json/wp/v2/posts"
        params = {"per_page": 20, "_embed": "true"}
        headers = {"User-Agent": get_user_agent()}
        hard_timeout = timeout * 1.5

        # Delta extraction: only fetch posts after last harvest
        if db_path:
            after_date = _get_last_harvest(db_path, url)
            if after_date:
                params["after"] = after_date
                logger.info(f"wp_delta_extraction url={url} after={after_date}")

        own_session = self._session is None
        if own_session:
            self._session = aiohttp.ClientSession()
            self._owns_session = True

        try:
            async with self._session.get(
                api_url,
                params=params,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                if resp.status != 200:
                    logger.warning("WP API returned %d for %s", resp.status, url)
                    return []
                try:
                    posts = await asyncio.wait_for(resp.json(), timeout=hard_timeout)
                except asyncio.TimeoutError:
                    logger.warning("WP JSON parse timed out for %s", url)
                    return []
                except Exception as e:
                    logger.error("WP JSON parse failed for %s: %s", url, e)
                    return []
        except asyncio.TimeoutError:
            logger.warning(
                "WP API request timed out after %.1fs: %s", hard_timeout, url
            )
            return []
        except Exception as e:
            logger.error("WP API request failed for %s: %s", url, e)
            return []
        finally:
            if self._owns_session:
                await self._session.close()
                self._session = None
                self._owns_session = False

        # Collect post URLs for batch dedup
        post_data = []
        for post in posts:
            post_url = post.get("link", "")
            if post_url:
                post_data.append((post_url, post))

        if db_path and post_data:
            all_urls = [p[0] for p in post_data]
            new_urls = set(filter_new_urls(db_path, all_urls, source_id))
        else:
            new_urls = {p[0] for p in post_data}

        items = []
        for post_url, post in post_data:
            if post_url not in new_urls:
                continue

            try:

                image_url = None
                if "_embedded" in post and "wp:featuredmedia" in post["_embedded"]:
                    media = post["_embedded"]["wp:featuredmedia"]
                    if media and len(media) > 0:
                        image_url = media[0].get("source_url")

                items.append(
                    ExtractedItem(
                        title=post.get("title", {}).get("rendered", ""),
                        url=post_url,
                        summary=post.get("excerpt", {}).get("rendered", "")[:1200],
                        published_at=post.get("date", ""),
                        image_url=image_url,
                        source=url,
                    )
                )
            except Exception as e:
                logger.warning("Failed to parse WP post: %s", e)
                continue

        return items

    def _default_timeout(self) -> int:
        return 30
