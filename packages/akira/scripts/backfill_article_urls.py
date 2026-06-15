#!/usr/bin/env python3
"""Backfill article_url for cards that have body=0.

The harvest_run.py captures article_url at INSERT time
for new cards. But cards created before that fix have
article_url=NULL and only the source homepage in
source_url. We need the per-article URL to fetch the
article body with trafilatura.

Strategy:
1. For each source with cards needing body, fetch the
   RSS feed (or sitemap) to get the current list of
   article URLs.
2. Build a title -> URL index from that.
3. For each pending card in the local SQLite, fuzzy
   match its title against the index. On a hit, write
   the article_url and (optionally) run trafilatura to
   populate the body.

This is best-effort: titles often differ between the
RSS feed and the card row (RSS uses feed title, card
uses normalized title, news sites rewrite titles
constantly). Match threshold is 70% Levenshtein
similarity.

Run on the production machine:
    cd packages/akira
    source .venv/bin/activate
    python scripts/backfill_article_urls.py [--limit 1000]
"""
import argparse
import difflib
import re
import sqlite3
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlparse

import feedparser
import trafilatura

DB_PATH = Path("data/akira.db")


def normalize_title(t: str) -> str:
    """Lowercase, strip diacritics + punctuation, collapse spaces.
    Used for fuzzy title matching between RSS feeds and stored
    card rows. Same logic on both sides."""
    if not t:
        return ""
    t = unicodedata.normalize("NFKD", t)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = t.lower()
    t = re.sub(r"[^\w\s]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    # Drop common stop words that vary between RSS and DB
    stop = {"el", "la", "los", "las", "de", "del", "en", "un", "una", "y", "el", "los"}
    return " ".join(w for w in t.split() if w not in stop)


def fetch_feed_items(feed_url: str) -> list[dict]:
    """Return [{title, url}] for a RSS/Atom feed."""
    try:
        feed = feedparser.parse(feed_url)
        return [
            {"title": e.get("title", ""), "url": e.get("link", "")}
            for e in feed.entries[:60]
            if e.get("title") and e.get("link")
        ]
    except Exception as e:
        sys.stderr.write(f"  [err feed {feed_url}]: {e}\n")
        return []


def fetch_and_extract_body(url: str) -> str | None:
    try:
        d = trafilatura.fetch_url(url)
        if not d:
            return None
        b = trafilatura.extract(d, output_format="txt", include_comments=False, include_tables=False)
        if b and len(b.strip()) >= 200:
            return b.strip()
    except Exception:
        return None
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="Max cards to process (default: all)")
    ap.add_argument("--workers", type=int, default=8, help="Parallel feed fetches")
    ap.add_argument("--max-body-chars", type=int, default=8000)
    ap.add_argument("--no-body", action="store_true", help="Only set article_url, don't fetch body")
    ap.add_argument("--match-threshold", type=float, default=0.7)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    # Cards sin body, agrupadas por source_id
    pending_by_source = {}
    rows = conn.execute("""
      SELECT id, title, source_ids
      FROM news_cards
      WHERE (body IS NULL OR body = '')
        AND source_ids IS NOT NULL AND source_ids != ''
        AND (article_url IS NULL OR article_url = '' OR article_url = source_url)
    """).fetchall()
    for r in rows:
        pending_by_source.setdefault(r["source_ids"], []).append(r)
    if args.limit:
        # Truncate to limit
        seen = 0
        truncated = {}
        for sid, lst in pending_by_source.items():
            for r in lst:
                if seen >= args.limit:
                    break
                truncated.setdefault(sid, []).append(r)
                seen += 1
        pending_by_source = truncated

    total_cards = sum(len(v) for v in pending_by_source.values())
    print(f"[backfill] {total_cards} cards across {len(pending_by_source)} sources", flush=True)

    # Get source RSS URLs
    sources = {}
    for sid in pending_by_source:
        row = conn.execute(
            "SELECT id, name, rss_url, url FROM sources WHERE id = ?", (sid,)
        ).fetchone()
        if row:
            sources[sid] = dict(row)

    # Fetch feeds in parallel
    feed_index = {}  # source_id -> [(normalized_title, url)]
    print(f"[fetch] {len(sources)} feeds with {args.workers} workers", flush=True)
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {
            ex.submit(fetch_feed_items, sources[sid].get("rss_url") or sources[sid].get("url", "")): sid
            for sid in sources
            if sources[sid].get("rss_url") or sources[sid].get("url")
        }
        for fut in as_completed(futures):
            sid = futures[fut]
            items = fut.result()
            feed_index[sid] = [(normalize_title(i["title"]), i["url"]) for i in items if i["title"] and i["url"]]
            if len(feed_index[sid]) == 0:
                sys.stderr.write(f"  [warn] {sources[sid]['name']}: feed empty or unreachable\n")

    # Match
    matched = 0
    enriched = 0
    for sid, cards in pending_by_source.items():
        index = feed_index.get(sid, [])
        for r in cards:
            target = normalize_title(r["title"])
            if not target:
                continue
            best_url = None
            best_score = 0.0
            for nt, url in index:
                score = difflib.SequenceMatcher(None, target, nt).ratio()
                if score > best_score:
                    best_score = score
                    best_url = url
            if best_score >= args.match_threshold and best_url:
                matched += 1
                if not args.dry_run:
                    conn.execute(
                        "UPDATE news_cards SET article_url = ? WHERE id = ?",
                        (best_url, r["id"]),
                    )

    conn.commit()
    print(f"[match] {matched} titles matched (threshold {args.match_threshold})", flush=True)

    if not args.no_body and not args.dry_run:
        # Now re-query for cards that just got article_url and still lack body
        rows2 = conn.execute("""
          SELECT id, article_url FROM news_cards
          WHERE (body IS NULL OR body = '')
            AND article_url IS NOT NULL AND article_url != ''
          ORDER BY created_at DESC
        """).fetchall()
        print(f"[body] enriching {len(rows2)} cards with article_url ({args.workers} workers)", flush=True)
        enriched = 0
        start = time.monotonic()
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = {ex.submit(fetch_and_extract_body, r["article_url"]): r for r in rows2}
            done = 0
            for fut in as_completed(futures):
                r = futures[fut]
                done += 1
                body = fut.result()
                if body:
                    body = body[:args.max_body_chars]
                    conn.execute(
                        "UPDATE news_cards SET body = ? WHERE id = ?",
                        (body, r["id"]),
                    )
                    enriched += 1
                if done % 100 == 0 or done == len(rows2):
                    elapsed = time.monotonic() - start
                    rate = done / elapsed if elapsed else 0
                    print(
                        f"  [{done:>5}/{len(rows2)}] enriched={enriched} {rate:.1f}/s {elapsed:.0f}s",
                        flush=True,
                    )
                if done % 200 == 0:
                    conn.commit()
        conn.commit()

    conn.close()
    print(f"\n[done] matched={matched}  enriched={enriched}")


if __name__ == "__main__":
    main()
