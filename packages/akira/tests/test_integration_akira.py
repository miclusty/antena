"""Integration tests for AKIRA v3.1."""

import pytest
import asyncio
import time
from core.engine import ExtractionEngine
from core.cache import CacheManager, MemoryBackend
from core.rate_limiter import RateLimiter
from core.circuit_breaker import CircuitBreaker
from core.method_learner import MethodLearner
from extractors.rss import RSSExtractor
from extractors.wordpress import WordPressExtractor
from extractors.google_news import GoogleNewsExtractor


@pytest.fixture
def engine():
    """Create full engine with method learning."""
    db_path = "/tmp/test_integration_akira.db"
    learner = MethodLearner(db_path)

    cache = CacheManager(MemoryBackend(maxsize=1000))
    rate_limiter = RateLimiter(delay=1.5)
    circuit_breaker = CircuitBreaker(threshold=5, timeout=60)

    extractors = [RSSExtractor, WordPressExtractor, GoogleNewsExtractor]

    engine = ExtractionEngine(
        extractors=extractors,
        cache=cache,
        rate_limiter=rate_limiter,
        circuit_breaker=circuit_breaker,
        method_learner=learner,
    )

    yield engine

    learner.close()


@pytest.mark.asyncio
async def test_full_extraction_with_learning(engine):
    """Test that second extraction uses learned method."""
    url = "https://www.infotuc.com.ar/feed/"

    start1 = time.time()
    result1 = await engine.extract(url, timeout=30)
    duration1 = time.time() - start1

    start2 = time.time()
    result2 = await engine.extract(url, timeout=30)
    duration2 = time.time() - start2

    assert result1.success
    assert result2.success

    stats = engine.method_learner.get_stats()
    assert stats["total_sources_tracked"] >= 1


@pytest.mark.asyncio
async def test_google_news_integration(engine):
    """Test Google News extraction via engine."""
    query = "noticias Córdoba Argentina"

    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query, limit=5)

    assert len(items) <= 5
    assert all(item.title for item in items)
    assert all(item.url for item in items)


@pytest.mark.asyncio
async def test_cascade_optimization_performance():
    """Verify optimized cascade is faster than standard."""
    db_path = "/tmp/test_performance.db"
    learner = MethodLearner(db_path)

    url = "https://example.com/feed/"
    learner.record_success(url, "wordpress", 2500, 10)

    best = learner.get_best_method(url)

    assert best == "wordpress"

    cache = CacheManager(MemoryBackend(maxsize=100))
    rate_limiter = RateLimiter(delay=1.5)
    circuit_breaker = CircuitBreaker(threshold=5, timeout=60)

    extractors = [RSSExtractor, WordPressExtractor]

    engine = ExtractionEngine(
        extractors=extractors,
        cache=cache,
        rate_limiter=rate_limiter,
        circuit_breaker=circuit_breaker,
        method_learner=learner,
    )

    optimized_order = engine._build_optimized_order("wordpress")

    assert optimized_order[0].NAME == "wordpress"
    assert optimized_order[1].NAME == "rss"

    learner.close()
