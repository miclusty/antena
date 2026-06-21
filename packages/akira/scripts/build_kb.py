#!/usr/bin/env python3
"""
AKIRA Day 3: Build the entity co-occurrence knowledge base.

Reads entity_mentions rows and computes pairwise co-occurrence
counts: for every pair of entities mentioned by the same card,
record how many cards mention both, and when was the most
recent.

This is the LMWIKI "graph" stage. The output powers the
"related entities" retrieval in core.rag.RAGEngine.

Co-occurrence is symmetric: (A, B) and (B, A) are the same
edge. We always store the pair with the smaller entity.id as
entity_a to deduplicate. The PRIMARY KEY constraint on
(entity_a_id, entity_b_id) prevents double-insertion.

This script is pure SQL — no LLM calls, no network. It runs
in seconds on a single Mac.

CLI:
    --db PATH        SQLite path
    --rebuild        Drop and recreate the table (recomputes from
                     scratch; useful after fixing data)
"""

from __future__ import annotations

import argparse
import logging
import os
import sqlite3
import sys
import time
from pathlib import Path

logger = logging.getLogger("akira.build_kb")

DB_PATH_DEFAULT = os.getenv("AKIRA_DB", str(Path(__file__).parent.parent / "data" / "akira.db"))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build entity co-occurrence graph")
    p.add_argument("--db", type=str, default=DB_PATH_DEFAULT)
    p.add_argument("--rebuild", action="store_true", help="Drop + recreate the table")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logger.info(f"build_kb: db={args.db} rebuild={args.rebuild}")
    t0 = time.monotonic()

    with sqlite3.connect(args.db) as conn:
        # Defensive: make sure the table exists
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS entity_co_occurrences (
              entity_a_id INTEGER NOT NULL,
              entity_b_id INTEGER NOT NULL,
              card_count INTEGER NOT NULL DEFAULT 0,
              last_seen TEXT NOT NULL,
              PRIMARY KEY (entity_a_id, entity_b_id),
              FOREIGN KEY (entity_a_id) REFERENCES entities(id) ON DELETE CASCADE,
              FOREIGN KEY (entity_b_id) REFERENCES entities(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_coocc_a ON entity_co_occurrences (entity_a_id, card_count DESC)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_coocc_b ON entity_co_occurrences (entity_b_id, card_count DESC)"
        )

        if args.rebuild:
            logger.info("rebuild requested, dropping existing co_occurrences")
            conn.execute("DELETE FROM entity_co_occurrences")
            conn.commit()

        # Count pairs to process for progress reporting
        n_pairs = conn.execute(
            """
            SELECT COUNT(*)
            FROM (
              SELECT m1.entity_id, m2.entity_id
              FROM entity_mentions m1
              JOIN entity_mentions m2
                ON m1.card_id = m2.card_id
               AND m1.entity_id < m2.entity_id
            )
            """
        ).fetchone()[0]
        logger.info(f"candidate pairs: {n_pairs:,}")

        if n_pairs == 0:
            logger.info("nothing to do (no entity_mentions rows)")
            return 0

        # Aggregate into entity_co_occurrences in one pass.
        # We use INSERT ... SELECT with GROUP BY for atomicity.
        # card_count = number of distinct cards where both A and B
        # are mentioned. last_seen = max(published_at) of those cards.
        logger.info("aggregating co-occurrences (this is pure SQL)...")
        conn.execute(
            """
            INSERT OR REPLACE INTO entity_co_occurrences
                (entity_a_id, entity_b_id, card_count, last_seen)
            SELECT
                m1.entity_id AS entity_a_id,
                m2.entity_id AS entity_b_id,
                COUNT(DISTINCT m1.card_id) AS card_count,
                MAX(nc.published_at) AS last_seen
            FROM entity_mentions m1
            JOIN entity_mentions m2
              ON m1.card_id = m2.card_id
             AND m1.entity_id < m2.entity_id
            JOIN news_cards nc
              ON nc.id = m1.card_id
            GROUP BY m1.entity_id, m2.entity_id
            """
        )
        conn.commit()

        # Statistics for the log
        n_edges = conn.execute("SELECT COUNT(*) FROM entity_co_occurrences").fetchone()[0]
        n_entities = conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0]
        n_mentions = conn.execute("SELECT COUNT(*) FROM entity_mentions").fetchone()[0]

    elapsed = time.monotonic() - t0
    logger.info(
        f"DONE: {n_edges:,} edges from {n_entities:,} entities / {n_mentions:,} mentions, "
        f"{elapsed:.1f}s"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
