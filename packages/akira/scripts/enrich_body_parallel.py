#!/usr/bin/env python3
"""Parallel body enrichment with trafilatura.

Like enrich_body_trafilatura.py but uses a thread
pool to fetch multiple articles in parallel. AKIRA
sequential is ~1 card/sec; with 10 workers we
can do ~8 cards/sec on average, which is 8x faster.

The rate of speed is limited by the slowest
source: trafilatura's fetch_url is sync and we
just block on it. There's no real benefit to
more than 20 workers — we run out of source
bandwidth before we run out of CPU.

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/enrich_body_parallel.py
    python scripts/enrich_body_parallel.py --since-hours 24
    python scripts/enrich_body_parallel.py --limit 500
    python scripts/enrich_body_parallel.py --workers 10
"""
import argparse
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import trafilatura

DB_PATH = Path("data/akira.db")


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
        sys.stderr.write(f"  [err] {type(e).__name__}: {str(e)[:60]}\n")
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since-hours", type=int, default=0)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=10, help="Parallel fetches (default: 10)")
    ap.add_argument("--max-body-chars", type=int, default=8000)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only-article-url", action="store_true",
                    help="Only process cards with an article-like URL (skip those whose stored URL is just a feed/sitemap)")
    args = ap.parse_args()

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    where_clauses = ["(body IS NULL OR body = '')"]
    params: list = []
    if args.since_hours > 0:
        where_clauses.append("created_at > datetime('now', ?)")
        params.append(f"-{args.since_hours} hours")
    if args.only_article_url:
        where_clauses.append("article_url IS NOT NULL AND article_url != ''")
        where_clauses.append("article_url NOT LIKE '%/rss%'")
        where_clauses.append("article_url NOT LIKE '%/feed%'")
        where_clauses.append("article_url NOT LIKE '%/sitemap%'")
        where_clauses.append("article_url NOT LIKE '%/atom%'")
        where_clauses.append("article_url NOT LIKE '%.xml'")
    sql = f"SELECT id, article_url, source_url, title FROM news_cards WHERE {' AND '.join(where_clauses)} ORDER BY created_at DESC"
    if args.limit > 0:
        sql += f" LIMIT {args.limit}"

    rows = conn.execute(sql, params).fetchall()
    print(f"[enrich] {len(rows)} cards to process, {args.workers} workers", flush=True)

    if not rows:
        return

    updated = 0
    failed = 0
    start = time.monotonic()

    # Thread pool does the HTTP work; main thread does the
    # SQLite writes (SQLite is single-writer and we don't
    # want concurrent writes clobbering each other).
    def fetch_one(row):
        target = row["article_url"] or row["source_url"]
        if not target:
            return row["id"], None, "no url"
        body = fetch_and_extract(target)
        return row["id"], body, None

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(fetch_one, row): row for row in rows}
        completed = 0
        for fut in as_completed(futures):
            row = futures[fut]
            cid, body, err = fut.result()
            completed += 1
            if body and len(body) >= 200:
                body_clipped = body[: args.max_body_chars]
                if not args.dry_run:
                    conn.execute(
                        "UPDATE news_cards SET body = ? WHERE id = ?",
                        (body_clipped, cid),
                    )
                updated += 1
                if completed % 50 == 0 or completed == len(rows):
                    elapsed = time.monotonic() - start
                    rate = completed / elapsed if elapsed else 0
                    print(
                        f"  [{completed:>5}/{len(rows)}] ✓ {row['title'][:40]:<40} | body={len(body_clipped):>5}c | {rate:.1f}/s | {elapsed:.0f}s",
                        flush=True,
                    )
            else:
                failed += 1

            # Commit periodically
            if not args.dry_run and completed % 100 == 0:
                conn.commit()

    if not args.dry_run:
        conn.commit()
    conn.close()

    elapsed = time.monotonic() - start
    print(
        f"\n[done] updated={updated}  failed={failed}  elapsed={elapsed:.0f}s  rate={updated/elapsed:.1f}/s",
        flush=True,
    )


if __name__ == "__main__":
    main()
