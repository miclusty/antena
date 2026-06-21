"""Extraction routes.

Endpoints that perform extraction (vs. read-only feed/location routes):
  - GET  /                            — root with API info
  - GET  /health                      — basic liveness
  - GET  /health/detailed             — full health report
  - POST /extract                     — cascade extract from URL
  - POST /extract/google-news         — extract by location or query
  - POST /extract/google-news/batch    — extract for many locations in parallel

Uses `getattr(app.state, ...)` for service access. The state attributes
are populated by the lifespan in main.py. DI migration (Depends) is a
separate future PR — see iter 1.3 plan.
"""
from __future__ import annotations

import asyncio
import logging
import resource
import time
from dataclasses import asdict

from fastapi import APIRouter, Request

from config import settings
from models.schemas import (
    ExtractRequest,
    ExtractResult,
    GoogleNewsBatchRequest,
    GoogleNewsBatchResult,
    GoogleNewsRequest,
    GoogleNewsResult,
    HealthReport,
    HealthResponse,
    MethodName,
)

logger = logging.getLogger("akira")

router = APIRouter(tags=["extraction"])


@router.get("/")
async def root():
    """Root endpoint with API info — hardcoded endpoint list (see main.py docstring)."""
    return {
        "name": "AKIRA",
        "version": "4.0.0",
        "description": "AKIRA Extraction Engine with Synthesis",
        "endpoints": [
            "/health",
            "/health/detailed",
            "/extract",
            "/extract/google-news",
            "/extract/google-news/batch",
            "/cluster/{cluster_id}/synthesize",
            "/synthesis/batch",
            "/synthesis/master/{cluster_id}",
            "/synthesis/stats",
            "/admin/gc",
            "/admin/autoheal",
            "/admin/stats",
            "/admin/method-stats",
            "/admin/method-scores",
            "/admin/reset-method-scores",
            "/admin/reset-learning",
            "/admin/recover-source",
            "/admin/scan-failed-sources",
            "/admin/failed-sources",
            "/admin/recovery-stats",
            "/docs",
        ],
    }


@router.get("/health", response_model=HealthResponse)
async def health_check(request: Request):
    """Health check endpoint."""
    app = request.app
    engine = getattr(app.state, "engine", None)
    start_time = getattr(app.state, "start_time", time.time())

    mem_usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024

    return HealthResponse(
        status="healthy",
        version="4.0.0",  # AKIRA_VERSION
        uptime_seconds=int(time.time() - start_time),
        active_extractions=engine.active_extractions if engine else 0,
        cache_hit_rate=engine.cache.hit_rate if engine else 0,
        extractors={
            e.NAME: {"status": "healthy", "priority": e.PRIORITY}
            for e in engine.extractors
        }
        if engine
        else {},
        memory_mb=round(mem_usage, 1),
    )


@router.get("/health/detailed", response_model=HealthReport)
async def health_detailed(request: Request):
    """Detailed health check with full system report."""
    app = request.app
    engine = getattr(app.state, "engine", None)
    health_monitor = getattr(app.state, "health_monitor", None)

    if not health_monitor:
        return HealthReport(
            extractor_health={},
            cache_health={},
            memory_usage_mb=0,
            open_circuits=0,
            recommendations=["Health monitor not initialized"],
        )

    report = health_monitor.generate_health_report(engine)

    return HealthReport(
        extractor_health=report.get("extractors", {}),
        cache_health=report.get("cache", {}),
        memory_usage_mb=report.get("memory", {}).get("memory_mb", 0),
        open_circuits=report.get("circuit_breaker", {}).get("open_circuits", 0),
        recommendations=report.get("recommendations", []),
    )


@router.post("/extract", response_model=ExtractResult)
async def extract(request: Request, body: ExtractRequest):
    """Extract news from URL using intelligent cascade.

    Cascade order:
      1. Cache check
      2. Circuit breaker check
      3. RSS (feedparser) - fastest for feeds
      4. WordPress REST API - fast for WP sites
      5. Newspaper - best for articles
      6. Goose - fallback
      7. Sitemap - find URLs
      8. Playwright - JS-heavy sites
      9. Jina - last resort
    """
    engine = getattr(request.app.state, "engine", None)
    if not engine:
        return ExtractResult(
            success=False,
            method=MethodName.JINA,
            type="article",
            duration_ms=0,
            error="Engine not initialized",
        )

    return await engine.extract(
        url=str(body.url),
        source_id=body.source_id,
        prefer_method=body.prefer_method,
        use_cache=body.use_cache,
        timeout=body.timeout,
        db_path=settings.db_path,
    )


@router.post("/extract/google-news", response_model=GoogleNewsResult)
async def extract_google_news(request: Request, body: GoogleNewsRequest):
    """Extract news from Google News for a single location or query."""
    app = request.app
    google_news_service = getattr(app.state, "google_news_service", None)

    if not google_news_service:
        return GoogleNewsResult(
            success=False,
            query="",
            items_count=0,
            items=[],
            duration_ms=0,
            error="Google News service not initialized",
        )

    start_time = time.time()

    # Build query from location_id or freeform query
    location = None
    if body.location_id:
        location = google_news_service.get_location(body.location_id)
        if not location:
            return GoogleNewsResult(
                success=False,
                query="",
                items_count=0,
                items=[],
                duration_ms=0,
                error=f"Location {body.location_id} not found",
            )
        query = google_news_service.build_query(body.location_id)
    elif body.query:
        query = body.query
    else:
        return GoogleNewsResult(
            success=False,
            query="",
            items_count=0,
            items=[],
            duration_ms=0,
            error="Either location_id or query required",
        )

    # Lazy import — google_news extractor depends on feedparser etc.
    from extractors.google_news import GoogleNewsExtractor

    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query=query, country=body.country, limit=body.limit)

    duration_ms = int((time.time() - start_time) * 1000)

    return GoogleNewsResult(
        success=True,
        method="google_news",
        query=query,
        location=location,
        items_count=len(items),
        items=[asdict(item) for item in items],
        duration_ms=duration_ms,
    )


@router.post("/extract/google-news/batch", response_model=GoogleNewsBatchResult)
async def extract_google_news_batch(request: Request, body: GoogleNewsBatchRequest):
    """Extract news from Google News for multiple locations in parallel."""
    app = request.app
    google_news_service = getattr(app.state, "google_news_service", None)

    if not google_news_service:
        return GoogleNewsBatchResult(
            success=False,
            total_locations=0,
            total_items=0,
            results=[],
            duration_ms=0,
            error="Google News service not initialized",
        )

    start_time = time.time()

    locations = google_news_service.get_locations_by_type(
        body.location_type, body.province_filter
    )

    if not locations:
        return GoogleNewsBatchResult(
            success=False,
            total_locations=0,
            total_items=0,
            results=[],
            duration_ms=0,
            error=f"No locations found for type {body.location_type}",
        )

    from extractors.google_news import GoogleNewsExtractor

    semaphore = asyncio.Semaphore(body.concurrency)
    extractor = GoogleNewsExtractor()

    async def extract_location(location: dict) -> dict:
        async with semaphore:
            query = google_news_service.build_query(location["id"])
            items = await extractor.extract(
                query=query, country="AR", limit=body.limit_per_location
            )
            return {
                "location_id": location["id"],
                "location_name": location["name"],
                "query": query,
                "items_count": len(items),
                "items": [asdict(item) for item in items],
            }

    results = await asyncio.gather(*[extract_location(loc) for loc in locations])

    total_items = sum(r["items_count"] for r in results)
    duration_ms = int((time.time() - start_time) * 1000)

    logger.info(
        f"google_news_batch_completed locations={len(locations)} "
        f"items={total_items} duration={duration_ms}ms"
    )

    return GoogleNewsBatchResult(
        success=True,
        total_locations=len(locations),
        total_items=total_items,
        results=list(results),
        duration_ms=duration_ms,
    )