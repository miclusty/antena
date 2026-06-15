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

    # 1) Fix double-slash URLs (//rss, //feed, //wp-json, //v2/posts)
    #    These are typos in the registered URL that return
    #    404 even though the source is alive. Normalize any
    #    run of slashes after the protocol to a single slash,
    #    and collapse repeated slashes anywhere in the path.
    def fix_url(url: str) -> str:
        if not url:
            return url
        # Collapse // that appears right after the host
        fixed = re.sub(r"(://[^/]+)//+", r"\1/", url)
        # Collapse remaining // runs in the path
        if "://" in fixed:
            proto, rest = fixed.split("://", 1)
            rest = re.sub(r"/+", "/", rest)
            fixed = proto + "://" + rest
        return fixed

    active_sources = conn.execute(
        "SELECT id, rss_url, wp_api_url FROM sources WHERE is_active = 1"
    ).fetchall()
    fixed_count = 0
    for sid, rss, wp in active_sources:
        new_rss = fix_url(rss)
        new_wp = fix_url(wp)
        if new_rss != rss or new_wp != wp:
            conn.execute(
                "UPDATE sources SET rss_url = ?, wp_api_url = ? WHERE id = ?",
                (new_rss, new_wp, sid),
            )
            fixed_count += 1
    print(f"\n[fix] Normalized {fixed_count} URLs with double slashes")
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
