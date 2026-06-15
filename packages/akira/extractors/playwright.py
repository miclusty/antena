"""Playwright-based extractor for JS-heavy sites with browser pooling."""

import asyncio
import logging
from typing import List, Optional
from .base import BaseExtractor, ExtractedItem

logger = logging.getLogger("akira.extractors")


class PlaywrightExtractor(BaseExtractor):
    """Playwright headless browser extractor for JS-rendered sites.

    Uses a shared browser pool when available to avoid launching a new browser
    per extraction, which is expensive.
    """

    NAME = "playwright"
    PRIORITY = 30

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
        title = ""
        content = ""
        image_url = None
        browser = None
        page = None

        use_pool = self._browser_pool is not None

        try:
            if use_pool:
                # self._browser_pool.acquire() is async and
                # returns a _BrowserContext (an async context
                # manager). Await it first to get the context
                # manager, then use it.
                ctx = await self._browser_pool.acquire()
                async with ctx as browser:
                    if browser is None:
                        # Pool couldn't give us a browser
                        return []
                    page = await browser.new_page()
                    page.set_default_timeout(timeout * 1000)
                    await page.goto(url, wait_until="domcontentloaded")
                    title, content, image_url = await self._extract_content(
                        page, hard_timeout
                    )
            else:
                from playwright.async_api import async_playwright

                p = await asyncio.wait_for(
                    async_playwright().start(), timeout=hard_timeout
                )
                browser = await asyncio.wait_for(
                    p.chromium.launch(headless=True), timeout=hard_timeout
                )
                page = await asyncio.wait_for(browser.new_page(), timeout=hard_timeout)
                page.set_default_timeout(timeout * 1000)

                await asyncio.wait_for(
                    page.goto(url, wait_until="domcontentloaded"),
                    timeout=timeout * 1000,
                )
                title, content, image_url = await self._extract_content(
                    page, hard_timeout
                )

        except asyncio.TimeoutError:
            logger.warning("Playwright timed out after %.1fs: %s", hard_timeout, url)
            return []
        except Exception as e:
            logger.error("Playwright extraction failed for %s: %s", url, e)
            return []
        finally:
            if page:
                try:
                    await page.close()
                except Exception:
                    pass
            # Only close browser if we launched it ourselves (not from pool)
            if browser and not use_pool:
                try:
                    await asyncio.wait_for(browser.close(), timeout=10)
                except Exception as e:
                    logger.warning("Failed to close browser: %s", e)

        if not content:
            logger.warning("Playwright extracted no content for %s", url)
            return []

        if not title or len(title.strip()) < 3:
            title = url.split("/")[-1].replace("-", " ").replace(".html", "").title()

        return [
            ExtractedItem(
                title=title,
                url=url,
                summary=content[:3000],
                source=url,
                text=content[:3000],
                image_url=image_url,
            )
        ]

    async def _extract_content(self, page, hard_timeout: float) -> tuple:
        """Extract title, content, and image from a Playwright page."""
        title = ""
        content = ""
        image_url = None

        try:
            title = await asyncio.wait_for(page.title(), timeout=hard_timeout)
        except Exception as e:
            logger.warning("Failed to get page title: %s", e)

        for selector in [
            "article",
            ".article-content",
            ".post-content",
            "main",
            ".content",
        ]:
            try:
                element = await asyncio.wait_for(
                    page.query_selector(selector), timeout=hard_timeout
                )
                if element:
                    content = await asyncio.wait_for(
                        element.inner_text(), timeout=hard_timeout
                    )
                    if len(content) > 200:
                        break
            except Exception as e:
                logger.warning("Selector %s failed: %s", selector, e)
                continue

        if not content:
            try:
                content = await asyncio.wait_for(
                    page.inner_text("body"), timeout=hard_timeout
                )
            except Exception as e:
                logger.warning("Failed to get body text: %s", e)

        try:
            img = await asyncio.wait_for(
                page.query_selector("article img, .featured-image img, main img"),
                timeout=hard_timeout,
            )
            if img:
                image_url = await asyncio.wait_for(
                    img.get_attribute("src"), timeout=hard_timeout
                )
        except Exception as e:
            logger.warning("Failed to extract image: %s", e)

        return title, content, image_url

    def _default_timeout(self) -> int:
        return 60
