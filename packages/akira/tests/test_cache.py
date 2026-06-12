"""Tests for cache layer."""

import pytest
import asyncio
import time
from core.cache import CacheManager, MemoryBackend, NullBackend


@pytest.mark.asyncio
async def test_memory_cache_hit():
    cache = CacheManager(MemoryBackend(maxsize=100))

    await cache.set("https://test.com", {"title": "Test"})
    result = await cache.get("https://test.com")

    assert result == {"title": "Test"}
    assert cache.hit_rate == 1.0


@pytest.mark.asyncio
async def test_memory_cache_miss():
    cache = CacheManager(MemoryBackend(maxsize=100))

    result = await cache.get("https://missing.com")

    assert result is None
    assert cache.hit_rate == 0.0


@pytest.mark.asyncio
async def test_null_backend():
    cache = CacheManager(NullBackend())

    await cache.set("https://test.com", {"data": "value"})
    result = await cache.get("https://test.com")

    assert result is None


@pytest.mark.asyncio
async def test_cache_ttl_expiry():
    cache = CacheManager(MemoryBackend(maxsize=100))

    await cache.set("https://test.com", {"title": "Test"}, ttl=0.1)
    result = await cache.get("https://test.com")
    assert result == {"title": "Test"}

    await asyncio.sleep(0.15)
    result = await cache.get("https://test.com")
    assert result is None


@pytest.mark.asyncio
async def test_cache_lru_eviction():
    cache = CacheManager(MemoryBackend(maxsize=2))

    await cache.set("https://a.com", {"title": "A"})
    await cache.set("https://b.com", {"title": "B"})

    # Access A to make it most recently used
    await cache.get("https://a.com")

    # Add C, should evict B (oldest)
    await cache.set("https://c.com", {"title": "C"})

    assert await cache.get("https://a.com") == {"title": "A"}
    assert await cache.get("https://b.com") is None
    assert await cache.get("https://c.com") == {"title": "C"}
