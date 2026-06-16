#!/usr/bin/env python3
"""
Discover radio stations in pueblos without media coverage.

For each pueblo (gobierno local) in argentine_towns that has no
media in argentine_media, this script:

  1. Calls Radio Garden's public search API
     (https://radio.garden/api/ara/content/search?q=<town>)
  2. For each radio result, fetches the channel details
     to get website + stream URL
  3. Imports into argentine_media with source='radio-garden-search'

Re-runnable. Search is rate-limited (0.3s between calls) to be
polite to Radio Garden's public API. Skip towns that already
have media to avoid wasted work.

CLI:
    --limit N         Stop after N towns (for testing)
    --min-pop N       Only search pueblos with population >= N
    --delay SECONDS   Sleep between API calls (default 0.3)
    --workers N       Concurrent search workers (default 2)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Tuple

import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import coverage


LOGGER = logging.getLogger("akira.discovery.radio_garden")

RADIO_GARDEN_SEARCH = "https://radio.garden/api/ara/content/search"
RADIO_GARDEN_CHANNEL = "https://radio.garden/api/ara/content/channel/{channel_id}"

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://radio.garden/",
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Discover radios per town via Radio Garden search"
    )
    p.add_argument("--db", default=coverage.DEFAULT_DB,
                    help="AKIRA sqlite path")
    p.add_argument("--limit", type=int, default=0,
                    help="Stop after N towns (0 = no limit)")
    p.add_argument("--min-pop", type=int, default=4000,
                    help="Skip pueblos smaller than this")
    p.add_argument("--delay", type=float, default=0.3,
                    help="Seconds between API calls (be polite)")
    p.add_argument("--workers", type=int, default=2,
                    help="Concurrent search workers")
    p.add_argument("--dry-run", action="store_true",
                    help="Don't write to DB, just count what would be found")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


def http_get_json(url: str, timeout: float = 10.0) -> Optional[dict]:
    """GET url and return JSON or None on error. Polite retry-once."""
    req = urllib.request.Request(url, headers=DEFAULT_HEADERS)
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            if attempt == 1:
                LOGGER.debug("http_get_json failed url=%s err=%s", url, e)
                return None
            time.sleep(0.5)


def search_radio_garden(query: str) -> List[Dict]:
    """Search Radio Garden and return raw channel results.

    Response shape (verified with the live API):
        {"data": {"content": [
            {"itemsType": "channel", "items": [
                {"page": {
                    "id": "DwltQmqV",
                    "title": "Radio Lushnja 95.5 FM",
                    "website": "https://radiolushnja.al",
                    "stream": "radiolushnja.al",
                    "place": {"id": "2XFMJk1w", "title": "Lushnjë"},
                    "country": {"title": "Albania"},
                    ...
                }},
                ...
            ]},
            ...
        ]}}

    Each item is wrapped in a "page" key. We extract the page
    content so downstream code can read .id, .title, .website, etc
    directly.
    """
    url = f"{RADIO_GARDEN_SEARCH}?q={urllib.parse.quote(query)}"
    data = http_get_json(url)
    if not data:
        return []
    channels: List[Dict] = []
    for block in data.get("data", {}).get("content", []):
        if block.get("itemsType") == "channel":
            for item in block.get("items", []):
                if "page" in item:
                    channels.append(item["page"])
    return channels


def get_channel_details(channel_id: str) -> Optional[Dict]:
    """Fetch full channel details (stream URL, website, etc)."""
    url = RADIO_GARDEN_CHANNEL.format(channel_id=channel_id)
    return http_get_json(url)


def search_town(
    conn: Optional[sqlite3.Connection],
    town_name: str,
    town_province: str,
    town_codgl: str,
    *,
    delay: float = 0.3,
) -> Tuple[str, int]:
    """Search Radio Garden for one pueblo. Returns (town_name, found_count)."""
    # Try 2 query variants to maximize recall:
    # 1. Just the town name (catches most cases)
    # 2. "town_name radio" (catches when generic words don't return)
    queries = [town_name, f"{town_name} radio"]
    found_ids: set[str] = set()
    inserted = 0

    for q in queries:
        if delay > 0:
            time.sleep(delay)
        results = search_radio_garden(q)
        for page in results:
            cid = page.get("id")
            if not cid or cid in found_ids:
                continue
            found_ids.add(cid)

            # Page already has website + stream hint. Try a deeper
            # fetch for streamUrl that some radios expose.
            if delay > 0:
                time.sleep(delay)
            details = get_channel_details(cid)
            if not details:
                continue

            # Merge page-level and detail-level data
            website = page.get("website") or details.get("website", "")
            stream_url = (
                details.get("streamUrl")
                or details.get("url")
                or page.get("stream", "")
            )
            place = page.get("place", {}).get("title", "")
            country = page.get("country", {}).get("title", "")
            tags = ",".join(details.get("tags", []) or page.get("tags", []))

            # Filter to AR results only — Radio Garden is global and
            # searching for "Pergamino" might return an Albanian station
            # whose place sounds similar. We accept any AR result.
            if country and country != "Argentina":
                continue

            # If we found a radio in a different city, use the searched
            # pueblo as the canonical city (Radio Garden groups nearby
            # stations under the same place).
            actual_city = place or town_name

            if conn is None:
                # dry-run: count only
                inserted += 1
                LOGGER.info("  [dry] + %s: %s (place=%s)",
                            town_name, page.get("title", "?"), place)
                continue

            ok = coverage.import_radio(
                conn,
                name=page.get("title", ""),
                type="radio",
                city=actual_city,
                province=town_province,
                codgl=town_codgl,
                website=website,
                stream_url=stream_url,
                tags=tags,
                source="radio-garden-search",
            )
            if ok:
                inserted += 1
                LOGGER.info("  + %s: %s (place=%s)",
                            town_name, page.get("title", "?"), place)

    return town_name, inserted


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    conn = coverage.get_connection(args.db)

    # Get pueblos without media
    sql = """
        SELECT t.name, t.province, t.codgl, t.population
        FROM argentine_towns t
        LEFT JOIN argentine_media m ON t.codgl = m.codgl
        WHERE m.id IS NULL
          AND t.population >= ?
        ORDER BY t.population DESC
    """
    uncovered = conn.execute(sql, (args.min_pop,)).fetchall()
    if args.limit > 0:
        uncovered = uncovered[: args.limit]
    print(f"Searching {len(uncovered)} pueblos (min pop {args.min_pop})...")

    if args.dry_run:
        print("--dry-run: would not write to DB")

    t0 = time.monotonic()
    found_total = 0
    towns_with_match = 0
    done = 0

    if args.workers == 1:
        for name, prov, codgl, pop in uncovered:
            _, n = search_town(
                conn if not args.dry_run else None,
                name, prov, codgl,
                delay=args.delay,
            )
            _ = pop  # unused but kept for clarity
            done += 1
            found_total += n
            if n > 0:
                towns_with_match += 1
            if done % 25 == 0:
                elapsed = time.monotonic() - t0
                rate = done / elapsed
                eta = (len(uncovered) - done) / rate if rate > 0 else 0
                print(f"  [{done}/{len(uncovered)}] {found_total} found, "
                      f"{towns_with_match} towns matched, "
                      f"rate {rate:.1f}/s, ETA {eta/60:.0f}min")
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = {
                ex.submit(
                    search_town,
                    conn if not args.dry_run else None,
                    name, prov, codgl,
                    delay=args.delay,
                ): (name, codgl)
                for name, prov, codgl, _pop in uncovered
            }
            for fut in as_completed(futures):
                name, _ = futures[fut]
                try:
                    _, n = fut.result()
                except Exception as e:  # noqa: BLE001
                    LOGGER.warning("town=%s err=%s", name, e)
                    n = 0
                done += 1
                found_total += n
                if n > 0:
                    towns_with_match += 1
                if done % 25 == 0:
                    elapsed = time.monotonic() - t0
                    rate = done / elapsed
                    eta = (len(uncovered) - done) / rate if rate > 0 else 0
                    print(f"  [{done}/{len(uncovered)}] {found_total} found, "
                          f"{towns_with_match} towns matched, "
                          f"rate {rate:.1f}/s, ETA {eta/60:.0f}min")

    if not args.dry_run:
        conn.commit()

    elapsed = time.monotonic() - t0
    print(f"\nDone: {found_total} new media in {towns_with_match} pueblos "
          f"({done} searched) in {elapsed/60:.1f}min")

    if not args.dry_run:
        s = coverage.stats(conn)
        print(f"Total coverage: {s['covered_towns']}/{s['total_towns']} "
              f"({s['coverage_pct']}%)")
        print(f"Total media: {sum(s['by_type'].values())}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
