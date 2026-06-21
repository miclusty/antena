"""Tests for the optional Redis cache backend.

We don't need a real Redis server — we mock the redis-py client. The
goal is to verify the key prefixing, lazy connection, and async interface
contract that CacheManager depends on.
"""
from unittest.mock import MagicMock, patch

import pytest

from core.cache import CacheManager
from core.cache_redis import RedisBackend


def test_redis_backend_get_set_uses_prefix():
    """Keys are namespaced under the configured prefix."""
    fake_redis = MagicMock()
    fake_redis.get.return_value = None
    fake_redis.set = MagicMock()

    backend = RedisBackend(url="redis://test:6379/0", prefix="akira:test:")
    # Force the lazy connection
    backend._client = fake_redis

    import asyncio

    async def run():
        await backend.get("abc123")
        await backend.set("abc123", b"hello", ttl=600)

    asyncio.run(run())

    # Verify the prefix was applied
    fake_redis.get.assert_called_once_with("akira:test:abc123")
    fake_redis.set.assert_called_once_with("akira:test:abc123", b"hello", ex=600)


def test_redis_backend_get_returns_none_when_missing():
    """Miss path: backend.get returns None, never raises."""
    fake_redis = MagicMock()
    fake_redis.get.return_value = None
    backend = RedisBackend(url="redis://test:6379/0")
    backend._client = fake_redis

    import asyncio
    result = asyncio.run(backend.get("missing"))
    assert result is None


def test_redis_backend_import_error_when_redis_missing():
    """If redis-py is not installed, constructing the backend gives a clear error.

    This test simulates the missing-redis case by patching the import to fail.
    """
    import builtins
    original_import = builtins.__import__

    def mock_import(name, *args, **kwargs):
        if name == "redis" or name.startswith("redis."):
            raise ImportError("No module named 'redis'")
        return original_import(name, *args, **kwargs)

    backend = RedisBackend(url="redis://test:6379/0")
    with patch.object(builtins, "__import__", side_effect=mock_import):
        with pytest.raises(ImportError, match="redis"):
            backend._connect()


def test_cache_manager_selects_redis_from_env(monkeypatch):
    """AKIRA_CACHE_BACKEND=redis routes CacheManager to RedisBackend."""
    monkeypatch.setenv("AKIRA_CACHE_BACKEND", "redis")
    monkeypatch.setenv("AKIRA_REDIS_URL", "redis://test:6379/0")

    # Pre-mock redis-py import to avoid network call.
    fake_redis_module = MagicMock()
    fake_redis_module.Redis.from_url.return_value = MagicMock()
    monkeypatch.setitem(__import__("sys").modules, "redis", fake_redis_module)

    manager = CacheManager()
    assert isinstance(manager.backend, RedisBackend)
    assert manager.backend.url == "redis://test:6379/0"


def test_cache_manager_default_is_memory(monkeypatch):
    """No env var + no explicit backend → MemoryBackend."""
    monkeypatch.delenv("AKIRA_CACHE_BACKEND", raising=False)
    manager = CacheManager()
    from core.cache import MemoryBackend
    assert isinstance(manager.backend, MemoryBackend)


def test_cache_manager_explicit_backend_wins(monkeypatch):
    """Explicit backend= overrides env var."""
    from core.cache import NullBackend
    monkeypatch.setenv("AKIRA_CACHE_BACKEND", "redis")
    manager = CacheManager(backend=NullBackend())
    assert isinstance(manager.backend, NullBackend)
