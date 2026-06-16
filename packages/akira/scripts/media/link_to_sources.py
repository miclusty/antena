#!/usr/bin/env python3
"""
Link argentine_media entries into AKIRA's sources table.

For each media entry in argentine_media that has a website URL but
is NOT yet in the `sources` table, this script:

  1. Discovers the RSS feed by:
     a. Trying common feed paths (/feed, /rss, /rss.xml, /atom.xml,
        /feed/rss, /noticias/feed)
     b. Parsing the homepage HTML for <link rel="alternate">
        tags with type="application/rss+xml"
  2. Inserts a row into `sources` (url, name, rss_url, type='radio',
     location_id derived from codgl, province from media row)

Re-runnable. Existing sources are skipped (UNIQUE on url).

CLI:
    --limit N        Process at most N media entries
    --type TYPE      Only 'radio' (default) or 'diario' or 'web'
    --dry-run        Show what would be linked, don't write
"""

from __future__ import annotations

import argparse
import logging
import os
import sqlite3
import sys
import time
from typing import Optional
from urllib.parse import urljoin, urlparse

import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import coverage


LOGGER = logging.getLogger("akira.media.link_sources")

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html, application/xml, */*",
}

# Common RSS feed paths to probe. Order matters: we stop at the
# first one that returns 200 + looks like XML.
COMMON_FEED_PATHS = [
    "/feed",
    "/feed/",
    "/feed/rss",
    "/feed/rss2",
    "/feed/atom",
    "/rss",
    "/rss.xml",
    "/rss/news.xml",
    "/rss/noticias.xml",
    "/atom.xml",
    "/noticias/feed",
    "/noticias/rss",
    "/blog/feed",
    "/index.rss",
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Link argentine_media entries to AKIRA sources"
    )
    p.add_argument("--db", default=coverage.DEFAULT_DB,
                    help="AKIRA sqlite path")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--type", default="radio",
                    choices=["radio", "diario", "tv", "web"])
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


def http_get(url: str, timeout: float = 10.0) -> Optional[bytes]:
    """GET a URL with a polite user agent. Returns body or None."""
    req = urllib.request.Request(url, headers=DEFAULT_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ct = resp.headers.get("Content-Type", "")
            if resp.status != 200:
                return None
            return resp.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        LOGGER.debug("http_get %s err=%s", url, e)
        return None


def looks_like_rss(body: bytes) -> bool:
    """Heuristic: does the body smell like an RSS/Atom feed?"""
    head = body[:512].lower()
    return (
        b"<rss" in head
        or b"<feed" in head
        or b"<atom" in head
        or b"<?xml" in head and b"channel" in head
    )


def discover_feed_via_html(website: str) -> Optional[str]:
    """Parse homepage HTML for <link rel="alternate"> RSS pointer."""
    body = http_get(website)
    if not body:
        return None
    try:
        html = body.decode("utf-8", errors="ignore")
    except Exception:
        return None

    # Match: <link rel="alternate" type="application/rss+xml" href="...">
    import re
    pattern = re.compile(
        r'<link[^>]+rel=["\']alternate["\'][^>]+'
        r'type=["\']application/(?:rss|atom)\+xml["\']'
        r'[^>]+href=["\']([^"\']+)["\']',
        re.IGNORECASE,
    )
    m = pattern.search(html)
    if m:
        return urljoin(website, m.group(1))

    # Reverse attribute order: type before rel
    pattern2 = re.compile(
        r'<link[^>]+type=["\']application/(?:rss|atom)\+xml["\']'
        r'[^>]+href=["\']([^"\']+)["\']',
        re.IGNORECASE,
    )
    m = pattern2.search(html)
    if m:
        return urljoin(website, m.group(1))
    return None


def discover_feed_by_probe(website: str) -> Optional[str]:
    """Try common feed paths. Returns the first one that returns 200
    and looks like XML."""
    parsed = urlparse(website)
    base = f"{parsed.scheme}://{parsed.netloc}"
    for path in COMMON_FEED_PATHS:
        url = base + path
        body = http_get(url, timeout=5.0)
        if body and looks_like_rss(body):
            return url
    return None


def discover_rss(website: str) -> Optional[str]:
    """Two-stage RSS discovery: HTML link first, then path probe.

    The HTML link method is more accurate (the publisher's
    declared feed) but fails when the page is JS-rendered or
    when the site doesn't expose feeds on the homepage. The
    path probe is the fallback. Both are polite (10s timeouts,
    user agent, no aggressive retries).
    """
    feed = discover_feed_via_html(website)
    if feed:
        return feed
    return discover_feed_by_probe(website)


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    conn = coverage.get_connection(args.db)

    # Find media entries with a website that are NOT in sources yet
    sql = """
        SELECT m.id, m.name, m.website, m.city, m.province, m.codgl, m.type
        FROM argentine_media m
        WHERE m.website IS NOT NULL AND m.website != ''
          AND m.type = ?
          AND m.website NOT IN (SELECT url FROM sources WHERE url IS NOT NULL)
    """
    pending = conn.execute(sql, (args.type,)).fetchall()
    if args.limit > 0:
        pending = pending[: args.limit]
    print(f"Found {len(pending)} {args.type} media entries to link")

    linked = 0
    rss_found = 0
    no_rss = 0
    fallback_linked = 0
    failed = 0
    t0 = time.monotonic()

    for media_id, name, website, city, province, codgl, mtype in pending:
        # The website might not be reachable; if so skip with a
        # polite error log so we don't hammer a dead server.
        feed_url = discover_rss(website)
        if feed_url:
            LOGGER.info("  + %s | feed=%s", name, feed_url)
            rss_found += 1
            if not args.dry_run:
                try:
                    conn.execute("""
                        INSERT INTO sources
                            (name, url, rss_url, type, province, location_id,
                             extraction_method, is_active, reliability_score)
                        VALUES (?, ?, ?, ?, ?, ?, 'rss', 1, 0.5)
                    """, (
                        name, website, feed_url, mtype, province, None,
                    ))
                    linked += 1
                except sqlite3.IntegrityError:
                    LOGGER.debug("  source already exists: %s", website)
        else:
            # No RSS feed. Register the website anyway with
            # extraction_method='playwright' so AKIRA's existing
            # Playwright extractor crawls the homepage on the next
            # pipeline run. Playwright + Goose + Newspaper can
            # find article URLs in most small-town news sites.
            LOGGER.info("  fallback: %s (%s) — will use Playwright",
                        name, website)
            no_rss += 1
            if not args.dry_run:
                try:
                    conn.execute("""
                        INSERT INTO sources
                            (name, url, rss_url, type, province, location_id,
                             extraction_method, is_active, reliability_score)
                        VALUES (?, ?, NULL, ?, ?, ?, 'playwright', 1, 0.4)
                    """, (
                        name, website, mtype, province, None,
                    ))
                    fallback_linked += 1
                except sqlite3.IntegrityError:
                    LOGGER.debug("  source already exists: %s", website)

        # Polite delay
        time.sleep(0.3)

    conn.commit()
    elapsed = time.monotonic() - t0

    print(f"\nProcessed {len(pending)} in {elapsed/60:.1f}min")
    print(f"RSS discovered: {rss_found}, no RSS: {no_rss}")
    if not args.dry_run:
        print(f"Linked to sources (RSS): {linked}")
        print(f"Linked to sources (Playwright fallback): {fallback_linked}")
        s = coverage.stats(conn)
        print(f"Coverage: {s['covered_towns']}/{s['total_towns']} "
              f"({s['coverage_pct']}%)")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
