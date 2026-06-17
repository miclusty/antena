#!/usr/bin/env python3
"""
AKIRA Day 4: Synthesize 3-perspective master articles for clusters.

For every cluster that doesn't yet have all 3 perspectives
synthesized (tracked via clusters.synth_at columns in D1, or
master_articles.perspective_type in local SQLite), this script:

  1. Calls RAGEngine.synthesize(cluster_id) which:
     - Assembles the RAG context (KNN neighbors + entity graph +
       bias distribution)
     - Prompts the local LLM (qwen3.5-4b)
     - Parses 3 perspectives (neutral / pro_gov / anti_gov)
  2. Persists each perspective as a row in master_articles with
     `perspective_type` set to the perspective name.

The output schema is a 1:1 superset of the existing
master_articles table — we add a `perspective_type` column to
distinguish the 3 rows per cluster, and use `title` + `summary`
+ `body` for the perspective's text.

This is a long-running batch job. 1,167 clusters × 30s/cluster
(LLM time) × 4 workers = ~2.5 hours. Use --limit to test on
a small subset first.

CLI:
    --limit N        Process at most N clusters (default: all)
    --workers N      Concurrent threads (default 2; 2 is safe for
                     a 4B model on a single M4)
    --model NAME     Override the LLM model
    --skip-existing  Skip clusters that already have all 3
                     perspectives in master_articles
    --db PATH        Override SQLite path
    --batch N        DB commit batch (default 10)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional, Sequence, Tuple

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.rag import RAGEngine, SynthesizedPerspectives
from core.lmstudio import LMStudioClient, LMStudioError

logger = logging.getLogger("akira.rag_synthesize")

DB_PATH_DEFAULT = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
DEFAULT_MODEL = "qwen3.5-4b"
DEFAULT_WORKERS = 2
BATCH_COMMIT = 10


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Synthesize 3-perspective master articles via RAG"
    )
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--offset", type=int, default=0,
                   help="Skip first N clusters in the queue (use with --limit to partition work across machines)")
    p.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    p.add_argument("--model", type=str, default=DEFAULT_MODEL)
    p.add_argument("--skip-existing", action="store_true", default=True)
    p.add_argument("--no-skip-existing", dest="skip_existing", action="store_false")
    p.add_argument("--db", type=str, default=DB_PATH_DEFAULT)
    p.add_argument("--batch", type=int, default=BATCH_COMMIT)
    return p.parse_args()


def fetch_clusters(
    db_path: str, limit: int, skip_existing: bool, offset: int = 0
) -> List[str]:
    """Return cluster_ids that need synthesis.

    If skip_existing is True, we exclude clusters that already
    have all three perspectives in master_articles. The check
    uses a HAVING count = 3 subquery — the SQL is the same shape
    as the production D1 query, so the same logic works in
    both environments.
    """
    with sqlite3.connect(db_path) as conn:
        conn.isolation_level = None
        if skip_existing:
            sql = """
                SELECT cluster_id
                FROM news_cards
                WHERE cluster_id IS NOT NULL AND cluster_id != ''
                GROUP BY cluster_id
                HAVING SUM(CASE WHEN cluster_id IN (
                    SELECT cluster_id FROM master_articles
                    WHERE perspective_type IN ('neutral','pro_gov','anti_gov')
                ) THEN 0 ELSE 1 END) > 0
                ORDER BY COUNT(*) DESC
            """
        else:
            sql = """
                SELECT cluster_id
                FROM news_cards
                WHERE cluster_id IS NOT NULL AND cluster_id != ''
                GROUP BY cluster_id
                ORDER BY COUNT(*) DESC
            """
        if limit > 0:
            sql += f" LIMIT {limit} OFFSET {offset}"
        rows = conn.execute(sql).fetchall()
    return [r[0] for r in rows]


def perspective_rows(p: SynthesizedPerspectives) -> List[Tuple[str, str, str, str, str]]:
    """Convert SynthesizedPerspectives into 3 master_articles rows.

    Returns list of (id, cluster_id, perspective_type, title, summary)
    tuples. Body is the same as summary for now; a future improvement
    could fetch the full LLM-generated body."""
    base = f"master-{p.cluster_id}"
    return [
        (f"{base}-neutral", p.cluster_id, "neutral", p.neutral_title, p.neutral_summary),
        (f"{base}-prog", p.cluster_id, "pro_gov", p.pro_gov_title, p.pro_gov_summary),
        (f"{base}-anti", p.cluster_id, "anti_gov", p.anti_gov_title, p.anti_gov_summary),
    ]


def commit_perspectives(
    db_path: str,
    rows: Sequence[Tuple[str, str, str, str, str]],
    lock: threading.Lock,
) -> int:
    """Write (cluster_id, neutral_summary, pro_gov_summary, anti_gov_summary,
    neutral_title) rows to master_articles.

    The existing master_articles table has 1 row per cluster with
    3 perspective columns: neutral_perspective, officialist_perspective,
    opposition_perspective. We map:
      - "neutral"    -> neutral_perspective
      - "pro_gov"    -> officialist_perspective
      - "anti_gov"   -> opposition_perspective

    The neutral_title goes into the row's main `title` column. The
    pro/anti titles get JSON-encoded into their respective
    perspective columns as "TITLE: ...\n\nSUMMARY: ..." (the LLM
    was told to produce both, so we preserve both).
    """
    if not rows:
        return 0
    n = 0
    with lock:
        # Autocommit mode: every execute is its own transaction.
        # The writer never blocks on readers (long-lived
        # connections in the RAGEngine hold SHARED locks for
        # their reads, which can block writers in WAL mode).
        conn = sqlite3.connect(db_path, timeout=30)
        conn.execute("PRAGMA busy_timeout=60000")
        conn.isolation_level = None
        # Retry-with-backoff: when multiple processes are
        # writing, even with WAL + autocommit, the writer can
        # briefly get "database is locked" when a reader
        # upgrades to a reserved/exclusive lock. 3 retries with
        # 2s/4s/8s backoff lets a slow reader finish without
        # losing the batch.
        for attempt in range(4):
            try:
                for cluster_id, neutral_title, neutral_summary, pro_gov_text, anti_gov_text in rows:
                    # Split pro/anti into title + body. The RAG engine
                    # returns them as a single string in the LLM's
                    # "titulo" + "resumen" shape; we packed them
                    # together with a newline separator at the caller.
                    # For backward compat with the existing
                    # master_articles schema (which has
                    # officialist_perspective and opposition_perspective
                    # as plain TEXT), we store the full text (title +
                    # summary) in those columns. The frontend can
                    # split on the first newline if it wants just the
                    # summary.
                    conn.execute(
                        """
                        INSERT INTO master_articles
                            (cluster_id, title, summary,
                             neutral_perspective, officialist_perspective,
                             opposition_perspective, sources_count,
                             created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, 1,
                                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT(cluster_id) DO UPDATE SET
                            title = excluded.title,
                            summary = excluded.summary,
                            neutral_perspective = excluded.neutral_perspective,
                            officialist_perspective = excluded.officialist_perspective,
                            opposition_perspective = excluded.opposition_perspective,
                            updated_at = CURRENT_TIMESTAMP
                        """,
                        (
                            cluster_id,
                            neutral_title,
                            neutral_summary,
                            neutral_summary,
                            pro_gov_text,
                            anti_gov_text,
                        ),
                    )
                n = len(rows)
                break  # success
            except sqlite3.OperationalError as e:
                if attempt == 3:
                    logger.error(f"commit_failed_after_3_retries: {e}")
                else:
                    backoff = 2 ** attempt
                    logger.warning(
                        f"commit_retry attempt={attempt+1}/3 backoff={backoff}s err={e}"
                    )
                    time.sleep(backoff)
        conn.close()
    return n


def process_cluster(
    engine: RAGEngine, cluster_id: str
) -> Optional[SynthesizedPerspectives]:
    """Synthesize one cluster with 3 parallel perspective calls.

    Uses synthesize_3pass instead of synthesize because the
    3-pass version produces more diverse perspectives (each
    gets its own LLM call with a perspective-specific system
    prompt). With 2-node LM Studio load balancing, the 3
    parallel calls land on whichever node is faster. 3-pass
    is 3x the LLM calls per cluster but the wall-clock per
    cluster is the SAME (parallel) and the quality is
    noticeably better (the 1-pass LLM tends to write the
    same text with 1-2 word changes across perspectives).
    """
    try:
        return engine.synthesize_3pass(cluster_id, concurrency=3)
    except Exception as e:  # noqa: BLE001
        logger.exception(f"synth_unexpected cluster={cluster_id} error={e}")
        return None


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger.info(
        f"rag_synthesize: model={args.model} workers={args.workers} "
        f"limit={args.limit} skip_existing={args.skip_existing} db={args.db}"
    )
    try:
        lm_client = LMStudioClient()
        # Quick health check
        _ = lm_client.chat(
            [{"role": "user", "content": "OK"}], model=args.model, max_tokens=5
        )
        logger.info("LM Studio OK")
    except LMStudioError as e:
        logger.error(f"LM Studio unreachable: {e}")
        return 1

    engine = RAGEngine(db_path=args.db, lm_client=lm_client, model=args.model)

    # Make sure master_articles has the perspective_type column.
    with sqlite3.connect(args.db) as conn:
        conn.isolation_level = None
        cols = {
            r[1]
            for r in conn.execute("PRAGMA table_info(master_articles)").fetchall()
        }
        if "perspective_type" not in cols:
            conn.execute(
                "ALTER TABLE master_articles ADD COLUMN perspective_type TEXT DEFAULT 'neutral'"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_master_perspective ON master_articles (cluster_id, perspective_type)"
            )

    clusters = fetch_clusters(args.db, args.limit, args.skip_existing, args.offset)
    if not clusters:
        logger.info("nothing to do (no clusters need synthesis)")
        return 0
    logger.info(f"to synthesize: {len(clusters)} clusters")

    db_lock = threading.Lock()
    t0 = time.monotonic()
    pending_rows: List[Tuple[str, str, str, str, str]] = []
    done = 0
    success = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {
            ex.submit(process_cluster, engine, cid): cid for cid in clusters
        }
        for fut in as_completed(futures):
            cid = futures[fut]
            try:
                p = fut.result()
            except Exception as e:  # noqa: BLE001
                logger.exception(f"synth_worker_failed cluster={cid} error={e}")
                p = None
            done += 1
            if p is None:
                failed += 1
            else:
                success += 1
                # Pack all 3 perspectives into a single row using
                # the existing master_articles schema: 1 row per
                # cluster, 3 perspective columns. Title goes in
                # the row's main title; summaries in their
                # dedicated columns.
                pro_text = f"{p.pro_gov_title}\n\n{p.pro_gov_summary}"
                anti_text = f"{p.anti_gov_title}\n\n{p.anti_gov_summary}"
                pending_rows.append(
                    (p.cluster_id, p.neutral_title, p.neutral_summary, pro_text, anti_text)
                )
                if len(pending_rows) >= args.batch:
                    logger.info(
                        f"commit_attempt batch={len(pending_rows)} "
                        f"success={success} failed={failed}"
                    )
                    n = commit_perspectives(args.db, pending_rows, db_lock)
                    logger.info(f"commit_done wrote={n}")
                    pending_rows = []
            if done % 5 == 0 or done == len(clusters):
                elapsed = time.monotonic() - t0
                rate = done / elapsed if elapsed > 0 else 0
                eta_sec = (len(clusters) - done) / rate if rate > 0 else 0
                logger.info(
                    f"progress: {done}/{len(clusters)} ok={success} "
                    f"failed={failed} rate={rate:.2f}/s eta={eta_sec/60:.1f}min"
                )
        if pending_rows:
            commit_perspectives(args.db, pending_rows, db_lock)

    elapsed = time.monotonic() - t0
    logger.info(
        f"DONE: {success} clusters synthesized (3 perspectives each), "
        f"{failed} failed, {elapsed:.1f}s total ({done/elapsed:.2f} clusters/s)"
    )
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
