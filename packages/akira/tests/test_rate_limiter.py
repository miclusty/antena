"""Tests for rate limiter."""

import pytest
import time
from core.rate_limiter import RateLimiter


@pytest.mark.asyncio
async def test_rate_limiter_waits():
    limiter = RateLimiter(delay=0.1)

    start = time.time()
    await limiter.wait("https://example.com/a")
    await limiter.wait("https://example.com/b")
    elapsed = time.time() - start

    assert elapsed >= 0.1


@pytest.mark.asyncio
async def test_rate_limiter_parallel_domains():
    limiter = RateLimiter(delay=0.5)

    start = time.time()
    await limiter.wait("https://domain1.com/a")
    await limiter.wait("https://domain2.com/a")
    elapsed = time.time() - start

    assert elapsed < 0.3


@pytest.mark.asyncio
async def test_rate_limiter_per_domain_isolation():
    limiter = RateLimiter(delay=0.1)

    start = time.time()

    await limiter.wait("https://domain1.com/a")
    await limiter.wait("https://domain2.com/a")
    await limiter.wait("https://domain3.com/a")

    elapsed = time.time() - start

    assert elapsed < 0.25

    await limiter.wait("https://domain1.com/b")
    elapsed2 = time.time() - start

    assert elapsed2 >= 0.1
