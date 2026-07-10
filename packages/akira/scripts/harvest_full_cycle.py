#!/usr/bin/env python3
"""AKIRA harvest_full_cycle — live-crawl wrapper for periodic cron runs.

Designed for the every-30-minutes launchd / PM2 cron:
  * Bounded re-crawl of the top ``--max-sources`` sources (default 50),
    selected by ``last_harvest_at`` so the cycle is fair across the
    fleet (sources that haven't been crawled recently get priority).
  * Skips the expensive "reset seen_urls + reactivate" pass from
    ``harvest_run.py`` so a 30-min cycle produces only NEW articles
    and never re-crawls cards already in the DB.
  * Decreases the seen_urls by deleting only entries newer than
    ``--recheck-window`` minutes (default 30) so the next cycle
    re-checks them for updates.

Usage:
    python -m scripts.harvest_full_cycle --max-sources 50
    python -m scripts.harvest_full_cycle --max-sources 100 --db data/akira.db

This script NEVER modifies the source table — it just nudges the
seen_urls TTL so that the periodic re-crawl is fast (a few seconds
in the common case where no new items exist).
"""
import argparse
import os
import sqlite3
import sys
import time

PKG_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PKG_ROOT not in sys.path:
    sys.path.insert(0, PKG_ROOT)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="AKIRA live-crawl cycle (subset of harvest_run)"
    )
    p.add_argument(
        "--max-sources",
        type=int,
        default=50,
        help="Number of sources to crawl per cycle (default 50)",
    )
    p.add_argument(
        "--recheck-window",
        type=int,
        default=30,
        help="Minutes after which an already-seen URL is re-fetched "
        "(default 30). Set 0 to disable dedup.",
    )
    p.add_argument(
        "--db",
        default=os.environ.get(
            "AKIRA_DB",
            os.path.join(PKG_ROOT, "data", "akira.db"),
        ),
        help="Path to the AKIRA SQLite database",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not os.path.exists(args.db):
        print(f"akira_db_not_found db={args.db}", flush=True)
        return 1

    conn = sqlite3.connect(args.db, timeout=300)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=120000")

    # Pick the top N sources by oldest-last-harvest. This rotates the
    # crawl fleet across cycles so nothing gets starved.
    rows = conn.execute(
        """
        SELECT s.id, s.url
        FROM sources s
        WHERE s.is_active = 1
          -- Skip sources with credibility < 30 (not verified); they
          -- still get crawled via the full cycle but with lower
          -- priority. Sources with NULL credibility (new ones) are kept.
          AND (COALESCE(s.credibility_score, 50) >= 30)
        ORDER BY (CASE WHEN COALESCE(s.credibility_score, 50) IS NULL THEN 1 ELSE 0 END),
                 COALESCE(s.credibility_score, 50) DESC,
                 COALESCE(NULLIF(s.last_harvest_at, '1970-01-01'), '1970-01-01') ASC,
                 s.id ASC
        LIMIT ?
        """,
        (args.max_sources,),
    ).fetchall()

    if not rows:
        print(
            f"no_active_sources db={args.db} — nothing to crawl",
            flush=True,
        )
        conn.close()
        return 0

    # Mark only the chosen sources for a fresh harvest.
    chosen_ids = [r[0] for r in rows]
    placeholders = ",".join("?" * len(chosen_ids))
    conn.execute(
        f"UPDATE sources SET last_harvest_at = '1970-01-01' "
        f"WHERE id IN ({placeholders})",
        chosen_ids,
    )

    # Refresh seen_urls: drop entries newer than --recheck-window so
    # the cycle re-confirms the most recent items (catches updates).
    if args.recheck_window > 0:
        cutoff = int(time.time()) - (args.recheck_window * 60)
        deleted = conn.execute(
            "DELETE FROM seen_urls WHERE last_seen_at > ?", (cutoff,)
        ).rowcount
        print(
            f"harvest_full_cycle_pruned_seen_urls={deleted} "
            f"window_minutes={args.recheck_window}",
            flush=True,
        )
    conn.commit()
    conn.close()

    # Defer the actual crawl to harvest_run.py — it owns the cascade,
    # the LM-Studio enrichment flags, and the byline handling we
    # don't want to duplicate here.
    import subprocess

    cmd = [
        sys.executable,
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "harvest_run.py"),
    ]
    print(
        f"harvest_full_cycle_invoking max_sources={args.max_sources} "
        f"chosen={len(chosen_ids)}",
        flush=True,
    )
    rc = subprocess.call(cmd, env={**os.environ, "PYTHONPATH": PKG_ROOT})
    return rc


if __name__ == "__main__":
    sys.exit(main())
