"""Shared Playwright browser pool to avoid launching a new browser per extraction."""

import asyncio
import logging
import time
from typing import Optional

logger = logging.getLogger("akira")

# Max browsers to keep in pool
MAX_BROWSERS = 5
# Max age (seconds) before an idle browser is closed
IDLE_TIMEOUT = 120
# Max concurrent browser launches
MAX_CONCURRENT_LAUNCHES = 3


class BrowserInstance:
    """A launched browser with metadata."""

    def __init__(self, browser):
        self.browser = browser
        self.created_at = time.time()
        self.in_use = False


class BrowserPool:
    """
    Shared Playwright browser pool.

    Usage:
        pool = BrowserPool()
        await pool.start()

        async with pool.acquire() as browser:
            page = await browser.new_page()
            ...

        await pool.stop()
    """

    def __init__(
        self, max_browsers: int = MAX_BROWSERS, idle_timeout: int = IDLE_TIMEOUT
    ):
        self.max_browsers = max_browsers
        self.idle_timeout = idle_timeout
        self._pool: asyncio.Queue = asyncio.Queue()
        self._browsers: list[BrowserInstance] = []
        self._launch_lock = asyncio.Semaphore(MAX_CONCURRENT_LAUNCHES)
        self._started = False
        self._stopped = False

    async def start(self):
        """Pre-warm the pool with idle browsers."""
        if self._started:
            return
        self._started = True
        # Pre-launch some browsers
        for _ in range(min(2, self.max_browsers)):
            b = await self._launch_browser()
            if b:
                await self._pool.put(b)
        logger.info("browser_pool_started max=%d", self.max_browsers)

    async def stop(self):
        """Close all browsers in the pool."""
        if self._stopped:
            return
        self._stopped = True
        while not self._pool.empty():
            try:
                inst = self._pool.get_nowait()
                await inst.browser.close()
            except Exception:
                pass
        for inst in self._browsers:
            try:
                await inst.browser.close()
            except Exception:
                pass
        self._browsers.clear()
        logger.info("browser_pool_stopped")

    async def _launch_browser(self) -> Optional[BrowserInstance]:
        """Launch a new Chromium browser."""
        try:
            from playwright.async_api import async_playwright

            p = await async_playwright().start()
            browser = await p.chromium.launch(headless=True)
            inst = BrowserInstance(browser)
            self._browsers.append(inst)
            return inst
        except Exception as e:
            logger.warning("browser_launch_failed: %s", e)
            return None

    async def acquire(self):
        """Context manager to acquire a browser from the pool."""
        return _BrowserContext(self)

    async def _cleanup_idle_browsers(self):
        """Close browsers that have been idle too long."""
        now = time.time()
        to_remove = []
        while not self._pool.empty():
            try:
                inst = self._pool.get_nowait()
            except asyncio.QueueEmpty:
                break
            if inst.in_use:
                # Should not happen, but re-add if so
                await self._pool.put(inst)
                continue
            if now - inst.created_at > self.idle_timeout:
                try:
                    await inst.browser.close()
                    self._browsers.remove(inst)
                except Exception:
                    pass
            else:
                to_remove.append(inst)

        for inst in to_remove:
            await self._pool.put(inst)

    async def _get_browser(self) -> Optional:
        """Get a browser from the pool or launch a new one."""
        # First, try to get an existing browser
        try:
            inst = self._pool.get_nowait()
            if inst.in_use:
                # Edge case: put back and create new
                await self._pool.put(inst)
            else:
                return inst
        except asyncio.QueueEmpty:
            pass

        # Check if we're at max capacity
        active_count = sum(1 for b in self._browsers if not b.in_use)
        if active_count >= self.max_browsers:
            # Wait for a browser to become available
            inst = await asyncio.wait_for(self._pool.get(), timeout=60)
            return inst

        # Launch new browser (with concurrency limit)
        async with self._launch_lock:
            inst = await self._launch_browser()
            if inst is None:
                # Fallback: wait for any available browser
                inst = await asyncio.wait_for(self._pool.get(), timeout=30)
            return inst


class _BrowserContext:
    """Context manager for browser pool acquisition."""

    def __init__(self, pool: BrowserPool):
        self.pool = pool
        self.instance: Optional[BrowserInstance] = None

    async def __aenter__(self):
        self.instance = await self.pool._get_browser()
        if self.instance:
            self.instance.in_use = True
        return self.instance.browser if self.instance else None

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.instance:
            self.instance.in_use = False
            await self.pool._pool.put(self.instance)
