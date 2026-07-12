#!/usr/bin/env python3
"""Recompute the emerging_clusters cache every 15 minutes.

Idempotent. Writes only to the local AKIRA SQLite (packages/akira/data/akira.db).
A future sync_to_d1.py extension can mirror this table to D1.

Usage:
    python -m scripts.update_emerging_themes
    python -m scripts.update_emerging_themes --min-score 3.0 --limit 30
    python -m scripts.update_emerging_themes --dry-run

Exit codes:
    0  success
    1  unrecoverable error (DB connection lost, etc.)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

# Make `core/`, `config.py`, `db/` importable when run as
# `python -m scripts.update_emerging_themes` from packages/akira/.

HERE = Path(__file__).resolve().parent
AKIRA_ROOT = HERE.parent
if str(AKIRA_ROOT) not in sys.path:
    sys.path.insert(0, str(AKIRA_ROOT))

from core.emerging_themes import (        # noqa: E402
    EXPIRY_HOURS,
    ensure_table,
    expire_stale_emerging,
    find_emerging_clusters,
    upsert_emerging_clusters,
)
from db.connection import get_db_connection        # noqa: E402

logger = logging.getLogger("akira.update_emerging_themes")


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Recompute emerging_clusters cache")
    ap.add_argument("--window-hours", type=int, default=6,
                    help="Velocity window in hours (default 6)")
    ap.add_argument("--min-score", type=float, default=2.0,
                    help="Minimum velocity_score to keep (default 2.0)")
    ap.add_argument("--limit", type=int, default=30,
                    help="Max clusters to insert per run (default 30)")
    ap.add_argument("--ttl-hours", type=int, default=EXPIRY_HOURS,
                    help=f"Drop rows older than N hours (default {EXPIRY_HOURS})")
    ap.add_argument("--db", type=str, default=None,
                    help="SQLite path (default from settings.db_path)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Compute but don't write to DB")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    _setup_logging(args.verbose)

    start = time.time()
    logger.info(
        "starting: window_hours=%d min_score=%.2f limit=%d ttl_hours=%d dry_run=%s",
        args.window_hours, args.min_score, args.limit, args.ttl_hours, args.dry_run,
    )

    try:
        ensure_table(args.db)
    except Exception:
        logger.exception("ensure_table() failed")
        return 1

    # Compute fresh
    try:
        clusters = find_emerging_clusters(
            window_hours=args.window_hours,
            min_score=args.min_score,
            limit=args.limit,
            db_path=args.db,
        )
    except Exception:
        logger.exception("find_emerging_clusters() failed")
        return 1

    logger.info("found %d emerging clusters above score %.2f", len(clusters), args.min_score)
    for c in clusters[:5]:
        logger.info(
            "  %s: score=%.2f articles=%d sources=%d cred=%.0f title=%r",
            c.cluster_id, c.velocity_score, c.new_articles_in_window,
            c.distinct_sources_in_window, c.credibility_avg, (c.title or "")[:60],
        )

    if args.dry_run:
        elapsed = time.time() - start
        logger.info("dry-run done in %.2fs", elapsed)
        return 0

    # Upsert
    try:
        written = upsert_emerging_clusters(clusters, db_path=args.db)
    except Exception:
        logger.exception("upsert_emerging_clusters() failed")
        return 1

    # Expire
    try:
        dropped = expire_stale_emerging(ttl_hours=args.ttl_hours, db_path=args.db)
    except Exception:
        logger.exception("expire_stale_emerging() failed")
        return 1

    # Mirror to D1 (best-effort: if creds are missing or D1 errors,
    # the local SQLite write has already succeeded, so we log + skip
    # rather than failing the cron. The hourly sync_to_d1_cron.py will
    # backfill any drift.)
    d1_synced = 0
    if not args.dry_run:
        try:
            from config import settings
            from core.d1_sync import D1Sync
            if settings.cloudflare_account_id and settings.cloudflare_api_token and settings.d1_database_id:
                sync = D1Sync(
                    account_id=settings.cloudflare_account_id,
                    api_token=settings.cloudflare_api_token,
                    database_id=settings.d1_database_id,
                    akira_db_path=args.db,
                )
                d1_synced = sync.sync_table("emerging_clusters")
            else:
                logger.info("d1_sync skipped: missing AKIRA_CLOUDFLARE_* env")
        except Exception:
            logger.exception("d1_sync emerging_clusters failed (non-fatal)")

    elapsed = time.time() - start
    logger.info(
        "done: wrote=%d expired=%d d1_synced=%d elapsed=%.2fs",
        written, dropped, d1_synced, elapsed,
    )

    # Emit a one-line JSON summary to stdout so cron can capture it.
    summary = {
        "ok": True,
        "clusters": len(clusters),
        "written": written,
        "expired": dropped,
        "d1_synced": d1_synced,
        "window_hours": args.window_hours,
        "min_score": args.min_score,
        "elapsed_seconds": round(elapsed, 3),
    }
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
