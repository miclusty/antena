#!/usr/bin/env python3
# DEPRECATED 2026-06-20: Manual feed discovery for sources without RSS.
# Superseded by the feed auto-discovery logic in RSSExtractor._discover_feed.
# Do NOT run this script unless you know what you're doing. See git history
# for the implementation if you need to revive it.
#
# Original docstring preserved below for reference.
#
"""Auto-discover RSS / Atom feeds for sources that don't have one.

For every active source with rss_url IS NULL OR rss_url = '',
we try a list of well-known feed paths in parallel and check the
HTTP response:

  1. /rss
  2. /rss/
  3. /feed
  4. /feed/
  5. /feed/rss
  6. /atom.xml
  7. /rss.xml
  8. /index.xml
  9. /?feed=rss
  10. /?feed=atom
  11. /feed.xml
  12. /blog/feed (WordPress fallback)

For each successful path, the script validates the response body
is a parseable RSS / Atom / RDF feed (using feedparser). If so, it
updates the source's rss_url in the local SQLite database.

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/discover_feeds.py [--concurrency 16] [--limit 200]

Note: this script writes to the LOCAL SQLite only. The sync_to_d1_remote
script propagates rss_url changes to D1 on the next sync.
"""

import argparse
import asyncio
import sqlite3
import sys
import os
import re
import xml.etree.ElementTree as ET
from urllib.parse import urlparse
from typing import Optional

# Add package root to path
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

try:
    import aiohttp
    import feedparser
except ImportError:
    print("Missing deps. Run: pip install aiohttp feedparser", file=sys.stderr)
    sys.exit(1)

AKIRA_DB = os.path.join(os.path.dirname(HERE), "data", "akira.db")

# Common feed path patterns to try, in priority order.
# Static paths first (most common), then ?query= variants.
CANDIDATE_PATHS = [
    "/rss",
    "/rss/",
    "/feed",
    "/feed/",
    "/feed/rss",
    "/feed/atom",
    "/atom.xml",
    "/rss.xml",
    "/index.xml",
    "/feed.xml",
    "/blog/feed",
    "/?feed=rss",
    "/?feed=atom",
]


def is_valid_feed(body: str, content_type: str) -> bool:
    """Cheap heuristic: is this a parseable RSS/Atom/RDF body?

    feedparser.parse() is more thorough but slow. We do a fast
    XML sniff first and only fall back to feedparser for ambiguous
    cases (mostly to support non-XML feeds like JSON Feed).
    """
    if not body:
        return False
    lower = body.lstrip()[:512].lower()
    # RSS 2.0 / 0.92 / 0.91
    if lower.startswith("<?xml") or lower.startswith("<rss"):
        if "<rss" in lower or "<channel" in lower or "<feed" in lower:
            return True
    # Atom
    if "<feed" in lower and "xmlns=\"http://www.w3.org/2005/atom\"" in lower:
        return True
    # RDF (older RSS 1.0)
    if "<rdf" in lower and "<rss" in lower:
        return True
    # JSON Feed
    if lower.startswith("{") and "\"version\":" in lower and "\"items\":" in lower:
        return True
    return False


def normalize_url(url: str) -> str:
    """Strip trailing slashes for path joining."""
    return url.rstrip("/")


async def probe_feed(
    session: aiohttp.ClientSession,
    base_url: str,
    path: str,
    timeout: float = 8.0,
) -> Optional[str]:
    """Try a single candidate path. Return the full URL if it returns
    a valid feed, None otherwise."""
    target = normalize_url(base_url) + path
    try:
        async with session.get(
            target,
            timeout=aiohttp.ClientTimeout(total=timeout),
            allow_redirects=True,
            headers={"User-Agent": "Antena-AKIRA/1.0 (+https://antena.com.ar)"},
        ) as resp:
            if resp.status >= 400:
                return None
            ct = resp.headers.get("content-type", "").lower()
            # Most feeds are XML, but some are JSON (JSON Feed).
            if "xml" not in ct and "json" not in ct and "rss" not in ct and "atom" not in ct:
                return None
            body = await resp.text(errors="ignore")
            if not is_valid_feed(body, ct):
                return None
            # Sanity: try to parse with feedparser to be extra-sure.
            parsed = feedparser.parse(body)
            if not parsed or not parsed.entries:
                return None
            return target
    except (aiohttp.ClientError, asyncio.TimeoutError):
        return None
    except Exception:
        return None


async def discover_for_source(
    session: aiohttp.ClientSession,
    source: tuple,
    semaphore: asyncio.Semaphore,
) -> "Optional[tuple]":
    """Try all CANDIDATE_PATHS for a single source. Return the
    first working feed URL as (source_id, name, url), or None."""
    source_id, name, url = source
    async with semaphore:
        # Try paths serially within a source (no need to spam
        # a single host with parallel probes).
        for path in CANDIDATE_PATHS:
            result = await probe_feed(session, url, path)
            if result:
                return source_id, name, result
    return None


def load_sources_without_feeds(db_path: str, limit: Optional[int] = None) -> list:
    conn = sqlite3.connect(db_path)
    query = """
        SELECT id, name, url
        FROM sources
        WHERE is_active = 1
          AND (rss_url IS NULL OR rss_url = '')
          AND url IS NOT NULL AND url != ''
        ORDER BY reliability_score DESC, news_count DESC
    """
    if limit is not None:
        query += f" LIMIT {int(limit)}"
    rows = conn.execute(query).fetchall()
    conn.close()
    return rows


def update_source_feed(db_path: str, source_id: int, rss_url: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute(
        "UPDATE sources SET rss_url = ? WHERE id = ?",
        (rss_url, source_id),
    )
    conn.commit()
    conn.close()


async def run(db_path: str, concurrency: int, limit: Optional[int]) -> None:
    sources = load_sources_without_feeds(db_path, limit=limit)
    if not sources:
        print("No sources without feeds. All set.")
        return
    print(f"Discovering feeds for {len(sources)} sources (concurrency={concurrency})")

    semaphore = asyncio.Semaphore(concurrency)
    found = 0
    errors = 0
    connector = aiohttp.TCPConnector(limit=concurrency, limit_per_host=1, ttl_dns_cache=300)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [
            asyncio.create_task(discover_for_source(session, src, semaphore))
            for src in sources
        ]
        for i, coro in enumerate(asyncio.as_completed(tasks), 1):
            result = await coro
            if result is None:
                errors += 1
            else:
                source_id, name, rss_url = result
                update_source_feed(db_path, int(source_id), rss_url)
                found += 1
                print(f"  [{i}/{len(sources)}] ✓ {name}: {rss_url}")
            if i % 50 == 0:
                print(f"  Progress: {i}/{len(sources)} (found {found}, miss {errors})")
    print(f"\nDone. Discovered {found}/{len(sources)} feeds ({100*found/len(sources):.1f}%)")
    print(f"  Failures: {errors} (404, timeout, or non-feed response)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--db",
        default=AKIRA_DB,
        help="Path to akira.db (default: %(default)s)",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=16,
        help="Max concurrent HTTP probes (default: %(default)s)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max sources to process (default: all)",
    )
    args = parser.parse_args()
    asyncio.run(run(args.db, args.concurrency, args.limit))


if __name__ == "__main__":
    main()
