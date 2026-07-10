#!/usr/bin/env python3
"""Backfill credibility_score for all existing sources.

Usage:
    python -m scripts.backfill_credibility
    python -m scripts.backfill_credibility --source-id 42
"""
import argparse
import os
import sqlite3
import sys
from datetime import datetime, timezone

PKG_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PKG_ROOT not in sys.path:
    sys.path.insert(0, PKG_ROOT)

from core.credibility import compute_credibility
import config


def _days_since(iso_str: str | None) -> int:
    if not iso_str:
        return 0
    try:
        # SQLite returns naive datetimes ("YYYY-MM-DD HH:MM:SS"). Handle both.
        iso_str = iso_str.replace("Z", "+00:00")
        if "T" not in iso_str and " " in iso_str:
            iso_str = iso_str.replace(" ", "T")
        dt = datetime.fromisoformat(iso_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0, (datetime.now(timezone.utc) - dt).days)
    except (ValueError, AttributeError):
        return 0


def backfill(db_path: str | None = None, source_id: int | None = None) -> int:
    db = db_path or config.settings.db_path
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row

    if source_id is not None:
        sources = conn.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchall()
    else:
        sources = conn.execute("SELECT * FROM sources WHERE is_active = 1").fetchall()

    updated = 0
    for src in sources:
        sid = src["id"]
        # AKIRA local SQLite uses source_ids CSV (not source_id FK).
        # Parse first id as primary source for category breakdown.
        cat_counts: dict[str, int] = {}
        first_source_id_csv = ""
        source_ids_csv = src["source_ids"] if "source_ids" in src.keys() else ""
        if source_ids_csv:
            first_source_id_csv = source_ids_csv.split(",")[0].strip()
        if first_source_id_csv and first_source_id_csv.isdigit():
            cat_rows = conn.execute(
                "SELECT category, COUNT(*) AS n FROM news_cards "
                "WHERE source_ids LIKE ? OR source_ids LIKE ? OR source_ids = ? "
                "AND category IS NOT NULL GROUP BY category",
                (f"{first_source_id_csv},%", f"%,{first_source_id_csv},%", first_source_id_csv),
            ).fetchall()
            cat_counts = {row["category"]: row["n"] for row in cat_rows}
        news_count = src["news_count"] or 0
        fetch_count = src["fetch_count"] or 0
        first = src["created_at"]
        last = src["last_fetch"] or src["last_success"]
        result = compute_credibility(
            source_id=sid,
            retraction_count=0,  # NEW column, no data yet
            news_count=news_count,
            unique_count=news_count,  # approximation: assume all unique initially
            reliability_score=src["reliability_score"] or 0.5,
            fetch_count=fetch_count,
            days_since_first_fetch=_days_since(first),
            days_since_last_fetch=_days_since(last),
            category_counts=cat_counts,
        )
        with conn:
            conn.execute(
                "UPDATE sources SET credibility_score = ?, uniqueness_ratio = ?, "
                "diversity_score = ?, credibility_updated_at = datetime('now') "
                "WHERE id = ?",
                (
                    result["credibility_score"],
                    result["subscores"]["uniqueness"] / 100,
                    result["subscores"]["diversity"],
                    sid,
                ),
            )
        updated += 1

    conn.close()
    return updated


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--db", type=str, default=None)
    p.add_argument("--source-id", type=int, default=None)
    args = p.parse_args()
    n = backfill(args.db, args.source_id)
    print(f"Backfilled {n} sources.")


if __name__ == "__main__":
    main()