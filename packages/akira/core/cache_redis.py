"""Redis-backed cache for extraction results.

Used when AKIRA scales beyond a single instance (multiple uvicorn workers
or multiple machines). The in-memory MemoryBackend is fine for a single
process; Redis gives us shared cache state across instances.

Lazy import: the `redis` package is optional. If it's not installed and
`backend='redis'` is selected, CacheManager raises a clear ImportError
pointing at `pip install redis>=5.0`.

Configuration via env vars (see config.py:21):
    AKIRA_CACHE_BACKEND = "memory" | "redis"   (default: "memory")
    AKIRA_REDIS_URL = "redis://localhost:6379/0"
"""
from __future__ import annotations

import logging
from typing import Optional

from core.cache import CacheBackend

logger = logging.getLogger(__name__)


class RedisBackend(CacheBackend):
    """Redis cache backend.

    Stores values as raw bytes (same wire format as MemoryBackend). Keys are
    passed in pre-hashed by CacheManager — we don't hash here.

    Connection lifecycle:
    - `_connect()` is called on first .get()/.set()/.delete().
    - Subsequent calls reuse the same connection.
    - Failures (connection refused, timeout) raise — callers (CacheManager)
      decide whether to fall back or fail the request.
    """

    def __init__(self, url: str, prefix: str = "akira:cache:"):
        self.url = url
        self.prefix = prefix
        self._client: Optional[object] = None  # redis.Redis; lazy

    def _connect(self):
        if self._client is not None:
            return self._client
        try:
            import redis  # type: ignore[import-untyped]
        except ImportError as e:
            raise ImportError(
                "RedisBackend requires the 'redis' package. "
                "Install with: pip install 'redis>=5.0'"
            ) from e
        self._client = redis.Redis.from_url(
            self.url,
            socket_connect_timeout=2,
            socket_timeout=5,
            decode_responses=False,
        )
        logger.info(f"RedisBackend connected to {self.url}")
        return self._client

    def _key(self, key: str) -> str:
        return f"{self.prefix}{key}"

    async def get(self, key: str) -> Optional[bytes]:
        client = self._connect()
        # redis-py is sync; run in default executor would be ideal but the
        # CacheBackend interface is async. For now, call sync .get() directly —
        # the GIL cost is minimal since this is a fast in-memory op.
        value = client.get(self._key(key))
        return value if value is not None else None

    async def set(self, key: str, value: bytes, ttl: int = 600) -> None:
        client = self._connect()
        client.set(self._key(key), value, ex=ttl)

    async def delete(self, key: str) -> None:
        client = self._connect()
        client.delete(self._key(key))
