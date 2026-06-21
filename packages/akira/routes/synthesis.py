"""Synthesis + cluster routes.

Endpoints for clustering news cards and synthesizing neutral master
articles from cluster contents:
  - POST /cluster                              — cluster specific card IDs
  - POST /cluster/recent                       — cluster recent unclustered cards
  - GET  /cluster/stats                        — clustering stats
  - POST /cluster/{cluster_id}/synthesize      — synthesize single cluster
  - POST /synthesis/batch                      — synthesize many clusters
  - GET  /synthesis/master/{cluster_id}        — get master article + RAG meta
  - POST /cluster/{cluster_id}/synthesize-rag  — synthesize 3 RAG perspectives
  - GET  /synthesis/stats                      — synthesis statistics

All synthesis endpoints use `loop.run_in_executor()` to avoid blocking
the event loop (synthesis can take ~30s per cluster).
"""
from __future__ import annotations

import asyncio
import json as _json
import sqlite3
from typing import List

from fastapi import APIRouter, Depends, Request

from config import settings
from db.connection import get_db_connection
from models.schemas import MasterArticle, SynthesisResult

router = APIRouter(tags=["synthesis"])


# Stub auth dependency (replaced in main.py shim — see iter 1.3 PR 7).
def _check_admin_stub():
    """Placeholder — real auth is wired in main.py."""
    pass


@router.post("/cluster")
async def cluster_news_card_ids(
    request: Request,
    card_ids: List[str],
    limit: int = 100,
    _auth=Depends(_check_admin_stub),
):
    """Cluster specific news card IDs by title similarity."""
    clustering = getattr(request.app.state, "clustering_service", None)
    if not clustering:
        return {"error": "Clustering service not initialized"}

    card_ids = card_ids[:limit]
    clusters = clustering.cluster_news_cards(card_ids)
    return {
        "total": len(card_ids),
        "clusters": len(clusters),
        "cluster_map": clusters,
    }


@router.post("/cluster/recent")
async def cluster_recent_news(
    request: Request,
    hours: int = 24,
    limit: int = 500,
    _auth=Depends(_check_admin_stub),
):
    """Cluster recent unclustered news cards."""
    clustering = getattr(request.app.state, "clustering_service", None)
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


@router.get("/cluster/stats")
async def cluster_stats():
    """Get clustering statistics from the database."""
    with get_db_connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM news_cards").fetchone()[0]
        clustered = conn.execute(
            "SELECT COUNT(*) FROM news_cards "
            "WHERE cluster_id IS NOT NULL AND cluster_id != ''"
        ).fetchone()[0]
        clusters = conn.execute(
            "SELECT COUNT(DISTINCT cluster_id) FROM news_cards "
            "WHERE cluster_id IS NOT NULL AND cluster_id != ''"
        ).fetchone()[0]
        avg_size = (
            conn.execute(
                "SELECT AVG(cnt) FROM (SELECT COUNT(*) as cnt FROM news_cards "
                "WHERE cluster_id IS NOT NULL AND cluster_id != '' "
                "GROUP BY cluster_id)"
            ).fetchone()[0]
            or 0
        )

    return {
        "total_news": total,
        "clustered_news": clustered,
        "total_clusters": clusters,
        "clustering_rate_pct": round(clustered / total * 100, 1) if total > 0 else 0,
        "avg_cluster_size": round(avg_size, 2),
    }


@router.post("/cluster/{cluster_id}/synthesize", response_model=SynthesisResult)
async def synthesize_cluster(
    request: Request,
    cluster_id: str,
    _auth=Depends(_check_admin_stub),
):
    """Synthesize a single cluster into a neutral master article."""
    synthesis_engine = getattr(request.app.state, "synthesis_engine", None)
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


@router.post("/synthesis/batch")
async def batch_synthesize(
    request: Request,
    limit: int = 100,
    _auth=Depends(_check_admin_stub),
):
    """Synthesize multiple clusters in batch (runs in executor to avoid blocking event loop)."""
    synthesis_engine = getattr(request.app.state, "synthesis_engine", None)
    if not synthesis_engine:
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, lambda: synthesis_engine.batch_synthesize(limit=limit)
    )


@router.get("/synthesis/master/{cluster_id}", response_model=MasterArticle)
async def get_master_article(cluster_id: str):
    """Get the master article for a cluster. Includes the 3 RAG perspectives
    (neutral, pro_gov, anti_gov) if they were synthesized by the RAG engine.
    """
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT * FROM master_articles WHERE cluster_id = ?", (cluster_id,)
        ).fetchone()

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
            "neutral_perspective": "",
            "pro_gov_perspective": "",
            "anti_gov_perspective": "",
            "rag_neighbors": 0,
            "rag_entities": 0,
            "rag_model": "",
        }

    # Pull the latest rag_queries row for this cluster to surface metadata:
    # how many neighbors and entities were injected into the prompt, and
    # which LLM wrote the output.
    rag_neighbors = 0
    rag_entities = 0
    rag_model = ""
    try:
        with sqlite3.connect(settings.db_path) as rag_conn:
            rag_row = rag_conn.execute(
                """
                SELECT neighbors_used, entities_used, model
                FROM rag_queries
                WHERE cluster_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (cluster_id,),
            ).fetchone()
            if rag_row:
                try:
                    rag_neighbors = len(_json.loads(rag_row[0] or "[]"))
                    rag_entities = len(_json.loads(rag_row[1] or "[]"))
                except (ValueError, TypeError):
                    pass
                rag_model = rag_row[2] or ""
    except sqlite3.OperationalError:
        # rag_queries table may not exist yet on first deploy
        pass

    # The 3 perspectives are stored as text columns. The neutral one is
    # duplicated in `summary` (backward compat) and the pro/anti ones in
    # officialist_perspective / opposition_perspective. We render the full
    # text (title + body joined) for the API response.
    pro_text = row["officialist_perspective"] or ""
    anti_text = row["opposition_perspective"] or ""
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
        "neutral_perspective": row["neutral_perspective"] or row["summary"] or "",
        "pro_gov_perspective": pro_text,
        "anti_gov_perspective": anti_text,
        "rag_neighbors": rag_neighbors,
        "rag_entities": rag_entities,
        "rag_model": rag_model,
    }


@router.post("/cluster/{cluster_id}/synthesize-rag")
async def synthesize_cluster_rag(
    request: Request,
    cluster_id: str,
    _auth=Depends(_check_admin_stub),
):
    """Synthesize a single cluster into 3 RAG perspectives
    (neutral / pro_gov / anti_gov). Slower than the legacy
    /cluster/{id}/synthesize endpoint (one LLM call per cluster, ~30s)
    but produces 3 distinct viewpoints.
    """
    from core.rag import RAGEngine

    def _do_synth():
        engine = RAGEngine(db_path=settings.db_path)
        return engine.synthesize(cluster_id)

    loop = asyncio.get_running_loop()
    p = await loop.run_in_executor(None, _do_synth)
    if p is None:
        return {
            "ok": False,
            "cluster_id": cluster_id,
            "error": "synthesis_failed_or_empty_cluster",
        }
    return {
        "ok": True,
        "cluster_id": p.cluster_id,
        "model": p.model,
        "latency_ms": p.latency_ms,
        "neighbors_used": len(p.neighbors_used),
        "entities_used": p.entities_used,
        "neutral_title": p.neutral_title,
        "pro_gov_title": p.pro_gov_title,
        "anti_gov_title": p.anti_gov_title,
    }


@router.get("/synthesis/stats")
async def synthesis_stats():
    """Get synthesis statistics."""
    with get_db_connection() as conn:
        total_master = conn.execute(
            "SELECT COUNT(*) FROM master_articles"
        ).fetchone()[0]
        total_clusters = conn.execute(
            "SELECT COUNT(DISTINCT cluster_id) FROM news_cards "
            "WHERE cluster_id IS NOT NULL AND cluster_id != ''"
        ).fetchone()[0]
        avg_sources = (
            conn.execute("SELECT AVG(sources_count) FROM master_articles").fetchone()[0]
            or 0
        )

    return {
        "master_articles": total_master,
        "total_clusters": total_clusters,
        "coverage_pct": (
            round(total_master / total_clusters * 100, 1)
            if total_clusters > 0
            else 0
        ),
        "avg_sources_per_master": round(avg_sources, 1),
    }