"""AKIRA - PULSO Extraction Engine. FastAPI application."""

import sys
import os
import time
import json
import logging
import resource
import asyncio
import sqlite3
import unicodedata
import uuid
from contextlib import asynccontextmanager
from dataclasses import asdict
from typing import Optional, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, Depends, Request, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from models.schemas import (
    ExtractRequest,
    ExtractResult,
    HealthResponse,
    MethodName,
    GCStats,
    HealthReport,
    AutoHealResult,
    GoogleNewsRequest,
    GoogleNewsBatchRequest,
    GoogleNewsResult,
    GoogleNewsBatchResult,
    MethodStats,
    RecoveryResult,
    RecoveryStats,
    RecoveryStatus,
    SynthesisResult,
    BatchSynthesisResult,
    MasterArticle,
)
from core.engine import ExtractionEngine
from core.cache import CacheManager, MemoryBackend
from core.rate_limiter import RateLimiter
from core.circuit_breaker import CircuitBreaker
from core.garbage_collector import GarbageCollector
from core.health_monitor import HealthMonitor
from core.http_client import HTTPClient
from core.browser_pool import BrowserPool
from core.metrics import metrics
from extractors.rss import RSSExtractor
from extractors.wordpress import WordPressExtractor
from extractors.newspaper import NewspaperExtractor
from extractors.goose import GooseExtractor
from extractors.sitemap import SitemapExtractor
from extractors.playwright import PlaywrightExtractor
from extractors.jina import JinaExtractor
from extractors.video import VideoExtractor
from extractors.social import SocialExtractor
from services.google_news_service import GoogleNewsService
from core.method_learner import MethodLearner
from core.method_scorer import MethodScorer
from core.source_recovery import SourceRecovery
from core.synthesis import SynthesisEngine
from core.clustering import ClusteringService


class JSONFormatter(logging.Formatter):
    """Structured JSON logging formatter."""

    def format(self, record):
        log_entry = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if hasattr(record, "request_id"):
            log_entry["request_id"] = record.request_id
        if record.exc_info and record.exc_info[0] is not None:
            log_entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_entry, ensure_ascii=False)


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("akira")

GC_INTERVAL = 300  # 5 minutes


async def _gc_loop(gc: GarbageCollector, method_learner=None, method_scorer=None, clustering_service=None):
    """Background garbage collection loop + auto-clustering."""
    cleanup_interval = 7 * GC_INTERVAL  # Run cleanup every 7 cycles (~35 min)
    cycle = 0

    while True:
        await asyncio.sleep(GC_INTERVAL)
        cycle += 1
        try:
            result = gc.collect_all()
            logger.info(
                f"gc_completed items={result['total_items_collected']} "
                f"duration={result['duration_ms']}ms"
            )

            # Auto-cluster recent unclustered news every cycle (every 5 min)
            if clustering_service:
                try:
                    clusters = clustering_service.cluster_recent_news(hours=24, limit=500)
                    total_clustered = sum(len(v) for v in clusters.values())
                    if clusters:
                        logger.info(
                            f"auto_clustering completed clusters={len(clusters)} "
                            f"cards={total_clustered}"
                        )
                except Exception as e:
                    logger.error(f"auto_clustering error: {e}")

            # Run cleanup on unbounded tables every ~35 minutes
            if cycle % cleanup_interval == 0:
                if method_scorer:
                    deleted = method_scorer.cleanup_old_entries(days=30)
                    if deleted:
                        logger.info(f"method_scorer_cleanup deleted={deleted}")
                if method_learner:
                    method_learner.cleanup_extraction_stats(days=30)
                    method_learner.cleanup_stale_health_entries(days=7)

        except Exception as e:
            logger.error(f"gc_error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - setup and teardown."""
    start_time = time.time()
    app.state.start_time = start_time

    # Initialize Google News Service
    data_dir = os.path.join(os.path.dirname(__file__), "data")
    os.makedirs(data_dir, exist_ok=True)

    locations_db_path = os.path.join(data_dir, "locations.db")
    google_news_service = GoogleNewsService(locations_db_path)
    app.state.google_news_service = google_news_service

    # Initialize Method Learner
    akira_db_path = os.path.join(data_dir, "akira.db")
    method_learner = MethodLearner(akira_db_path)
    app.state.method_learner = method_learner

    # Initialize Method Scorer
    method_scorer = MethodScorer(akira_db_path)
    app.state.method_scorer = method_scorer

    # Initialize Source Recovery
    source_recovery = SourceRecovery(akira_db_path)
    app.state.source_recovery = source_recovery

    # Initialize Synthesis Engine
    synthesis_engine = SynthesisEngine(
        db_path=akira_db_path,
        minimax_api_key=os.getenv("MINIMAX_API_KEY"),
    )
    app.state.synthesis_engine = synthesis_engine

    # Initialize Clustering Service
    clustering_service = ClusteringService(db_path=akira_db_path)
    app.state.clustering_service = clustering_service

    # Initialize HTTP client with connection pooling
    http_client = HTTPClient(
        total_timeout=30,
        connect_timeout=10,
        max_connections=100,
        max_connections_per_host=10,
    )
    await http_client.start()
    app.state.http_client = http_client

    # Initialize browser pool for Playwright
    browser_pool = BrowserPool(max_browsers=5, idle_timeout=120)
    await browser_pool.start()
    app.state.browser_pool = browser_pool

    cache = CacheManager(MemoryBackend(maxsize=settings.cache_max_size))
    rate_limiter = RateLimiter(delay=settings.request_delay)
    circuit_breaker = CircuitBreaker(
        threshold=settings.circuit_breaker_threshold,
        timeout=settings.circuit_breaker_timeout,
    )

    from extractors.google_news import GoogleNewsExtractor

    extractors = [
        RSSExtractor,
        WordPressExtractor,
        NewspaperExtractor,
        GooseExtractor,
        SitemapExtractor,
        PlaywrightExtractor,
        JinaExtractor,
        VideoExtractor,
        SocialExtractor,
        GoogleNewsExtractor,
    ]

    engine = ExtractionEngine(
        extractors=extractors,
        cache=cache,
        rate_limiter=rate_limiter,
        circuit_breaker=circuit_breaker,
        method_learner=method_learner,
        method_scorer=method_scorer,
        http_client=http_client,
        browser_pool=browser_pool,
    )
    app.state.engine = engine

    gc = GarbageCollector(cache=cache, circuit_breaker=circuit_breaker)
    app.state.gc = gc

    health_monitor = HealthMonitor(cache=cache, circuit_breaker=circuit_breaker)
    app.state.health_monitor = health_monitor

    # Start background GC with auto-clustering
    gc_task = asyncio.create_task(_gc_loop(gc, method_learner, method_scorer, clustering_service))
    app.state.gc_task = gc_task

    logger.info(f"AKIRA started on {settings.host}:{settings.port}")

    yield

    # Graceful shutdown
    logger.info("AKIRA shutting down")

    # Cancel GC task
    gc_task.cancel()
    try:
        await gc_task
    except asyncio.CancelledError:
        pass

    # Close HTTP client
    await http_client.stop()

    # Close browser pool
    await browser_pool.stop()

    # Close Google News service, Method Learner, Method Scorer, and Source Recovery
    google_news_service.close()
    method_learner.close()
    method_scorer.close()
    source_recovery.close()

    # Run final GC
    gc.collect_all()

    logger.info("AKIRA shutdown complete")


AKIRA_VERSION = "4.0.0"
AKIRA_ADMIN_KEY = os.getenv("AKIRA_ADMIN_KEY", None)

app = FastAPI(
    title="AKIRA",
    description="PULSO Extraction Engine for Argentine news",
    version=AKIRA_VERSION,
    lifespan=lifespan,
)

ALLOWED_ORIGINS = [
    "http://localhost:4321",
    "http://localhost:4322",
    "http://localhost:4324",
    "http://localhost:8787",
    "http://localhost:5000",
    "https://api.akira.ar",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """Add request ID to all requests for tracing."""
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler - returns JSON instead of HTML on errors."""
    request_id = getattr(request.state, "request_id", "unknown")
    logger.error(
        f"unhandled_exception request_id={request_id} path={request.url.path} "
        f"error={type(exc).__name__}: {str(exc)}",
        exc_info=True,
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc) if os.getenv("AKIRA_DEBUG") else None,
            "request_id": request_id,
        },
    )


def _check_admin(request: Request):
    """Verify admin API key for protected endpoints. Raises 401 if missing/invalid."""
    if AKIRA_ADMIN_KEY is None:
        raise HTTPException(status_code=401, detail="Admin key not configured")
    auth = request.headers.get("X-Admin-Key", "")
    if auth != AKIRA_ADMIN_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    engine = getattr(app.state, "engine", None)
    start_time = getattr(app.state, "start_time", time.time())

    mem_usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024

    return HealthResponse(
        status="healthy",
        version=AKIRA_VERSION,
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


@app.post("/extract", response_model=ExtractResult)
async def extract(request: ExtractRequest):
    """
    Extract news from URL using intelligent cascade.

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
    engine = getattr(app.state, "engine", None)
    if not engine:
        return ExtractResult(
            success=False,
            method=MethodName.JINA,
            type="article",
            duration_ms=0,
            error="Engine not initialized",
        )

    return await engine.extract(
        url=str(request.url),
        source_id=request.source_id,
        prefer_method=request.prefer_method,
        use_cache=request.use_cache,
        timeout=request.timeout,
        db_path=settings.db_path,
    )


@app.get("/")
async def root():
    """Root endpoint with API info."""
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


@app.get("/health/detailed", response_model=HealthReport)
async def health_detailed():
    """Detailed health check with full system report."""
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


@app.post("/extract/google-news", response_model=GoogleNewsResult)
async def extract_google_news(request: GoogleNewsRequest):
    """
    Extract news from Google News for a location.

    Request body:
        {
            "location_id": 103,        // Optional: query by location
            "query": "Córdoba",         // Optional: manual query
            "limit": 10,
            "country": "AR"
        }

    Returns:
        {
            "success": true,
            "method": "google_news",
            "query": "noticias Córdoba Capital Córdoba",
            "location": {"id": 103, "name": "Córdoba Capital", ...},
            "items_count": 10,
            "items": [...]
        }
    """
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

    # Build query
    location = None
    if request.location_id:
        location = google_news_service.get_location(request.location_id)
        if not location:
            return GoogleNewsResult(
                success=False,
                query="",
                items_count=0,
                items=[],
                duration_ms=0,
                error=f"Location {request.location_id} not found",
            )
        query = google_news_service.build_query(request.location_id)
    elif request.query:
        query = request.query
    else:
        return GoogleNewsResult(
            success=False,
            query="",
            items_count=0,
            items=[],
            duration_ms=0,
            error="Either location_id or query required",
        )

    # Extract using GoogleNewsExtractor
    from extractors.google_news import GoogleNewsExtractor

    extractor = GoogleNewsExtractor()
    items = await extractor.extract(query=query, country=request.country, limit=request.limit)

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


@app.post("/extract/google-news/batch", response_model=GoogleNewsBatchResult)
async def extract_google_news_batch(request: GoogleNewsBatchRequest):
    """
    Extract news from Google News for multiple locations.

    Request body:
        {
            "location_type": "ciudad",      // provincia, ciudad, pueblo
            "province_filter": "Buenos Aires",  // Optional
            "limit_per_location": 5,
            "concurrency": 3
        }

    Returns:
        {
            "success": true,
            "total_locations": 50,
            "total_items": 250,
            "results": [
                {
                    "location_id": 105,
                    "location_name": "La Plata",
                    "query": "noticias La Plata Buenos Aires",
                    "items_count": 5,
                    "items": [...]
                },
                ...
            ]
        }
    """
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

    # Get locations
    locations = google_news_service.get_locations_by_type(
        request.location_type, request.province_filter
    )

    if not locations:
        return GoogleNewsBatchResult(
            success=False,
            total_locations=0,
            total_items=0,
            results=[],
            duration_ms=0,
            error=f"No locations found for type {request.location_type}",
        )

    # Extract in parallel (with concurrency limit)
    from extractors.google_news import GoogleNewsExtractor

    semaphore = asyncio.Semaphore(request.concurrency)
    extractor = GoogleNewsExtractor()

    async def extract_location(location: dict) -> dict:
        async with semaphore:
            query = google_news_service.build_query(location["id"])
            items = await extractor.extract(query=query, country="AR", limit=request.limit_per_location)

            return {
                "location_id": location["id"],
                "location_name": location["name"],
                "query": query,
                "items_count": len(items),
                "items": [asdict(item) for item in items],
            }

    # Run all extractions concurrently
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


@app.get("/admin/method-stats", response_model=MethodStats)
async def method_statistics(_auth=Depends(_check_admin)):
    """
    Return URL-based method learning statistics.

    Shows which methods work best across all tracked sources.
    """
    method_learner = getattr(app.state, "method_learner", None)

    if not method_learner:
        return MethodStats(
            total_sources_tracked=0, circuit_open_sources=0, method_distribution={}
        )

    return MethodStats(**method_learner.get_stats())


@app.post("/admin/reset-learning")
async def reset_learning(url: Optional[str] = None, _auth=Depends(_check_admin)):
    """
    Reset method learning for specific URL or all URLs.

    Query params:
        url: Optional URL to reset. If omitted, reset all.
    """
    method_learner = getattr(app.state, "method_learner", None)

    if not method_learner:
        return {"success": False, "error": "Method learner not initialized"}

    method_learner.reset_learning(url)

    logger.info(f"method_learning_reset url={url or 'all'}")

    return {"success": True, "message": f"Learning reset for {url or 'all URLs'}"}


@app.get("/admin/method-scores")
async def get_method_scores(url: Optional[str] = None, _auth=Depends(_check_admin)):
    """Get method scores for a URL or all URLs."""
    method_scorer = getattr(app.state, "method_scorer", None)
    if not method_scorer:
        return {"scores": []}
    if url:
        scores = method_scorer.get_scores_for_url(url)
    else:
        scores = method_scorer.get_all_scores()
    return {
        "total": len(scores),
        "scores": [
            {
                "url": s.url,
                "method": s.method,
                "success_rate": s.success_rate,
                "avg_duration": s.avg_duration,
                "speed_score": s.speed_score,
                "score": s.score,
                "attempts": s.attempts,
            }
            for s in scores
        ],
    }


@app.post("/admin/reset-method-scores")
async def reset_method_scores(url: Optional[str] = None, _auth=Depends(_check_admin)):
    """Reset method scores for specific URL or all URLs."""
    method_scorer = getattr(app.state, "method_scorer", None)
    if not method_scorer:
        return {"success": False, "error": "Method scorer not initialized"}
    method_scorer.reset_scores(url)
    return {"success": True, "message": f"Scores reset for {url or 'all URLs'}"}


@app.post("/admin/recover-source", response_model=RecoveryResult)
async def recover_source(url: str, _auth=Depends(_check_admin)):
    """Attempt to recover a single failed source."""
    source_recovery = getattr(app.state, "source_recovery", None)
    if not source_recovery:
        return RecoveryResult(
            url=url,
            status=RecoveryStatus.ERROR,
            error_message="Source recovery not initialized",
        )
    result = await source_recovery.attempt_recovery(url)
    return RecoveryResult(
        url=result.url,
        status=RecoveryStatus(result.status.value),
        method_found=result.method_found,
        new_url=result.new_url,
        error_message=result.error_message,
    )


@app.post("/admin/scan-failed-sources")
async def scan_failed_sources(_auth=Depends(_check_admin)):
    """Scan all failed sources and attempt recovery."""
    source_recovery = getattr(app.state, "source_recovery", None)
    if not source_recovery:
        return {"error": "Source recovery not initialized"}
    results = await source_recovery.scan_failed_sources()
    return {
        "total": len(results),
        "recovered": sum(1 for r in results if r.status.value == "recovered"),
        "permanently_dead": sum(1 for r in results if r.status.value == "not_found"),
        "results": [
            {
                "url": r.url,
                "status": r.status.value,
                "method_found": r.method_found,
                "new_url": r.new_url,
            }
            for r in results
        ],
    }


@app.get("/admin/failed-sources")
async def get_failed_sources(_auth=Depends(_check_admin)):
    """List all sources with 5+ errors that need recovery."""
    source_recovery = getattr(app.state, "source_recovery", None)
    if not source_recovery:
        return {"sources": []}
    sources = source_recovery.get_failed_sources()
    return {"total": len(sources), "sources": sources}


@app.get("/admin/recovery-stats", response_model=RecoveryStats)
async def get_recovery_stats(_auth=Depends(_check_admin)):
    """Get recovery statistics."""
    source_recovery = getattr(app.state, "source_recovery", None)
    if not source_recovery:
        return RecoveryStats(total_failed=0, recovered=0, permanently_dead=0)
    return RecoveryStats(**source_recovery.get_recovery_stats())


@app.post("/admin/gc", response_model=GCStats)
async def garbage_collect(_auth=Depends(_check_admin)):
    """Trigger garbage collection on cache and circuit breaker."""
    gc = getattr(app.state, "gc", None)

    if not gc:
        return GCStats(
            items_collected=0,
            memory_freed_mb=0,
            last_run=None,
            duration_ms=0,
        )

    result = gc.collect_all()

    return GCStats(
        items_collected=result["total_items_collected"],
        memory_freed_mb=result["memory_freed_mb"],
        last_run=result["last_run"],
        duration_ms=result["duration_ms"],
    )


@app.post("/admin/autoheal", response_model=AutoHealResult)
async def auto_heal(_auth=Depends(_check_admin)):
    """Run auto-heal to recover from degraded state."""
    engine = getattr(app.state, "engine", None)
    health_monitor = getattr(app.state, "health_monitor", None)

    if not health_monitor:
        return AutoHealResult(
            actions_taken=[],
            success=False,
            recommendations=["Health monitor not initialized"],
        )

    result = health_monitor.auto_heal(engine)

    return AutoHealResult(
        actions_taken=result["actions_taken"],
        success=result["success"],
        recommendations=result["recommendations"],
    )


@app.get("/admin/stats")
async def admin_stats(_auth=Depends(_check_admin)):
    """Return system statistics."""
    engine = getattr(app.state, "engine", None)
    gc = getattr(app.state, "gc", None)
    health_monitor = getattr(app.state, "health_monitor", None)
    start_time = getattr(app.state, "start_time", time.time())

    mem_usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024

    stats = {
        "uptime_seconds": int(time.time() - start_time),
        "active_extractions": engine.active_extractions if engine else 0,
        "memory_mb": round(mem_usage, 1),
        "cache": {
            "hit_rate": round(engine.cache.hit_rate, 3) if engine else 0,
            "hits": engine.cache._stats.get("hits", 0) if engine else 0,
            "misses": engine.cache._stats.get("misses", 0) if engine else 0,
        },
        "circuit_breaker": engine.circuit_breaker.stats() if engine else {},
        "garbage_collector": gc.stats if gc else {},
        "extractors": [
            {"name": e.NAME, "priority": e.PRIORITY} for e in engine.extractors
        ]
        if engine
        else [],
    }

    if health_monitor:
        cache_health = health_monitor.check_cache_health()
        cb_health = health_monitor.check_circuit_breaker()
        stats["cache"]["size"] = cache_health.get("size", 0)
        stats["cache"]["stale_entries"] = cache_health.get("stale_entries", 0)

    return stats


@app.get("/metrics")
async def prometheus_metrics():
    """Prometheus-compatible metrics endpoint."""
    if not hasattr(prometheus_metrics, "_cache_hits"):
        prometheus_metrics._cache_hits = 0
        prometheus_metrics._cache_misses = 0
    engine = getattr(app.state, "engine", None)
    if engine:
        metrics.set_gauge("akira_active_extractions", engine.active_extractions)
        metrics.set_gauge("akira_cache_hit_rate", engine.cache.hit_rate)
        metrics.set_gauge(
            "akira_cache_size",
            len(engine.cache.backend._cache)
            if hasattr(engine.cache.backend, "_cache")
            else 0,
        )
        cb_stats = engine.circuit_breaker.stats()
        metrics.set_gauge(
            "akira_circuit_breaker_open", cb_stats.get("open_circuits", 0)
        )
        metrics.set_gauge(
            "akira_circuit_breaker_entries", cb_stats.get("total_entries", 0)
        )
        # Only increment by delta to avoid double-counting on repeated calls
        current_hits = engine.cache._stats.get("hits", 0)
        current_misses = engine.cache._stats.get("misses", 0)
        delta_hits = current_hits - prometheus_metrics._cache_hits
        delta_misses = current_misses - prometheus_metrics._cache_misses
        if delta_hits > 0:
            metrics.increment("akira_cache_hits", delta_hits)
        if delta_misses > 0:
            metrics.increment("akira_cache_misses", delta_misses)
        prometheus_metrics._cache_hits = current_hits
        prometheus_metrics._cache_misses = current_misses

    return (
        metrics.render(),
        200,
        {"Content-Type": "text/plain; version=0.0.4; charset=utf-8"},
    )


@app.post("/cluster")
async def cluster_news_card_ids(
    card_ids: List[str], limit: int = 100, _auth=Depends(_check_admin)
):
    """
    Cluster specific news card IDs by title similarity.

    Body:
        card_ids: List of news card IDs to cluster
        limit: Max cards to process (default 100)
    """
    clustering = getattr(app.state, "clustering_service", None)
    if not clustering:
        return {"error": "Clustering service not initialized"}

    card_ids = card_ids[:limit]
    clusters = clustering.cluster_news_cards(card_ids)
    return {
        "total": len(card_ids),
        "clusters": len(clusters),
        "cluster_map": clusters,
    }


@app.post("/cluster/recent")
async def cluster_recent_news(
    hours: int = 24, limit: int = 500, _auth=Depends(_check_admin)
):
    """
    Cluster recent unclustered news cards.

    Finds news cards from the last N hours that don't yet have a cluster_id,
    then clusters them by title similarity.
    """
    clustering = getattr(app.state, "clustering_service", None)
    if not clustering:
        return {"error": "Clustering service not initialized"}

    clusters = clustering.cluster_recent_news(hours=hours, limit=limit)
    return {
        "hours": hours,
        "limit": limit,
        "clusters": len(clusters),
        "total_cards": sum(len(v) for v in clusters.values()),
        "cluster_map": clusters,
    }


@app.get("/cluster/stats")
async def cluster_stats():
    """Get clustering statistics from the database."""
    conn = sqlite3.connect(settings.db_path)
    total = conn.execute("SELECT COUNT(*) FROM news_cards").fetchone()[0]
    clustered = conn.execute(
        "SELECT COUNT(*) FROM news_cards WHERE cluster_id IS NOT NULL AND cluster_id != ''"
    ).fetchone()[0]
    clusters = conn.execute(
        "SELECT COUNT(DISTINCT cluster_id) FROM news_cards WHERE cluster_id IS NOT NULL AND cluster_id != ''"
    ).fetchone()[0]
    avg_size = (
        conn.execute(
            "SELECT AVG(cnt) FROM (SELECT COUNT(*) as cnt FROM news_cards WHERE cluster_id IS NOT NULL AND cluster_id != '' GROUP BY cluster_id)"
        ).fetchone()[0]
        or 0
    )
    conn.close()

    return {
        "total_news": total,
        "clustered_news": clustered,
        "total_clusters": clusters,
        "clustering_rate_pct": round(clustered / total * 100, 1) if total > 0 else 0,
        "avg_cluster_size": round(avg_size, 2),
    }


@app.post("/cluster/{cluster_id}/synthesize", response_model=SynthesisResult)
async def synthesize_cluster(cluster_id: str, _auth=Depends(_check_admin)):
    """Synthesize a single cluster into a neutral master article."""
    synthesis_engine = getattr(app.state, "synthesis_engine", None)
    if not synthesis_engine:
        return {
            "master_id": "",
            "cluster_id": cluster_id,
            "title": "",
            "sources_count": 0,
            "verified_facts_count": 0,
        }

    result = synthesis_engine.synthesize_cluster(cluster_id)
    if not result:
        return {
            "master_id": "",
            "cluster_id": cluster_id,
            "title": "",
            "sources_count": 0,
            "verified_facts_count": 0,
        }

    return result


@app.post("/synthesis/batch")
async def batch_synthesize(limit: int = 100, _auth=Depends(_check_admin)):
    """Synthesize multiple clusters in batch. Runs in executor to avoid blocking event loop."""
    synthesis_engine = getattr(app.state, "synthesis_engine", None)
    if not synthesis_engine:
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, lambda: synthesis_engine.batch_synthesize(limit=limit)
    )


@app.get("/synthesis/master/{cluster_id}", response_model=MasterArticle)
async def get_master_article(cluster_id: str):
    """Get the master article for a cluster."""

    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT * FROM master_articles WHERE cluster_id = ?", (cluster_id,)
    ).fetchone()
    conn.close()

    if not row:
        return {
            "id": "",
            "cluster_id": cluster_id,
            "title": "",
            "summary": "",
            "sources_count": 0,
            "bias_min": 0,
            "bias_max": 0,
            "bias_avg": 0,
            "created_at": "",
        }

    return {
        "id": row["id"],
        "cluster_id": row["cluster_id"],
        "title": row["title"],
        "summary": row["summary"],
        "sources_count": row["sources_count"],
        "bias_min": row["bias_min"],
        "bias_max": row["bias_max"],
        "bias_avg": row["bias_avg"],
        "created_at": row["created_at"],
    }


@app.get("/synthesis/stats")
async def synthesis_stats():
    """Get synthesis statistics."""

    conn = sqlite3.connect(settings.db_path)
    total_master = conn.execute("SELECT COUNT(*) FROM master_articles").fetchone()[0]
    total_clusters = conn.execute(
        "SELECT COUNT(DISTINCT cluster_id) FROM news_cards WHERE cluster_id IS NOT NULL AND cluster_id != ''"
    ).fetchone()[0]
    avg_sources = (
        conn.execute("SELECT AVG(sources_count) FROM master_articles").fetchone()[0]
        or 0
    )
    conn.close()

    return {
        "master_articles": total_master,
        "total_clusters": total_clusters,
        "coverage_pct": round(total_master / total_clusters * 100, 1)
        if total_clusters > 0
        else 0,
        "avg_sources_per_master": round(avg_sources, 1),
    }


# ═══════════════════════════════════════════
# ANTENA API ENDPOINTS (read-only, SQLite)
# ═══════════════════════════════════════════


def get_db_connection():
    """Get SQLite connection with row factory and WAL mode for concurrent reads."""
    conn = sqlite3.connect(settings.db_path, timeout=5)
    # Enable WAL mode for better concurrent read performance
    conn.execute("PRAGMA journal_mode=WAL")
    # Reduce synchronous level for better performance (still safe with WAL)
    conn.execute("PRAGMA synchronous=NORMAL")
    # Increase cache size (negative = KB)
    conn.execute("PRAGMA cache_size=-64000")
    # Enable memory-mapped I/O
    conn.execute("PRAGMA mmap_size=268435456")
    conn.row_factory = sqlite3.Row
    conn.create_function(
        "to_ascii",
        1,
        lambda s: (
            unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode("ascii")
            if s
            else s
        ),
    )
    return conn


def resolve_source_names(source_ids_csv: str) -> list:
    """Resolve comma-separated source IDs to names."""
    if not source_ids_csv:
        return []
    conn = get_db_connection()
    ids = [int(x.strip()) for x in source_ids_csv.split(",") if x.strip().isdigit()]
    if not ids:
        conn.close()
        return []
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"SELECT id, name FROM sources WHERE id IN ({placeholders})", ids
    ).fetchall()
    conn.close()
    name_map = {row["id"]: row["name"] for row in rows}
    return [name_map.get(sid, f"Fuente {sid}") for sid in ids]


def resolve_source_urls(source_ids_csv: str) -> list:
    """Resolve comma-separated source IDs to URLs."""
    if not source_ids_csv:
        return []
    conn = get_db_connection()
    ids = [int(x.strip()) for x in source_ids_csv.split(",") if x.strip().isdigit()]
    if not ids:
        conn.close()
        return []
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"SELECT id, url FROM sources WHERE id IN ({placeholders})", ids
    ).fetchall()
    conn.close()
    url_map = {row["id"]: row["url"] for row in rows}
    return [url_map.get(sid, None) for sid in ids]


def calculate_cluster_bias(source_ids_csv: str) -> float:
    """Calculate bias from source avg_bias values.

    If sources have avg_bias populated, use their average.
    Otherwise return 0.0 (bias unknown until ANALYST pipeline runs).
    """
    if not source_ids_csv:
        return 0.0
    conn = get_db_connection()
    ids = [int(x.strip()) for x in source_ids_csv.split(",") if x.strip().isdigit()]
    if not ids:
        conn.close()
        return 0.0
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"SELECT avg_bias FROM sources WHERE id IN ({placeholders}) AND avg_bias IS NOT NULL",
        ids,
    ).fetchall()
    conn.close()
    biases = [row["avg_bias"] for row in rows if row["avg_bias"] is not None]
    if biases:
        return sum(biases) / len(biases)
    return 0.0


def get_heuristic_bias(source_ids_csv: str) -> float:
    """Fallback heuristic bias based on source reliability patterns.

    This is a temporary measure until the ANALYST pipeline provides real bias scores.
    Uses source reliability_score as a proxy (higher reliability = slight officialist tendency).
    """
    if not source_ids_csv:
        return 0.0
    conn = get_db_connection()
    ids = [int(x.strip()) for x in source_ids_csv.split(",") if x.strip().isdigit()]
    if not ids:
        conn.close()
        return 0.0
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"SELECT reliability_score FROM sources WHERE id IN ({placeholders}) AND reliability_score IS NOT NULL",
        ids,
    ).fetchall()
    conn.close()
    scores = [
        row["reliability_score"] for row in rows if row["reliability_score"] is not None
    ]
    if not scores:
        return 0.0
    avg_reliability = sum(scores) / len(scores)
    # Reliability 0.5-0.7 tends toward neutral, above 0.7 slight officialist, below 0.5 slight opposition
    if avg_reliability > 0.7:
        return 0.15  # slight officialist
    elif avg_reliability < 0.5:
        return -0.15  # slight opposition
    return 0.0


def _batch_resolve_sources(rows: List) -> List[dict]:
    """Batch-resolve source names, URLs, and biases for news card rows.

    Returns a list of dicts with keys: names, urls, bias_score, sources_count.
    One dict per row, in the same order.
    """
    # Collect all unique source IDs
    all_ids = set()
    source_id_lists = []
    for row in rows:
        source_ids = row["source_ids"] or ""
        ids = [int(x.strip()) for x in source_ids.split(",") if x.strip().isdigit()]
        source_id_lists.append(ids)
        all_ids.update(ids)

    if not all_ids:
        return [
            {"names": [], "urls": [], "bias_score": 0.0, "sources_count": 0}
            for _ in rows
        ]

    conn = get_db_connection()
    placeholders = ",".join("?" * len(all_ids))
    db_rows = conn.execute(
        f"SELECT id, name, url, avg_bias, reliability_score FROM sources WHERE id IN ({placeholders})",
        list(all_ids),
    ).fetchall()
    conn.close()

    sources_by_id = {row["id"]: row for row in db_rows}

    results = []
    for ids in source_id_lists:
        if not ids:
            results.append(
                {"names": [], "urls": [], "bias_score": 0.0, "sources_count": 0}
            )
            continue

        names = []
        urls = []
        biases = []
        reliability_scores = []

        for sid in ids:
            src = sources_by_id.get(sid)
            if src:
                names.append(src["name"])
                urls.append(src["url"])
                if src["avg_bias"] is not None:
                    biases.append(src["avg_bias"])
                if src["reliability_score"] is not None:
                    reliability_scores.append(src["reliability_score"])

        bias_score = 0.0
        if biases:
            bias_score = sum(biases) / len(biases)
        elif reliability_scores:
            avg_rel = sum(reliability_scores) / len(reliability_scores)
            if avg_rel > 0.7:
                bias_score = 0.15
            elif avg_rel < 0.5:
                bias_score = -0.15

        results.append(
            {
                "names": names,
                "urls": urls,
                "bias_score": bias_score,
                "sources_count": len(ids),
            }
        )

    return results


def format_news_card(row, source_resolve: dict = None) -> dict:
    """Format a news card row for the API response."""
    source_ids = row["source_ids"] or ""
    ids = [int(x.strip()) for x in source_ids.split(",") if x.strip().isdigit()]

    if source_resolve:
        sr = source_resolve
    else:
        # Fallback to old per-card queries
        sr = {
            "names": resolve_source_names(source_ids),
            "urls": resolve_source_urls(source_ids),
            "bias_score": row["bias_score"] or 0.0,
            "sources_count": len(ids) or 1,
        }
        if sr["bias_score"] == 0.0:
            sr["bias_score"] = calculate_cluster_bias(source_ids)
            if sr["bias_score"] == 0.0:
                sr["bias_score"] = get_heuristic_bias(source_ids)

    return {
        "id": row["id"],
        "location_id": row["location_id"],
        "title": row["title"],
        "summary": row["summary"],
        "body": row["body"] if "body" in row.keys() and row["body"] else row["summary"],
        "image_url": row["image_url"],
        "bias_score": sr["bias_score"],
        "is_gacetilla": row["is_gacetilla"] or 0,
        "cluster_id": row["cluster_id"],
        "category": row["category"],
        "source_ids": source_ids,
        "source_names": sr["names"][:3],
        "source_name": sr["names"][0] if sr["names"] else None,
        "source_url": sr["urls"][0] if sr["urls"] else None,
        "location_name": row["location_name"] if "location_name" in row.keys() else None,
        "location_province": row["location_province"] if "location_province" in row.keys() else None,
        "published_at": row["published_at"],
        "created_at": row["created_at"],
        "sources_count": sr["sources_count"],
        "quality_score": row["quality_score"]
        if "quality_score" in row.keys()
        else None,
    }


@app.get("/api/news/feed")
async def get_news_feed(
    category: str = None,
    location_id: int = None,
    bias: str = None,  # 'officialist', 'opposition', 'neutral'
    time: str = None,  # 'hour', 'today', 'week', or None for all
    min_quality: float = Query(default=None, ge=0, le=1),  # minimum quality score filter
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """Paginated news feed with filters."""
    conn = get_db_connection()

    query = """
        SELECT nc.*, l.name as location_name, l.province as location_province
        FROM news_cards nc
        LEFT JOIN locations l ON l.id = nc.location_id
        WHERE 1=1
    """
    params = []

    # Time filter — server-side so pagination works correctly
    if time == 'hour':
        query += " AND nc.created_at >= datetime('now', '-1 hour')"
    elif time == 'today':
        query += " AND nc.created_at >= datetime('now', '-1 day')"
    elif time == 'week':
        query += " AND nc.created_at >= datetime('now', '-7 days')"
    # 'all' or None: no additional time constraint

    if category:
        cat_normalized = (
            unicodedata.normalize("NFD", category.lower())
            .encode("ascii", "ignore")
            .decode("ascii")
        )
        cat_normalized = cat_normalized.replace("-", " ")
        query += " AND LOWER(to_ascii(nc.category)) = ?"
        params.append(cat_normalized)
    if location_id:
        query += " AND nc.location_id = ?"
        params.append(location_id)
    if bias == "officialist":
        query += " AND nc.bias_score > 0.1"
    elif bias == "opposition":
        query += " AND nc.bias_score < -0.1"
    elif bias == "neutral":
        query += " AND nc.bias_score BETWEEN -0.1 AND 0.1"

    # Quality filter — min_quality parameter (0.0 to 1.0)
    # NULL quality_score means unscored — include them (COALESCE treats NULL as 0, which passes low thresholds)
    if min_quality is not None:
        query += " AND COALESCE(nc.quality_score, 0) >= ?"
        params.append(min_quality)

    count_query = query.replace(
        "SELECT nc.*, l.name as location_name, l.province as location_province",
        "SELECT COUNT(*) as count",
    )
    total = conn.execute(count_query, params).fetchone()["count"]

    query += " ORDER BY nc.created_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    rows = conn.execute(query, params).fetchall()
    conn.close()

    # Batch-resolve all source data in a single query
    source_resolve_list = _batch_resolve_sources(rows)

    news = [format_news_card(row, sr) for row, sr in zip(rows, source_resolve_list)]

    return {
        "news": news,
        "total": total,
        "page": (offset // limit) + 1 if limit > 0 else 1,
        "per_page": limit,
        "location": None,
        "category": category,
        "bias": bias,
    }


@app.get("/api/news/blindspot")
async def get_blindspot(
    limit: int = Query(default=10, ge=1, le=50),
):
    """Stories covered by only one side of the political spectrum — 'blindspots'."""
    conn = get_db_connection()

    rows = conn.execute("""
        SELECT nc.cluster_id,
               nc.title,
               nc.summary,
               nc.category,
               nc.image_url,
               nc.bias_score,
               nc.published_at,
               nc.created_at,
               nc.source_ids,
               l.name as location_name,
               l.province as location_province,
               COUNT(*) as source_count,
               SUM(CASE WHEN nc.bias_score > 0.1 THEN 1 ELSE 0 END) as officialist_count,
               SUM(CASE WHEN nc.bias_score < -0.1 THEN 1 ELSE 0 END) as opposition_count
        FROM news_cards nc
        LEFT JOIN locations l ON l.id = nc.location_id
        WHERE nc.cluster_id IS NOT NULL AND nc.cluster_id != ''
          AND nc.bias_score IS NOT NULL
        GROUP BY nc.cluster_id
        HAVING (SUM(CASE WHEN nc.bias_score > 0.1 THEN 1 ELSE 0 END) >= 3
                AND SUM(CASE WHEN nc.bias_score < -0.1 THEN 1 ELSE 0 END) = 0)
            OR (SUM(CASE WHEN nc.bias_score < -0.1 THEN 1 ELSE 0 END) >= 3
                AND SUM(CASE WHEN nc.bias_score > 0.1 THEN 1 ELSE 0 END) = 0)
        ORDER BY MAX(nc.created_at) DESC
        LIMIT ?
    """, (limit,)).fetchall()

    conn.close()

    results = []
    for row in rows:
        source_ids = row["source_ids"] or ""
        source_names = resolve_source_names(source_ids)
        is_officialist_only = row["opposition_count"] == 0

        results.append({
            "cluster_id": row["cluster_id"],
            "title": row["title"],
            "summary": row["summary"],
            "category": row["category"],
            "image_url": row["image_url"],
            "bias_score": row["bias_score"],
            "published_at": row["published_at"],
            "created_at": row["created_at"],
            "location_name": row["location_name"],
            "location_province": row["location_province"],
            "source_names": source_names[:3],
            "source_count": row["source_count"],
            "officialist_count": row["officialist_count"],
            "opposition_count": row["opposition_count"],
            "bias_type": "Solo oficialista" if is_officialist_only else "Solo opositor",
        })

    return {
        "items": results,
        "total": len(results),
    }


@app.get("/api/news/{news_id}")
async def get_news_by_id(news_id: str):
    """Single news card by ID."""
    conn = get_db_connection()
    row = conn.execute(
        """
        SELECT nc.*, l.name as location_name, l.province as location_province
        FROM news_cards nc
        LEFT JOIN locations l ON l.id = nc.location_id
        WHERE nc.id = ?
    """,
        (news_id,),
    ).fetchone()
    conn.close()

    if not row:
        return {"error": "Not found"}

    card = format_news_card(row)
    card["location_name"] = row["location_name"]
    card["location_province"] = row["location_province"]
    return card


@app.get("/api/news/{news_id}/cluster")
async def get_news_cluster(news_id: str):
    """All news cards in the same cluster."""
    conn = get_db_connection()

    news_row = conn.execute(
        "SELECT cluster_id FROM news_cards WHERE id = ?", (news_id,)
    ).fetchone()
    if not news_row or not news_row["cluster_id"]:
        conn.close()
        return {"error": "Not found or no cluster"}

    cluster_id = news_row["cluster_id"]

    rows = conn.execute(
        """
        SELECT nc.*, l.name as location_name, l.province as location_province
        FROM news_cards nc
        LEFT JOIN locations l ON l.id = nc.location_id
        WHERE nc.cluster_id = ?
        ORDER BY nc.created_at DESC
    """,
        (cluster_id,),
    ).fetchall()
    conn.close()

    news = []
    for row in rows:
        card = format_news_card(row)
        card["location_name"] = row["location_name"]
        card["location_province"] = row["location_province"]
        news.append(card)

    return {
        "cluster_id": cluster_id,
        "news": news,
    }


@app.get("/api/locations")
async def get_locations():
    """All locations from the locations table."""
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT * FROM locations ORDER BY type, province, name"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/locations/tree")
async def get_locations_tree():
    """All locations ordered by type, province, name."""
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT * FROM locations ORDER BY type, province, name"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/categories")
async def get_categories():
    """All categories with icons."""
    category_icons = {
        "generales": "article",
        "sociedad": "groups",
        "deportes": "sports_soccer",
        "tecnología": "devices",
        "judiciales": "gavel",
        "política": "gavel",
        "internacional": "public",
        "economía": "trending_up",
        "culturales": "theater_comedy",
    }

    conn = get_db_connection()
    rows = conn.execute("""
        SELECT DISTINCT category, COUNT(*) as count
        FROM news_cards
        WHERE category IS NOT NULL AND category != ''
        GROUP BY category
        ORDER BY count DESC
    """).fetchall()
    conn.close()

    categories = []
    for i, row in enumerate(rows):
        cat_name = row["category"]
        slug = (
            unicodedata.normalize("NFD", cat_name.lower())
            .encode("ascii", "ignore")
            .decode("ascii")
        )
        slug = slug.replace(" ", "-")
        categories.append(
            {
                "id": i + 1,
                "slug": slug,
                "name": cat_name.capitalize(),
                "icon": category_icons.get(cat_name.lower(), "article"),
            }
        )

    return categories


@app.get("/api/stats/health")
async def get_stats_health():
    """Pipeline health stats."""
    conn = get_db_connection()

    total_news = conn.execute("SELECT COUNT(*) as count FROM news_cards").fetchone()[
        "count"
    ]
    active_sources = conn.execute(
        "SELECT COUNT(*) as count FROM sources WHERE is_active = 1"
    ).fetchone()["count"]
    total_locations = conn.execute(
        "SELECT COUNT(*) as count FROM locations"
    ).fetchone()["count"]
    news_last_hour = conn.execute(
        "SELECT COUNT(*) as count FROM news_cards WHERE created_at > datetime('now', '-1 hour')"
    ).fetchone()["count"]

    conn.close()

    return {
        "status": "ok",
        "stats": {
            "total_news": total_news,
            "active_sources": active_sources,
            "total_locations": total_locations,
            "news_last_hour": news_last_hour,
        },
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


@app.get("/api/sources")
async def get_sources():
    """List all active sources with bias info."""
    conn = get_db_connection()
    rows = conn.execute("""
        SELECT id, name, url, domain, avg_bias, news_count, is_active, reliability_score
        FROM sources
        WHERE is_active = 1
        ORDER BY news_count DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/sources/{source_id}/profile")
async def get_source_profile(source_id: int):
    """Source bias profile with recent bias history."""
    conn = get_db_connection()

    source = conn.execute(
        "SELECT * FROM sources WHERE id = ?", (source_id,)
    ).fetchone()

    if not source:
        conn.close()
        return {"error": "Source not found"}

    bias_history = conn.execute("""
        SELECT DATE(created_at) as day,
               AVG(bias_score) as avg_bias,
               COUNT(*) as article_count
        FROM news_cards
        WHERE source_ids LIKE '%' || ? || '%'
          AND bias_score IS NOT NULL
          AND created_at > datetime('now', '-30 days')
        GROUP BY DATE(created_at)
        ORDER BY day DESC
    """, (str(source_id),)).fetchall()

    conn.close()

    return {
        "id": source["id"],
        "name": source["name"],
        "url": source["url"],
        "domain": source["domain"],
        "avg_bias": source["avg_bias"],
        "reliability_score": source["reliability_score"],
        "news_count": source["news_count"],
        "is_active": source["is_active"],
        "bias_history": [
            {"day": r["day"], "avg_bias": r["avg_bias"], "article_count": r["article_count"]}
            for r in bias_history
        ] if bias_history else [],
    }


# ═══════════════════════════════════════════
# ADMIN DASHBOARD ENDPOINTS
# ═══════════════════════════════════════════


@app.get("/admin/dashboard")
async def admin_dashboard(_auth=Depends(_check_admin)):
    """Full system dashboard — all key metrics in one call."""
    conn = sqlite3.connect(settings.db_path)

    # Core stats
    total_sources = conn.execute(
        "SELECT COUNT(*) FROM sources WHERE is_active = 1"
    ).fetchone()[0]
    total_news = conn.execute("SELECT COUNT(*) FROM news_cards").fetchone()[0]
    total_locations = conn.execute("SELECT COUNT(*) FROM locations").fetchone()[0]
    total_seen_urls = conn.execute("SELECT COUNT(*) FROM seen_urls").fetchone()[0]
    total_master = conn.execute("SELECT COUNT(*) FROM master_articles").fetchone()[0]
    total_clusters = conn.execute(
        "SELECT COUNT(DISTINCT cluster_id) FROM news_cards WHERE cluster_id IS NOT NULL AND cluster_id != ''"
    ).fetchone()[0]

    # Source health
    healthy = conn.execute(
        "SELECT COUNT(*) FROM sources s JOIN source_health h ON s.id = h.source_id WHERE s.is_active = 1 AND h.consecutive_failures < 3"
    ).fetchone()[0]
    degraded = conn.execute(
        "SELECT COUNT(*) FROM sources s JOIN source_health h ON s.id = h.source_id WHERE s.is_active = 1 AND h.consecutive_failures BETWEEN 3 AND 4"
    ).fetchone()[0]
    failed = conn.execute(
        "SELECT COUNT(*) FROM sources s JOIN source_health h ON s.id = h.source_id WHERE s.is_active = 1 AND h.consecutive_failures >= 5"
    ).fetchone()[0]

    # Bias distribution
    bias_dist = conn.execute("""
        SELECT 
            CASE 
                WHEN bias_score < -0.5 THEN 'strong_opposition'
                WHEN bias_score < -0.1 THEN 'mild_opposition'
                WHEN bias_score <= 0.1 THEN 'neutral'
                WHEN bias_score < 0.5 THEN 'mild_officialist'
                ELSE 'strong_officialist'
            END as bucket,
            COUNT(*) as count
        FROM news_cards
        WHERE bias_score IS NOT NULL
        GROUP BY bucket
    """).fetchall()

    # Quality distribution
    quality_dist = conn.execute("""
        SELECT 
            CASE 
                WHEN quality_score >= 0.7 THEN 'high'
                WHEN quality_score >= 0.4 THEN 'medium'
                WHEN quality_score >= 0.2 THEN 'low'
                ELSE 'very_low'
            END as bucket,
            COUNT(*) as count
        FROM news_cards
        WHERE quality_score IS NOT NULL
        GROUP BY bucket
    """).fetchall()

    conn.close()

    return {
        "sources": {
            "total": total_sources,
            "healthy": healthy,
            "degraded": degraded,
            "failed": failed,
        },
        "content": {
            "news_cards": total_news,
            "master_articles": total_master,
            "clusters": total_clusters,
            "locations": total_locations,
            "seen_urls": total_seen_urls,
        },
        "bias_distribution": {row[0]: row[1] for row in bias_dist},
        "quality_distribution": {row[0]: row[1] for row in quality_dist},
        "uptime_seconds": int(
            time.time() - getattr(app.state, "start_time", time.time())
        ),
    }


@app.get("/admin/failed-sources-detail")
async def failed_sources_detail(_auth=Depends(_check_admin)):
    """Detailed list of failed/degraded sources with recovery suggestions."""
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row

    # Failed sources (5+ consecutive failures)
    failed = conn.execute("""
        SELECT s.id, s.name, s.url, s.domain, s.last_fetch, s.fetch_count, s.error_count,
               h.consecutive_failures, h.last_success_method, h.is_circuit_open
        FROM sources s
        JOIN source_health h ON s.id = h.source_id
        WHERE s.is_active = 1 AND h.consecutive_failures >= 5
        ORDER BY h.consecutive_failures DESC
        LIMIT 50
    """).fetchall()

    # Degraded sources (3-4 failures)
    degraded = conn.execute("""
        SELECT s.id, s.name, s.url, s.domain, s.last_fetch, s.fetch_count, s.error_count,
               h.consecutive_failures, h.last_success_method, h.is_circuit_open
        FROM sources s
        JOIN source_health h ON s.id = h.source_id
        WHERE s.is_active = 1 AND h.consecutive_failures BETWEEN 3 AND 4
        ORDER BY h.consecutive_failures DESC
        LIMIT 50
    """).fetchall()

    conn.close()

    return {
        "failed": [dict(r) for r in failed],
        "degraded": [dict(r) for r in degraded],
        "total_failed": len(failed),
        "total_degraded": len(degraded),
    }


@app.get("/admin/image-stats")
async def image_stats(_auth=Depends(_check_admin)):
    """Image extraction statistics."""
    conn = sqlite3.connect(settings.db_path)
    total = conn.execute("SELECT COUNT(*) FROM news_cards").fetchone()[0]
    with_image = conn.execute(
        "SELECT COUNT(*) FROM news_cards WHERE image_url IS NOT NULL AND image_url != ''"
    ).fetchone()[0]
    conn.close()

    return {
        "total_news": total,
        "with_image": with_image,
        "without_image": total - with_image,
        "image_coverage_pct": round(with_image / total * 100, 1) if total > 0 else 0,
    }
