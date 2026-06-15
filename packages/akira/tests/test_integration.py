"""Integration tests for AKIRA FastAPI application."""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from contextlib import asynccontextmanager
from fastapi import FastAPI
from main import app
from config import settings
from core.engine import ExtractionEngine
from core.cache import CacheManager, MemoryBackend
from core.rate_limiter import RateLimiter
from core.circuit_breaker import CircuitBreaker
from extractors.rss import RSSExtractor
from extractors.wordpress import WordPressExtractor
from extractors.trafilatura import TrafilaturaExtractor
from extractors.goose import GooseExtractor
from extractors.sitemap import SitemapExtractor
from extractors.playwright import PlaywrightExtractor
from extractors.jina import JinaExtractor


@asynccontextmanager
async def setup_test_engine(app: FastAPI):
    """Test lifespan that initializes the engine."""
    import time

    cache = CacheManager(MemoryBackend(maxsize=settings.cache_max_size))
    rate_limiter = RateLimiter(delay=settings.request_delay)
    circuit_breaker = CircuitBreaker(
        threshold=settings.circuit_breaker_threshold,
        timeout=settings.circuit_breaker_timeout,
    )
    extractors = [
        RSSExtractor,
        WordPressExtractor,
        TrafilaturaExtractor,
        GooseExtractor,
        SitemapExtractor,
        PlaywrightExtractor,
        JinaExtractor,
    ]
    engine = ExtractionEngine(
        extractors=extractors,
        cache=cache,
        rate_limiter=rate_limiter,
        circuit_breaker=circuit_breaker,
    )
    app.state.engine = engine
    app.state.start_time = time.time()
    yield
    app.state.engine = None


@pytest_asyncio.fixture
async def client():
    """Create test client with initialized engine."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        async with setup_test_engine(app):
            yield ac


@pytest.mark.asyncio
async def test_root_endpoint(client):
    response = await client.get("/")

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "AKIRA"
    assert data["version"] == "4.0.0"


@pytest.mark.asyncio
async def test_health_endpoint(client):
    response = await client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["version"] == "4.0.0"


@pytest.mark.asyncio
@pytest.mark.xfail(reason="Flaky: depends on whether BBC items are already in akira.db seen_urls")
async def test_extract_rss(client):
    response = await client.post(
        "/extract",
        json={
            "url": "https://feeds.bbci.co.uk/news/rss.xml",
            "use_cache": False,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["success"] == True
    assert data["method"] in [
        "rss",
        "wp_api",
        "newspaper",
        "goose",
        "sitemap",
        "playwright",
        "jina",
    ]
    assert len(data.get("items", [])) > 0 or data.get("article") is not None


@pytest.mark.asyncio
async def test_invalid_url_validation(client):
    response = await client.post(
        "/extract",
        json={
            "url": "not-a-valid-url",
        },
    )

    assert response.status_code == 422
