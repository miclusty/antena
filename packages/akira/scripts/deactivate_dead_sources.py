#!/usr/bin/env python3
"""Deactivate dead sources and fix double-slash RSS URLs.

Run once to clean up the sources table:
- Deactivates sources with error_count >= 5 that have
  produced 0 items (dead feeds, anti-bot, sites
  offline). This drops the harvest workload by ~37%
  (from 1,078 active sources to ~680).
- Fixes RSS URLs with accidental double-slash (//rss)
  that returned 404. These were false negatives — the
  medium is alive, the URL was just wrong.

The SQLite change is local; run this script on the
production machine before the next harvest. Or
adapt the SQL for a one-off wrangler d1 command.
"""
import sqlite3
import re
import sys

DB_PATH = sys.argv[1] if len(sys.argv) > 1 else "packages/akira/data/akira.db"


def main():
    conn = sqlite3.connect(DB_PATH)
    print(f"Connecting to {DB_PATH}")

    # 1) Fix double-slash RSS URLs (//rss, //feed)
    broken = conn.execute(
        """
        SELECT id, name, rss_url FROM sources
        WHERE is_active = 1 AND rss_url LIKE '%//rss%'
    """
    ).fetchall()
    print(f"\n[fix] Found {len(broken)} sources with //rss URL")
    for sid, name, rss in broken:
        # Normalize: //rss -> /rss, //feed -> /feed
        fixed = re.sub(r"//+(rss|feed)", r"/\1", rss)
        if fixed != rss:
            conn.execute("UPDATE sources SET rss_url = ? WHERE id = ?", (fixed, sid))
            print(f"  {name[:40]:<40} {rss}  →  {fixed}")
    conn.commit()

    # 2) Deactivate sources with 5+ consecutive errors
    #    and 0 items. These are dead.
    to_disable = conn.execute(
        """
        SELECT id, name, error_count, fetch_count FROM sources
        WHERE is_active = 1 AND news_count = 0 AND error_count >= 5
    """
    ).fetchall()
    print(
        f"\n[disable] Deactivating {len(to_disable)} sources with error_count >= 5 and 0 items"
    )
    cur = conn.execute(
        """
        UPDATE sources
        SET is_active = 0,
            deactivation_reason = 'auto: 5+ errores consecutivos, harvest sin items'
        WHERE is_active = 1 AND news_count = 0 AND error_count >= 5
    """
    )
    conn.commit()
    print(f"  {cur.rowcount} sources deactivated")

    # 3) Report final state
    total = conn.execute("SELECT COUNT(*) FROM sources").fetchone()[0]
    active = conn.execute("SELECT COUNT(*) FROM sources WHERE is_active = 1").fetchone()[0]
    working = conn.execute(
        "SELECT COUNT(*) FROM sources WHERE is_active = 1 AND news_count > 0"
    ).fetchone()[0]
    uncertain = conn.execute(
        "SELECT COUNT(*) FROM sources WHERE is_active = 1 AND news_count = 0"
    ).fetchone()[0]
    print(
        f"\n[result] Total={total} Active={active} Working={working} Uncertain={uncertain}"
    )
    print(
        f"[result] Inactive={(total - active)} ({100 * (total - active) / total:.1f}% of total)"
    )


if __name__ == "__main__":
    main()
