#!/usr/bin/env python3
"""
AKIRA Day 2: Compute and persist embeddings for all news cards.

Reads cards from the local news_cards table, embeds the
`title + summary` text via the local LM Studio embedding model,
and writes the 768-dim vector to the news_embeddings table.

Idempotent: cards that already have an embedding for the same
model are skipped. To re-embed (e.g. after a model upgrade),
pass --force.

Concurrency: we use a ThreadPoolExecutor to pipeline embedding
calls. Each LM Studio embedding takes ~50-200ms; with 4 workers
we get ~20-30 cards/second on a single M4. For 13k cards that's
~10-15 minutes.

CLI flags:
    --limit N        Process at most N cards (for testing)
    --force          Re-embed everything, even cards that already
                     have an embedding for the current model
    --model NAME     Override the embedding model
    --batch N        Commit to DB every N cards (default 50)
    --workers N      Number of concurrent threads (default 4)
    --db PATH        Override the SQLite path
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
from typing import List, Sequence, Tuple

# Add parent to path so we can import core.lmstudio
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.lmstudio import LMStudioClient, LMStudioError

logger = logging.getLogger("akira.embed_cards")

DB_PATH_DEFAULT = "/Users/omatic/proyectos/news/packages/akira/data/akira.db"
DEFAULT_MODEL = "text-embedding-nomic-embed-text-v1.5"
BATCH_COMMIT = 50
DEFAULT_WORKERS = 4


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Embed all news_cards via LM Studio")
    p.add_argument("--limit", type=int, default=0, help="Max cards to process (0 = all)")
    p.add_argument("--force", action="store_true", help="Re-embed even if already done")
    p.add_argument("--model", type=str, default=DEFAULT_MODEL, help="Embedding model name")
    p.add_argument("--batch", type=int, default=BATCH_COMMIT, help="DB commit batch size")
    p.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help="Concurrent threads")
    p.add_argument("--db", type=str, default=DB_PATH_DEFAULT, help="SQLite path")
    return p.parse_args()


def fetch_card_texts(
    db_path: str, model: str, limit: int, force: bool
) -> List[Tuple[str, str]]:
    """Return (card_id, text) for cards that need an embedding.

    If `force` is False, only cards without an embedding for the
    given model are returned. The query joins news_cards with
    news_embeddings using a LEFT JOIN to find missing rows."""
    with sqlite3.connect(db_path) as conn:
        if force:
            sql = "SELECT id, title, summary FROM news_cards WHERE summary IS NOT NULL AND LENGTH(summary) > 20"
        else:
            sql = """
                SELECT nc.id, nc.title, nc.summary
                FROM news_cards nc
                LEFT JOIN news_embeddings ne ON ne.card_id = nc.id AND ne.model = ?
                WHERE nc.summary IS NOT NULL
                  AND LENGTH(nc.summary) > 20
                  AND ne.card_id IS NULL
            """
        if limit > 0:
            sql += f" LIMIT {limit}"
        rows = conn.execute(sql, () if force else (model,)).fetchall()
    return [(cid, f"{title or ''}. {summary or ''}".strip()) for cid, title, summary in rows]


def embed_one(
    client: LMStudioClient, card_id: str, text: str, model: str
) -> Tuple[str, object, str]:
    """Embed a single card. Returns (card_id, embedding_json_or_None, model_or_error)
    on completion — caller branches on whether the second tuple item is None
    to decide between success and failure."""
    try:
        vec = client.embed(text, model=model)
        return (card_id, json.dumps(vec), model)
    except LMStudioError as e:
        return (card_id, None, str(e))


def commit_batch(
    db_path: str, batch: Sequence[Tuple[str, object, str]], lock: threading.Lock
) -> int:
    """Write a batch of (card_id, embedding_json, model) tuples to
    the news_embeddings table. Uses INSERT OR REPLACE so a
    re-embed (--force) overwrites cleanly."""
    if not batch:
        return 0
    n = 0
    with lock:
        with sqlite3.connect(db_path) as conn:
            try:
                conn.executemany(
                    """
                    INSERT OR REPLACE INTO news_embeddings
                        (card_id, embedding, model, computed_at)
                    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    batch,
                )
                conn.commit()
                n = len(batch)
            except sqlite3.OperationalError as e:
                logger.error(f"commit_failed: {e}")
    return n


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger.info(
        f"embed_cards: model={args.model} force={args.force} "
        f"limit={args.limit} workers={args.workers} db={args.db}"
    )
    # Sanity check: can we reach LM Studio?
    try:
        client = LMStudioClient()
        test_vec = client.embed("health check", model=args.model)
        if len(test_vec) != 768:
            logger.warning(
                f"unexpected embedding dim: {len(test_vec)} (expected 768). "
                f"If you change models, update VECTOR_DIM in core/rag.py"
            )
        logger.info(f"LM Studio OK, embed dim={len(test_vec)}")
    except LMStudioError as e:
        logger.error(f"LM Studio unreachable: {e}")
        return 1

    # Make sure the embeddings table exists (created in migration
    # 0003 + a follow-up CREATE IF NOT EXISTS for the local-only
    # vector store).
    with sqlite3.connect(args.db) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS news_embeddings (
              card_id TEXT PRIMARY KEY,
              embedding TEXT NOT NULL,
              model TEXT NOT NULL DEFAULT 'text-embedding-nomic-embed-text-v1.5',
              computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (card_id) REFERENCES news_cards(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_embeddings_model ON news_embeddings (model)"
        )

    # Fetch the cards that need embedding
    todo = fetch_card_texts(args.db, args.model, args.limit, args.force)
    if not todo:
        logger.info("nothing to do (all cards already embedded for this model)")
        return 0
    logger.info(f"to embed: {len(todo)} cards")

    # Process with a thread pool. The lock is only held during
    # the SQLite commit, not during the network call, so
    # threads don't block each other on I/O.
    db_lock = threading.Lock()
    total_done = 0
    total_failed = 0
    t0 = time.monotonic()
    batch: List[Tuple[str, object, str]] = []
    failed_ids: List[str] = []

    # We submit all tasks at once. The pool's internal queue
    # limits how many are in flight (= workers).
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {
            ex.submit(embed_one, client, cid, text, args.model): cid
            for cid, text in todo
        }
        for i, fut in enumerate(as_completed(futures), 1):
            cid, emb_json, err = fut.result()
            if emb_json is None:
                total_failed += 1
                failed_ids.append(cid)
                logger.warning(f"embed_failed card_id={cid} error={err[:120]}")
            else:
                batch.append((cid, emb_json, args.model))
                if len(batch) >= args.batch:
                    n = commit_batch(args.db, batch, db_lock)
                    total_done += n
                    batch = []
                    elapsed = time.monotonic() - t0
                    rate = total_done / elapsed if elapsed > 0 else 0
                    eta_sec = (len(todo) - i) / rate if rate > 0 else 0
                    logger.info(
                        f"progress: {i}/{len(todo)} done={total_done} "
                        f"failed={total_failed} rate={rate:.1f}/s "
                        f"eta={eta_sec/60:.1f}min"
                    )
        # Final batch
        if batch:
            n = commit_batch(args.db, batch, db_lock)
            total_done += n

    elapsed = time.monotonic() - t0
    logger.info(
        f"DONE: {total_done} embedded, {total_failed} failed, "
        f"{elapsed:.1f}s total ({total_done/elapsed:.1f}/s avg)"
    )
    if failed_ids:
        logger.warning(
            f"failed card_ids (first 10): {failed_ids[:10]}. "
            f"Re-run with --limit=0 to retry, or check LM Studio health."
        )
    return 0 if total_failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
