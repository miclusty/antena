#!/usr/bin/env python3
"""Re-extract body for new news_cards using trafilatura.

The cascade extracts summary from the RSS feed, but
the body column stays empty. This script fills it in:

For each card in `news_cards` where body is empty/null
and article_url is set, fetch the article with
trafilatura, extract the body, and UPDATE the row.

Optionally a `--since-hours` filter limits the scope
to recent cards (e.g. the last 24h).

Run on the production machine after harvest_run.py.

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/enrich_body_trafilatura.py
    python scripts/enrich_body_trafilatura.py --since-hours 24
    python scripts/enrich_body_trafilatura.py --limit 100
"""
import argparse
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

import trafilatura

DB_PATH = Path("data/akira.db")
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def fetch_and_extract(url: str) -> str | None:
    """Fetch a URL and extract its main body text via trafilatura."""
    try:
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            return None
        extracted = trafilatura.extract(
            downloaded,
            output_format="txt",
            include_comments=False,
            include_tables=False,
            favor_precision=False,
            with_metadata=False,
        )
        if extracted and len(extracted.strip()) >= 200:
            return extracted.strip()
    except Exception as e:
        print(f"  [err] {type(e).__name__}: {str(e)[:60]}")
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since-hours", type=int, default=0, help="Only enrich cards created in the last N hours (default: 0 = all)")
    ap.add_argument("--limit", type=int, default=0, help="Max cards to process (default: 0 = no limit)")
    ap.add_argument("--max-body-chars", type=int, default=8000, help="Max chars to store in body (default: 8000)")
    ap.add_argument("--dry-run", action="store_true", help="Don't UPDATE, just report")
    args = ap.parse_args()

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    where_clauses = ["(body IS NULL OR body = '')"]
    params: list = []
    if args.since_hours > 0:
        where_clauses.append("created_at > datetime('now', ?)")
        params.append(f"-{args.since_hours} hours")
    sql = f"SELECT id, article_url, source_url, title, length(summary) as sum_len FROM news_cards WHERE {' AND '.join(where_clauses)} ORDER BY created_at DESC"
    if args.limit > 0:
        sql += f" LIMIT {args.limit}"

    rows = conn.execute(sql, params).fetchall()
    print(f"[enrich] {len(rows)} cards with empty body", flush=True)

    updated = 0
    failed = 0
    no_article_url = 0
    start = time.monotonic()

    for i, row in enumerate(rows, 1):
        target = row["article_url"] or row["source_url"]
        if not target or "feeds.bbci" in target or target.endswith("/rss") or target.endswith("/feed") or target.endswith("/feed/"):
            # RSS feed URLs don't have a body — skip
            no_article_url += 1
            continue

        body = fetch_and_extract(target)
        if body and len(body) >= 200:
            body_clipped = body[:args.max_body_chars]
            if not args.dry_run:
                conn.execute(
                    "UPDATE news_cards SET body = ? WHERE id = ?",
                    (body_clipped, row["id"]),
                )
            updated += 1
            elapsed = time.monotonic() - start
            print(
                f"  [{i:>4}/{len(rows)}] ✓ {row['title'][:40]:<40} | body={len(body_clipped):>5}c | {elapsed:.0f}s",
                flush=True,
            )
        else:
            failed += 1
            if i % 20 == 0:
                elapsed = time.monotonic() - start
                print(
                    f"  [{i:>4}/{len(rows)}] ✗ {row['title'][:40]:<40} | no body | {elapsed:.0f}s",
                    flush=True,
                )

        # Commit every 50 rows
        if not args.dry_run and i % 50 == 0:
            conn.commit()

    if not args.dry_run:
        conn.commit()
    conn.close()

    elapsed = time.monotonic() - start
    print(f"\n[done] updated={updated}  failed={failed}  skipped_rss={no_article_url}  elapsed={elapsed:.0f}s")


if __name__ == "__main__":
    main()
