#!/usr/bin/env python3
"""Hourly AKIRA → D1 sync. Run by PM2 (akira-d1-sync, cron '0 * * * *').

Invokes `D1Sync.sync_all()` over every registered table:

    - clusters                (UPDATE)
    - emerging_clusters       (INSERT OR REPLACE)
    - sources_credibility     (incremental UPDATE)
    - news_cards_simhash      (UPDATE, non-zero rows)

This is the belt-and-suspenders safety net for the inline sync calls
in `harvest_full_cycle.py` and `update_emerging_themes.py`. If those
fail or get skipped, this cron catches up on the next hour.

Usage:
    python -m scripts.sync_to_d1_cron
    python -m scripts.sync_to_d1_cron --dry-run
    python -m scripts.sync_to_d1_cron --db /path/to/akira.db --since-hours 6

Exit codes:
    0  all tables synced successfully (or partial success with at least
       one table done)
    1  no credentials configured (D1 sync disabled)
    2  every table failed (real outage)
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

PKG_ROOT = Path(__file__).resolve().parent.parent
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Hourly AKIRA → D1 sync")
    ap.add_argument("--db", default=None, help="AKIRA SQLite path (default: settings.db_path)")
    ap.add_argument(
        "--since-hours",
        type=float,
        default=None,
        help=(
            "Only sync rows updated within the last N hours. Default: full mirror. "
            "Currently only affects sources_credibility (which has "
            "credibility_updated_at timestamps); other tables always "
            "full-mirror."
        ),
    )
    ap.add_argument("--dry-run", action="store_true", help="Read but don't push to D1")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    _setup_logging(args.verbose)
    logger = logging.getLogger("akira.sync_to_d1_cron")

    try:
        from config import settings
        from core.d1_sync import D1Sync
    except Exception as exc:  # noqa: BLE001
        logger.error("d1_sync_unavailable: %s", exc)
        return 1

    if not (
        settings.cloudflare_account_id
        and settings.cloudflare_api_token
        and settings.d1_database_id
    ):
        logger.warning(
            "d1_sync skipped: missing AKIRA_CLOUDFLARE_* env vars. "
            "See packages/akira/.env.example."
        )
        return 1

    db_path = args.db or settings.db_path
    if not os.path.exists(db_path):
        logger.error("akira_db_not_found db=%s", db_path)
        return 1

    since = None
    if args.since_hours is not None:
        since = datetime.now() - timedelta(hours=args.since_hours)

    start = time.time()
    sync = D1Sync(
        account_id=settings.cloudflare_account_id,
        api_token=settings.cloudflare_api_token,
        database_id=settings.d1_database_id,
        akira_db_path=db_path,
    )
    counts = sync.sync_all(since=since, dry_run=args.dry_run)
    elapsed = time.time() - start

    # Count failures (entries that came back as "error: ..." strings).
    failed = [k for k, v in counts.items() if isinstance(v, str) and v.startswith("error")]
    success = [k for k, v in counts.items() if not (isinstance(v, str) and v.startswith("error"))]

    summary = {
        "ok": len(failed) == 0,
        "elapsed_seconds": round(elapsed, 3),
        "dry_run": args.dry_run,
        "since_hours": args.since_hours,
        "counts": counts,
        "failed_tables": failed,
    }
    print(json.dumps(summary))

    logger.info(
        "d1_sync_done ok=%s success=%d failed=%d elapsed=%.2fs counts=%s",
        len(failed) == 0,
        len(success),
        len(failed),
        elapsed,
        counts,
    )

    if len(failed) == len(counts) and len(counts) > 0:
        # Every single table failed → real D1 outage
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())