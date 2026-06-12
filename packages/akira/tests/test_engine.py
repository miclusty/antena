"""Tests for extraction engine."""

import pytest
from core.engine import ExtractionEngine
from core.cache import CacheManager, MemoryBackend
from core.rate_limiter import RateLimiter
from core.circuit_breaker import CircuitBreaker
from extractors.base import BaseExtractor, ExtractedItem


class MockExtractor(BaseExtractor):
    """Mock extractor for testing."""

    NAME = "rss"  # Use valid MethodName for testing
    PRIORITY = 80

    @classmethod
    def can_extract(cls, url: str, html=None) -> bool:
        return True

    async def extract(self, url: str, timeout: int = 30):
        if "failing" in url:
            raise ValueError("Simulated failure")
        return [
            ExtractedItem(
                title="Mock Article Title",
                url=url,
                summary="This is a valid summary with enough content to pass validation checks",
                text="Full article text with more than one hundred characters to ensure the content validation passes correctly in the test suite.",
            )
        ]


@pytest.mark.asyncio
async def test_engine_returns_first_success():
    engine = ExtractionEngine(
        extractors=[MockExtractor],
        cache=CacheManager(MemoryBackend()),
        rate_limiter=RateLimiter(0.01),
        circuit_breaker=CircuitBreaker(),
    )

    result = await engine.extract("https://mock.example.com/article")

    assert result.success == True
    assert result.method.value == "rss"
    assert len(result.items) == 1


@pytest.mark.asyncio
async def test_engine_caches_success():
    engine = ExtractionEngine(
        extractors=[MockExtractor],
        cache=CacheManager(MemoryBackend()),
        rate_limiter=RateLimiter(0.01),
        circuit_breaker=CircuitBreaker(),
    )

    # First call
    result1 = await engine.extract("https://mock.example.com/article")
    assert result1.cached == False

    # Second call
    result2 = await engine.extract("https://mock.example.com/article")
    assert result2.cached == True


@pytest.mark.asyncio
async def test_engine_circuit_breaker():
    engine = ExtractionEngine(
        extractors=[MockExtractor],
        cache=CacheManager(MemoryBackend()),
        rate_limiter=RateLimiter(0.01),
        circuit_breaker=CircuitBreaker(threshold=1, timeout=60),
    )

    # Use a URL that will fail (not matching mock pattern)
    result = await engine.extract("https://failing.example.com/article")

    # Circuit should be open now for this extractor
    assert engine.circuit_breaker.is_open("https://failing.example.com/article", "rss")


@pytest.mark.asyncio
async def test_engine_all_extractors_fail():
    engine = ExtractionEngine(
        extractors=[MockExtractor],
        cache=CacheManager(MemoryBackend()),
        rate_limiter=RateLimiter(0.01),
        circuit_breaker=CircuitBreaker(),
    )

    result = await engine.extract("https://failing.example.com/article")

    assert result.success == False
    assert result.error is not None


@pytest.mark.asyncio
async def test_engine_prefer_method():
    engine = ExtractionEngine(
        extractors=[MockExtractor],
        cache=CacheManager(MemoryBackend()),
        rate_limiter=RateLimiter(0.01),
        circuit_breaker=CircuitBreaker(),
    )

    from models.schemas import MethodName

    result = await engine.extract(
        "https://mock.example.com/article",
        prefer_method=MethodName.RSS,
        use_cache=False,
    )

    assert result.success == True
    assert result.method == MethodName.RSS
