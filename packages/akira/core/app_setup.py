"""AKIRA app setup: lifespan + middleware + exception handlers.

Owns the bootstrapping of all long-lived services (engine, cache,
circuit breaker, GC, synthesis, clustering, browser pool, etc.) and
their graceful shutdown. Extracted from main.py so main.py can be a
thin shim that just composes the FastAPI app.

JSONFormatter + _gc_loop + lifespan + _check_admin all live here.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from config import settings
from core.browser_pool import BrowserPool
from core.cache import CacheManager, MemoryBackend
from core.circuit_breaker import CircuitBreaker
from core.clustering import ClusteringService
from core.engine import ExtractionEngine
from core.garbage_collector import GarbageCollector
from core.health_monitor import HealthMonitor
from core.http_client import HTTPClient
from core.method_learner import MethodLearner
from core.method_scorer import MethodScorer
from core.rate_limiter import RateLimiter
from core.source_recovery import SourceRecovery
from core.synthesis import SynthesisEngine
from services.google_news_service import GoogleNewsService


GC_INTERVAL = 300  # 5 minutes
AKIRA_VERSION = "4.0.0"

logger = logging.getLogger("akira")


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


async def _gc_loop(
    gc,
    method_learner=None,
    method_scorer=None,
    clustering_service=None,
):
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
                    clusters = clustering_service.cluster_recent_news(
                        hours=24, limit=500
                    )
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
    """Application lifespan - setup and teardown.

    Initializes all long-lived services (engine, cache, GC, synthesis,
    clustering, browser pool, etc.) on startup and tears them down on
    shutdown. The order of shutdown is the reverse of initialization.
    """
    start_time = time.time()
    app.state.start_time = start_time

    # Initialize Google News Service.
    # Derive locations.db from settings.db_path so it lives alongside
    # akira.db (the canonical dir) and honors AKIRA_DB_PATH overrides.
    akira_db_path = settings.db_path
    data_dir = Path(akira_db_path).parent
    os.makedirs(data_dir, exist_ok=True)

    locations_db_path = str(data_dir / "locations.db")
    google_news_service = GoogleNewsService(locations_db_path)
    app.state.google_news_service = google_news_service

    # Initialize Method Learner, Scorer, Source Recovery
    method_learner = MethodLearner(akira_db_path)
    app.state.method_learner = method_learner

    method_scorer = MethodScorer(akira_db_path)
    app.state.method_scorer = method_scorer

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

    # Initialize extraction infrastructure
    cache = CacheManager(MemoryBackend(maxsize=settings.cache_max_size))
    rate_limiter = RateLimiter(delay=settings.request_delay)
    circuit_breaker = CircuitBreaker(
        threshold=settings.circuit_breaker_threshold,
        timeout=settings.circuit_breaker_timeout,
    )

    # Lazy imports — these extractors pull in optional heavy deps.
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
    gc_task = asyncio.create_task(
        _gc_loop(gc, method_learner, method_scorer, clustering_service)
    )
    app.state.gc_task = gc_task

    logger.info(f"AKIRA started on {settings.host}:{settings.port}")

    yield

    # ---- Graceful shutdown ----
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

    # Close services that hold DB connections
    google_news_service.close()
    method_learner.close()
    method_scorer.close()
    source_recovery.close()

    # Run final GC
    gc.collect_all()

    logger.info("AKIRA shutdown complete")


# Imported here to avoid circular import at top of file
from extractors.rss import RSSExtractor
from extractors.wordpress import WordPressExtractor
from extractors.goose import GooseExtractor
from extractors.sitemap import SitemapExtractor
from extractors.playwright import PlaywrightExtractor
from extractors.jina import JinaExtractor
from extractors.video import VideoExtractor
from extractors.social import SocialExtractor


def build_app(akira_version: str = "4.0.0", akira_admin_key: str | None = None) -> FastAPI:
    """Construct the FastAPI app with lifespan + middleware + exception handler.

    Routes are added separately via app.include_router() in main.py.
    """
    app = FastAPI(
        title="AKIRA",
        description="PULSO Extraction Engine for Argentine news",
        version=akira_version,
        lifespan=lifespan,
    )
    app.state.akira_admin_key = akira_admin_key
    return app


def check_admin(request: Request) -> None:
    """Verify admin API key. Raises 401 if missing/invalid.

    Wired into route dependencies via Depends(check_admin).
    """
    key = getattr(request.app.state, "akira_admin_key", None)
    if key is None:
        raise HTTPException(status_code=401, detail="Admin key not configured")
    auth = request.headers.get("X-Admin-Key", "")
    if auth != key:
        raise HTTPException(status_code=401, detail="Unauthorized")


def setup_logging_json() -> None:
    """Replace the root logger's formatter with JSONFormatter.

    Idempotent: safe to call multiple times (only sets once).
    """
    root = logging.getLogger()
    for handler in root.handlers:
        if isinstance(handler.formatter, JSONFormatter):
            return
    for handler in root.handlers:
        handler.setFormatter(JSONFormatter())


def request_id_middleware_factory():
    """Returns the request_id_middleware ASGI function."""
    async def request_id_middleware(request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
    return request_id_middleware


def global_exception_handler_factory():
    """Returns the exception handler."""
    async def global_exception_handler(request: Request, exc: Exception):
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
    return global_exception_handler