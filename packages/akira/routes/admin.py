"""Admin routes.

Operational endpoints for monitoring and managing AKIRA's internals.
All endpoints require admin auth via X-Admin-Key header.
  - GET    /admin/method-stats         — method learning stats
  - POST   /admin/reset-learning       — reset method learning
  - GET    /admin/method-scores        — per-method success scores
  - POST   /admin/reset-method-scores  — reset scores
  - POST   /admin/recover-source       — recover one source
  - POST   /admin/scan-failed-sources  — recover all failed sources
  - GET    /admin/failed-sources       — list failed sources
  - GET    /admin/recovery-stats       — recovery stats
  - POST   /admin/gc                   — trigger garbage collection
  - POST   /admin/autoheal             — auto-heal degraded state
  - GET    /admin/stats                — system statistics
  - GET    /metrics                     — Prometheus-format metrics

Plus admin dashboard (heavier aggregations):
  - GET    /admin/dashboard
  - GET    /admin/failed-sources-detail
  - GET    /admin/image-stats
"""
from __future__ import annotations

import logging
import resource
import time
from typing import Optional

from fastapi import APIRouter, Depends, Request

from core.metrics import metrics
from db.connection import get_db_connection
from models.schemas import (
    AutoHealResult,
    GCStats,
    MethodStats,
    RecoveryResult,
    RecoveryStats,
    RecoveryStatus,
)

logger = logging.getLogger("akira")

router = APIRouter(tags=["admin"])


# Stub auth — real auth wired in main.py shim.
def _check_admin_stub():
    pass


# Counter state for /metrics deltas (was a module-level side-effect in main.py).
_metrics_state: dict = {"_cache_hits": 0, "_cache_misses": 0}


@router.get("/admin/method-stats", response_model=MethodStats)
async def method_statistics(
    request: Request, _auth=Depends(_check_admin_stub)
):
    """Return URL-based method learning statistics."""
    method_learner = getattr(request.app.state, "method_learner", None)

    if not method_learner:
        return MethodStats(
            total_sources_tracked=0, circuit_open_sources=0, method_distribution={}
        )

    return MethodStats(**method_learner.get_stats())


@router.post("/admin/reset-learning")
async def reset_learning(
    request: Request,
    url: Optional[str] = None,
    _auth=Depends(_check_admin_stub),
):
    """Reset method learning for specific URL or all URLs (omit url to reset all)."""
    method_learner = getattr(request.app.state, "method_learner", None)

    if not method_learner:
        return {"success": False, "error": "Method learner not initialized"}

    method_learner.reset_learning(url)

    logger.info(f"method_learning_reset url={url or 'all'}")

    return {"success": True, "message": f"Learning reset for {url or 'all URLs'}"}


@router.get("/admin/method-scores")
async def get_method_scores(
    request: Request,
    url: Optional[str] = None,
    _auth=Depends(_check_admin_stub),
):
    """Get method scores for a URL or all URLs."""
    method_scorer = getattr(request.app.state, "method_scorer", None)
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


@router.post("/admin/reset-method-scores")
async def reset_method_scores(
    request: Request,
    url: Optional[str] = None,
    _auth=Depends(_check_admin_stub),
):
    """Reset method scores for specific URL or all URLs."""
    method_scorer = getattr(request.app.state, "method_scorer", None)
    if not method_scorer:
        return {"success": False, "error": "Method scorer not initialized"}
    method_scorer.reset_scores(url)
    return {"success": True, "message": f"Scores reset for {url or 'all URLs'}"}


@router.post("/admin/recover-source", response_model=RecoveryResult)
async def recover_source(
    request: Request, url: str, _auth=Depends(_check_admin_stub)
):
    """Attempt to recover a single failed source."""
    source_recovery = getattr(request.app.state, "source_recovery", None)
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


@router.post("/admin/scan-failed-sources")
async def scan_failed_sources(request: Request, _auth=Depends(_check_admin_stub)):
    """Scan all failed sources and attempt recovery."""
    source_recovery = getattr(request.app.state, "source_recovery", None)
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


@router.get("/admin/failed-sources")
async def get_failed_sources(request: Request, _auth=Depends(_check_admin_stub)):
    """List all sources with 5+ errors that need recovery."""
    source_recovery = getattr(request.app.state, "source_recovery", None)
    if not source_recovery:
        return {"sources": []}
    sources = source_recovery.get_failed_sources()
    return {"total": len(sources), "sources": sources}


@router.get("/admin/recovery-stats", response_model=RecoveryStats)
async def get_recovery_stats(request: Request, _auth=Depends(_check_admin_stub)):
    """Get recovery statistics."""
    source_recovery = getattr(request.app.state, "source_recovery", None)
    if not source_recovery:
        return RecoveryStats(total_failed=0, recovered=0, permanently_dead=0)
    return RecoveryStats(**source_recovery.get_recovery_stats())


@router.post("/admin/gc", response_model=GCStats)
async def garbage_collect(request: Request, _auth=Depends(_check_admin_stub)):
    """Trigger garbage collection on cache and circuit breaker."""
    gc = getattr(request.app.state, "gc", None)

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


@router.post("/admin/autoheal", response_model=AutoHealResult)
async def auto_heal(request: Request, _auth=Depends(_check_admin_stub)):
    """Run auto-heal to recover from degraded state."""
    engine = getattr(request.app.state, "engine", None)
    health_monitor = getattr(request.app.state, "health_monitor", None)

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


@router.get("/admin/stats")
async def admin_stats(request: Request, _auth=Depends(_check_admin_stub)):
    """Return system statistics (memory, cache, circuit breaker, extractors)."""
    engine = getattr(request.app.state, "engine", None)
    gc = getattr(request.app.state, "gc", None)
    health_monitor = getattr(request.app.state, "health_monitor", None)
    start_time = getattr(request.app.state, "start_time", time.time())

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


@router.get("/metrics")
async def prometheus_metrics(request: Request):
    """Prometheus-compatible metrics endpoint.

    Uses module-level _metrics_state to compute deltas since last call (avoids
    double-counting on repeated scrapes).
    """
    engine = getattr(request.app.state, "engine", None)
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
        current_hits = engine.cache._stats.get("hits", 0)
        current_misses = engine.cache._stats.get("misses", 0)
        delta_hits = current_hits - _metrics_state["_cache_hits"]
        delta_misses = current_misses - _metrics_state["_cache_misses"]
        if delta_hits > 0:
            metrics.increment("akira_cache_hits", delta_hits)
        if delta_misses > 0:
            metrics.increment("akira_cache_misses", delta_misses)
        _metrics_state["_cache_hits"] = current_hits
        _metrics_state["_cache_misses"] = current_misses

    return (
        metrics.render(),
        200,
        {"Content-Type": "text/plain; version=0.0.4; charset=utf-8"},
    )


@router.get("/admin/dashboard")
async def admin_dashboard(request: Request, _auth=Depends(_check_admin_stub)):
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
            "SELECT COUNT(DISTINCT cluster_id) FROM news_cards "
            "WHERE cluster_id IS NOT NULL AND cluster_id != ''"
        ).fetchone()[0]

        # Source health
        healthy = conn.execute(
            "SELECT COUNT(*) FROM sources s JOIN source_health h ON s.id = h.source_id "
            "WHERE s.is_active = 1 AND h.consecutive_failures < 3"
        ).fetchone()[0]
        degraded = conn.execute(
            "SELECT COUNT(*) FROM sources s JOIN source_health h ON s.id = h.source_id "
            "WHERE s.is_active = 1 AND h.consecutive_failures BETWEEN 3 AND 4"
        ).fetchone()[0]
        failed = conn.execute(
            "SELECT COUNT(*) FROM sources s JOIN source_health h ON s.id = h.source_id "
            "WHERE s.is_active = 1 AND h.consecutive_failures >= 5"
        ).fetchone()[0]

        # Bias distribution
        bias_dist = conn.execute(
            """
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
            """
        ).fetchall()

        # Quality distribution
        quality_dist = conn.execute(
            """
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
            """
        ).fetchall()

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
            time.time() - getattr(request.app.state, "start_time", time.time())
        ),
    }


@router.get("/admin/failed-sources-detail")
async def failed_sources_detail(request: Request, _auth=Depends(_check_admin_stub)):
    """Detailed list of failed/degraded sources with recovery suggestions."""
    with get_db_connection() as conn:
        conn.row_factory = None
        failed = conn.execute(
            """
            SELECT s.id, s.name, s.url, s.domain, s.last_fetch, s.fetch_count, s.error_count,
                   h.consecutive_failures, h.last_success_method, h.is_circuit_open
            FROM sources s
            JOIN source_health h ON s.id = h.source_id
            WHERE s.is_active = 1 AND h.consecutive_failures >= 5
            ORDER BY h.consecutive_failures DESC
            LIMIT 50
            """
        ).fetchall()
        degraded = conn.execute(
            """
            SELECT s.id, s.name, s.url, s.domain, s.last_fetch, s.fetch_count, s.error_count,
                   h.consecutive_failures, h.last_success_method, h.is_circuit_open
            FROM sources s
            JOIN source_health h ON s.id = h.source_id
            WHERE s.is_active = 1 AND h.consecutive_failures BETWEEN 3 AND 4
            ORDER BY h.consecutive_failures DESC
            LIMIT 50
            """
        ).fetchall()

    return {
        "failed": [dict(r) for r in failed],
        "degraded": [dict(r) for r in degraded],
        "total_failed": len(failed),
        "total_degraded": len(degraded),
    }


@router.get("/admin/image-stats")
async def image_stats(request: Request, _auth=Depends(_check_admin_stub)):
    """Image extraction statistics (count cards with image_url)."""
    with get_db_connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM news_cards").fetchone()[0]
        with_image = conn.execute(
            "SELECT COUNT(*) FROM news_cards "
            "WHERE image_url IS NOT NULL AND image_url != ''"
        ).fetchone()[0]

    return {
        "total_news": total,
        "with_image": with_image,
        "without_image": total - with_image,
        "image_coverage_pct": round(with_image / total * 100, 1) if total > 0 else 0,
    }