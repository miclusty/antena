"""WordPress REST API extractor with delta extraction."""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, List, Optional
import aiohttp

from db.dedup import filter_new_urls
from db.connection import get_db_connection
from .base import BaseExtractor, ExtractedItem
from core.http_client import get_user_agent

logger = logging.getLogger(__name__)


def _get_last_harvest(db_path: str, source_url: str) -> Optional[str]:
    """Get last harvest time as ISO date for WP API ?after param."""
    try:
        with get_db_connection(db_path) as conn:
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
        # The WP API sits on every WordPress site at
        # /wp-json/wp/v2/posts — try it whenever the
        # URL points to a host (any path) and we're not
        # already looking at a non-WordPress feed. The
        # extractor itself decides what to do when the
        # API isn't reachable.
        if "wp-json" in url:
            return True
        from urllib.parse import urlparse
        try:
            host = urlparse(url).netloc
        except Exception:
            return False
        if not host:
            return False
        # Don't try WP for paths that are clearly RSS/Atom
        path = (urlparse(url).path or "").lower()
        if path.endswith((".rss", ".xml", "/rss", "/feed", "/atom")):
            # The extractor derives the right base URL by
            # stripping the feed suffix, so it can still
            # try the WP API on the host root.
            return True
        return True  # optimistic: try WP whenever we have a host

    async def extract(
        self,
        url: str,
        timeout: int = 30,
        db_path: Optional[str] = None,
        source_id: Optional[int] = None,
        **kwargs: object,
    ) -> List[ExtractedItem]:
        # If the URL points at a feed (RSS/Atom), the WP
        # API is on the host's root, not on the feed path.
        # Reconstruct the site origin by stripping the
        # feed suffix. Falls back to the URL as-is when
        # the URL already looks like a wp-json path.
        from urllib.parse import urlparse
        parsed = urlparse(url)
        path = parsed.path or ""
        feed_suffixes = (
            "/rss", "/rss/", "/feed", "/feed/", "/atom.xml",
            "/wp-rss.php", "/index.rss",
        )
        if any(path.endswith(s) for s in feed_suffixes) or path.endswith(".xml"):
            origin = f"{parsed.scheme}://{parsed.netloc}"
            api_url = origin + "/wp-json/wp/v2/posts"
        elif "wp-json" in path:
            api_url = url
        else:
            # URL doesn't end in a feed suffix. Assume
            # the WP API sits at the path's root.
            base_path = "/".join(p for p in path.split("/") if p and "rss" not in p.lower() and "feed" not in p.lower())
            base_path = ("/" + base_path) if base_path else ""
            api_url = f"{parsed.scheme}://{parsed.netloc}{base_path}/wp-json/wp/v2/posts"
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
        session: Any = self._session
        assert session is not None  # nosec — just-narrowed

        try:
            async with session.get(
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
                await session.close()
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
