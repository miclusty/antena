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
from db.connection import get_db_connection
from services.feed_service import format_news_card
from services.source_resolver import (
    _batch_resolve_sources,
    resolve_source_names,
)


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
    from extractors.trafilatura import TrafilaturaExtractor

    extractors = [
        RSSExtractor,
        WordPressExtractor,
        TrafilaturaExtractor,  # Replaces broken NewspaperExtractor
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

# Mount route modules. Routes are defined in packages/akira/routes/* and
# registered here. Future PRs will add: routes/sources, routes/radios,
# routes/extraction, routes/synthesis, routes/admin.
from routes import feed as feed_routes  # noqa: E402
from routes import categories as categories_routes  # noqa: E402
from routes import locations as locations_routes  # noqa: E402
from routes import sources as sources_routes  # noqa: E402
from routes import radios as radios_routes  # noqa: E402
from routes import extraction as extraction_routes  # noqa: E402
from routes import synthesis as synthesis_routes  # noqa: E402
app.include_router(feed_routes.router)
app.include_router(categories_routes.router)
app.include_router(locations_routes.router)
app.include_router(sources_routes.router)
app.include_router(radios_routes.router)
app.include_router(extraction_routes.router)
app.include_router(synthesis_routes.router)

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


@app.get("/api/stats/health")
async def get_stats_health():
    """Pipeline health stats."""
    with get_db_connection() as conn:
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
        ).fetchone()["count"]  # noqa: E501

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


# ═══════════════════════════════════════════
# ADMIN DASHBOARD ENDPOINTS
# ═══════════════════════════════════════════


@app.get("/admin/dashboard")
async def admin_dashboard(_auth=Depends(_check_admin)):
    """Full system dashboard — all key metrics in one call."""
    with get_db_connection() as conn:
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
    with get_db_connection() as conn:
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

    return {
        "failed": [dict(r) for r in failed],
        "degraded": [dict(r) for r in degraded],
        "total_failed": len(failed),
        "total_degraded": len(degraded),
    }


@app.get("/admin/image-stats")
async def image_stats(_auth=Depends(_check_admin)):
    """Image extraction statistics."""
    with get_db_connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM news_cards").fetchone()[0]
        with_image = conn.execute(
            "SELECT COUNT(*) FROM news_cards WHERE image_url IS NOT NULL AND image_url != ''"
        ).fetchone()[0]

    return {
        "total_news": total,
        "with_image": with_image,
        "without_image": total - with_image,
        "image_coverage_pct": round(with_image / total * 100, 1) if total > 0 else 0,
    }
