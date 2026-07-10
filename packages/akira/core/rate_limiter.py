"""Rate limiting for respectful web scraping."""

import time
import asyncio
from urllib.parse import urlparse
from typing import Dict

# Max age (seconds) before a domain entry is considered stale and evicted
_DOMAIN_MAX_AGE = 3600  # 1 hour
# Max number of domains to track
_MAX_DOMAINS = 500


class RateLimiter:
    """
    Per-domain rate limiting with automatic cleanup of stale entries.
    1.5s delay between requests to same domain, parallel across domains.
    """

    def __init__(self, delay: float = 1.5):
        self.delay = delay
        self.last_request: Dict[str, float] = {}
        self._locks: Dict[str, asyncio.Lock] = {}

    def _get_domain(self, url: str) -> str:
        return urlparse(url).netloc

    async def wait(self, url: str) -> None:
        """Wait if needed to respect rate limit for this domain"""
        domain = self._get_domain(url)
        self._ensure_capacity(domain)

        if domain not in self._locks:
            self._locks[domain] = asyncio.Lock()

        async with self._locks[domain]:
            now = time.time()
            last = self.last_request.get(domain, 0)
            elapsed = now - last

            if elapsed < self.delay:
                sleep_time = self.delay - elapsed
                await asyncio.sleep(sleep_time)

            self.last_request[domain] = time.time()

    def _ensure_capacity(self, domain: str) -> None:
        """Evict stale domains if capacity is exceeded."""
        if domain in self.last_request:
            return

        if len(self.last_request) >= _MAX_DOMAINS:
            self._evict_stale()

    def _evict_stale(self) -> None:
        """Remove oldest domain entries to free capacity."""
        now = time.time()
        stale = [d for d, t in self.last_request.items() if now - t > _DOMAIN_MAX_AGE]
        if not stale:
            # No stale entries; remove the oldest one
            oldest = min(self.last_request, key=lambda d: self.last_request[d])
            stale = [oldest]

        for domain in stale:
            self.last_request.pop(domain, None)
            self._locks.pop(domain, None)
