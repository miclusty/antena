"""Trafilatura-based article extractor.

Trafilatura is a well-maintained (6.1k stars, latest
release Jun 2026) Python library for web article
extraction. It uses heuristics + ML to identify the
main content of a page and strip boilerplate (nav,
footer, ads, sidebar, etc).

Why we use it instead of newspaper4k:
- newspaper4k 0.9.4.1 (installed in our venv) is broken —
  it imports `CACHE_DIRECTORY` from newspaper.settings
  but the module exports `CF_CACHE_DIRECTORY`.
- trafilatura is actively maintained, no API keys
  needed, and handles Spanish-language articles
  well (trained on multilingual web content).
- Output is clean text + metadata in one call,
  3-7x more content than the RSS <description> alone.

The extractor expects a URL pointing to an article
(not a feed) and returns the extracted text + a
generated summary.
"""

import asyncio
import logging
from typing import List, Optional

import trafilatura
from .base import BaseExtractor, ExtractedItem

logger = logging.getLogger("akira.extractors")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


class TrafilaturaExtractor(BaseExtractor):
    """Article body extractor using trafilatura."""

    NAME = "trafilatura"
    PRIORITY = 65  # between newspaper (70, broken) and goose (60)

    @classmethod
    def can_extract(cls, url: str, html: Optional[str] = None) -> bool:
        # Same skip rules as newspaper. We don't want to
        # run this on feeds/aggregator pages.
        skip_patterns = ["/feed", "/rss", ".xml", "/tag/", "/category/"]
        return not any(pattern in url.lower() for pattern in skip_patterns)

    async def extract(
        self,
        url: str,
        timeout: int = 30,
        db_path: Optional[str] = None,
        source_id: Optional[int] = None,
    ) -> List[ExtractedItem]:
        loop = asyncio.get_running_loop()

        def _fetch_and_extract():
            # trafilatura.fetch_url is sync; it does the
            # HTTP fetch + parse in one call. We could
            # use aiohttp for the fetch and trafilatura
            # for the parse, but trafilatura's built-in
            # fetcher is fine and has a sane User-Agent.
            html = trafilatura.fetch_url(url)
            if not html:
                return None
            return trafilatura.extract(
                html,
                output_format="json",
                include_comments=False,
                include_tables=False,
                favor_precision=False,  # bias toward recall — get more text
                with_metadata=True,
            )

        hard_timeout = timeout * 1.5
        try:
            raw = await asyncio.wait_for(
                loop.run_in_executor(None, _fetch_and_extract),
                timeout=hard_timeout,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Trafilatura extraction timed out after %.1fs: %s", hard_timeout, url
            )
            return []
        except Exception as e:
            logger.error("Trafilatura extraction failed for %s: %s", url, e)
            return []

        if not raw:
            return []

        import json as _json
        try:
            data = _json.loads(raw)
        except Exception:
            logger.error("Trafilatura returned non-JSON output for %s", url)
            return []

        title = data.get("title") or ""
        text = data.get("text") or ""
        description = data.get("description") or ""
        author = data.get("author") or ""
        date = data.get("date") or ""
        sitename = data.get("sitename") or ""

        if not text or len(text.strip()) < 200:
            logger.warning(
                "Trafilatura yielded %d chars for %s — below threshold",
                len(text), url,
            )
            return []

        # Use description as the short summary (what the
        # feed card shows) and the full text as body.
        # Trafilatura's description is usually the
        # lede/subtitle, which is exactly what a feed
        # card needs.
        summary = description[:1200] if description else text[:600]

        return [
            ExtractedItem(
                title=title,
                url=url,
                summary=summary,
                body=text[:8000],
                published_at=date or None,
                image_url=None,  # trafilatura doesn't extract images
                source=url,
                text=text[:3000],
                method=self.NAME,
                author=author,
            )
        ]

    def _default_timeout(self) -> int:
        return 30
