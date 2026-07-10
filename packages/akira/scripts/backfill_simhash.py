#!/usr/bin/env python3
"""Backfill simhash for all existing news_cards.

Run after applying migration 0007_simhash.sql. Idempotent — safe to re-run.
Computes simhash from (title + summary + body[:200]) and UPDATEs each row.

Usage:
    python -m scripts.backfill_simhash
    python -m scripts.backfill_simhash --batch 500 --db data/akira.db
"""
import argparse
import os
import sqlite3
import sys
import time

PKG_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PKG_ROOT not in sys.path:
    sys.path.insert(0, PKG_ROOT)

from core.simhash import compute_simhash
import config
from config import settings


def backfill(db_path: str | None, batch_size: int) -> tuple[int, int]:
    """Returns (total, updated)."""
    db = db_path or config.settings.db_path
    conn = sqlite3.connect(db)
    conn.row_factory = None
    total = conn.execute("SELECT COUNT(*) FROM news_cards").fetchone()[0]
    if total == 0:
        print("No news_cards to backfill.")
        conn.close()
        return (0, 0)

    remaining = conn.execute("SELECT COUNT(*) FROM news_cards WHERE simhash = 0").fetchone()[0]
    if remaining == 0:
        print(f"All {total} cards already have simhash set.")
        conn.close()
        return (total, 0)

    print(f"Backfilling simhash for {remaining} cards (of {total} total) in batches of {batch_size}...")
    updated = 0
    last_id = ""
    while updated < remaining:
        rows = conn.execute(
            "SELECT id, title, summary, body FROM news_cards "
            "WHERE simhash = 0 AND id > ? "
            "ORDER BY id LIMIT ?",
            (last_id, batch_size),
        ).fetchall()
        if not rows:
            break
        with conn:
            for row_id, title, summary, body in rows:
                text_parts = [title or "", summary or "", (body or "")[:200]]
                text = " ".join(p for p in text_parts if p)
                sh = compute_simhash(text)
                conn.execute(
                    "UPDATE news_cards SET simhash = ? WHERE id = ?",
                    (sh, row_id),
                )
                updated += 1
                last_id = row_id
        print(f"  {updated}/{remaining} ({100 * updated // remaining}%)")
    conn.close()
    return (total, updated)


def main():
    p = argparse.ArgumentParser(description="Backfill simhash for existing cards")
    p.add_argument("--batch", type=int, default=200, help="Batch size (default 200)")
    p.add_argument("--db", type=str, default=None, help="SQLite path (default from settings)")
    args = p.parse_args()

    start = time.time()
    total, updated = backfill(args.db, args.batch)
    elapsed = time.time() - start
    print(f"Done: {updated}/{total} cards updated in {elapsed:.1f}s")


if __name__ == "__main__":
    main()