"""Shared HTTP client with connection pooling and User-Agent rotation."""

import asyncio
import random
from typing import Optional
from urllib.parse import urlparse

import aiohttp

USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
]


def get_user_agent() -> str:
    """Return a random User-Agent string."""
    return random.choice(USER_AGENTS)


def get_domain(url: str) -> str:
    """Extract domain from URL."""
    try:
        return urlparse(url).netloc
    except Exception:
        return ""


class HTTPClient:
    """
    Shared aiohttp client with connection pooling and User-Agent rotation.

    Usage:
        client = HTTPClient()
        await client.start()

        # Use in extractors
        async with client.session() as session:
            async with session.get(url, headers=client.headers()) as resp:
                ...

        await client.stop()
    """

    def __init__(
        self,
        total_timeout: int = 30,
        connect_timeout: int = 10,
        max_connections: int = 100,
        max_connections_per_host: int = 10,
    ):
        self._session: Optional[aiohttp.ClientSession] = None
        self._total_timeout = total_timeout
        self._connect_timeout = connect_timeout
        self._max_connections = max_connections
        self._max_connections_per_host = max_connections_per_host

    async def start(self):
        """Initialize the shared session."""
        if self._session is None:
            connector = aiohttp.TCPConnector(
                limit=self._max_connections,
                limit_per_host=self._max_connections_per_host,
                ttl_dns_cache=300,
                use_dns_cache=True,
            )
            timeout = aiohttp.ClientTimeout(
                total=self._total_timeout,
                connect=self._connect_timeout,
            )
            self._session = aiohttp.ClientSession(
                connector=connector,
                timeout=timeout,
            )

    async def stop(self):
        """Close the shared session."""
        if self._session:
            await self._session.close()
            self._session = None

    @property
    def session(self) -> aiohttp.ClientSession:
        """Return the shared session. Must call start() first."""
        if self._session is None:
            raise RuntimeError(
                "HTTPClient not started. Call await client.start() first."
            )
        return self._session

    def headers(self, extra: Optional[dict] = None) -> dict:
        """Return headers with rotated User-Agent."""
        headers = {
            "User-Agent": get_user_agent(),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
        }
        if extra:
            headers.update(extra)
        return headers

    async def get(self, url: str, **kwargs) -> aiohttp.ClientResponse:
        """Convenience method for GET requests with auto headers."""
        if "headers" not in kwargs:
            kwargs["headers"] = self.headers()
        return await self.session.get(url, **kwargs)

    async def get_text(self, url: str, **kwargs) -> str:
        """Convenience method for GET returning text."""
        async with self.get(url, **kwargs) as resp:
            resp.raise_for_status()
            return await resp.text()
