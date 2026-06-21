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
from routes import admin as admin_routes  # noqa: E402
from routes import stats as stats_routes  # noqa: E402
app.include_router(feed_routes.router)
app.include_router(categories_routes.router)
app.include_router(locations_routes.router)
app.include_router(sources_routes.router)
app.include_router(radios_routes.router)
app.include_router(extraction_routes.router)
app.include_router(synthesis_routes.router)
app.include_router(admin_routes.router)
app.include_router(stats_routes.router)

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


