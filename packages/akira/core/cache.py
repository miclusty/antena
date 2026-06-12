"""Multi-backend cache layer for extraction results."""

import json
import time
import asyncio
import hashlib
from abc import ABC, abstractmethod
from typing import Optional
from collections import OrderedDict


class CacheBackend(ABC):
    """Base cache backend interface."""

    @abstractmethod
    async def get(self, key: str) -> Optional[bytes]:
        pass

    @abstractmethod
    async def set(self, key: str, value: bytes, ttl: int) -> None:
        pass

    @abstractmethod
    async def delete(self, key: str) -> None:
        pass


class MemoryBackend(CacheBackend):
    """In-memory LRU cache with asyncio.Lock for thread safety."""

    def __init__(self, maxsize: int = 1000):
        self.maxsize = maxsize
        self._cache: OrderedDict = OrderedDict()
        self._expiry: dict = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[bytes]:
        async with self._lock:
            if key in self._cache:
                if self._expiry.get(key, 0) > time.time():
                    self._cache.move_to_end(key)
                    return self._cache[key]
                else:
                    try:
                        del self._cache[key]
                        del self._expiry[key]
                    except KeyError:
                        pass
            return None

    async def set(self, key: str, value: bytes, ttl: int = 600) -> None:
        async with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
            self._cache[key] = value
            self._expiry[key] = time.time() + ttl

            if len(self._cache) > self.maxsize:
                oldest = next(iter(self._cache))
                del self._cache[oldest]
                del self._expiry[oldest]

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._cache.pop(key, None)
            self._expiry.pop(key, None)


class NullBackend(CacheBackend):
    """No-op cache for testing."""

    async def get(self, key: str) -> Optional[bytes]:
        return None

    async def set(self, key: str, value: bytes, ttl: int = 600) -> None:
        pass

    async def delete(self, key: str) -> None:
        pass


class CacheManager:
    """Cache manager with hit/miss tracking."""

    def __init__(self, backend: Optional[CacheBackend] = None, l1_size: int = 1000):
        self.backend = backend or MemoryBackend(maxsize=l1_size)
        self._stats = {"hits": 0, "misses": 0}

    def _make_key(self, url: str) -> str:
        normalized = url.rstrip("/").lower()
        return f"extract:v1:{hashlib.sha256(normalized.encode()).hexdigest()[:16]}"

    async def get(self, url: str) -> Optional[dict]:
        key = self._make_key(url)
        data = await self.backend.get(key)

        if data:
            self._stats["hits"] += 1
            return json.loads(data)

        self._stats["misses"] += 1
        return None

    async def set(self, url: str, result: dict, ttl: int = 600) -> None:
        key = self._make_key(url)
        data = json.dumps(result).encode()
        await self.backend.set(key, data, ttl)

    @property
    def hit_rate(self) -> float:
        total = self._stats["hits"] + self._stats["misses"]
        return self._stats["hits"] / total if total > 0 else 0.0
