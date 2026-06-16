#!/usr/bin/env python3
"""
Discover local media via municipal government sites.

For each uncovered pueblo (no media in argentine_media):
  1. Look up the pueblo's Wikipedia article (Spanish)
  2. Extract the .gob.ar official municipal site URL from
     the article's external links
  3. Scrape the municipal site for "medios" / "prensa" / "radio"
     / "diario" / "FM" / "AM" sections
  4. Extract all http(s) links matching radio/diario/news patterns
  5. Add each discovered media domain to argentine_media

Why this works:
  - Small Argentine towns ALWAYS have an official .gob.ar site
  - These sites have a "medios de comunicación" or similar section
  - They link to local radios, diarios, TVs, FMs (not provincial
    ones which we already have)
  - Wikipedia reliably points to the right .gob.ar per pueblo

CLI:
    --db PATH        AKIRA sqlite
    --limit N        Process at most N pueblos
    --min-pop N      Only pueblos with pop >= N
    --workers N      Concurrent workers (default 2)
    --dry-run        Show what would be added
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Set
from urllib.parse import urljoin, urlparse

import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import coverage


LOGGER = logging.getLogger("akira.discovery.municipal")

WIKIPEDIA_API = "https://es.wikipedia.org/w/api.php"

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-AR,es;q=0.9",
}

# Words that suggest a link is a media outlet
MEDIA_HINTS = [
    "radio", "fm", "am", "emisora", "cadena",
    "diario", "periodico", "el diario", "el periodico",
    "noticias", "news", "noticiero", "prensa",
    "tv", "canal", "television",
    "informador", "medio", "el tiempo", "la voz",
    "el tribuno", "el popular", "la mañana", "el sur",
]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Discover local media via municipal government sites"
    )
    p.add_argument("--db", default=coverage.DEFAULT_DB)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--min-pop", type=int, default=4000)
    p.add_argument("--max-pop", type=int, default=0)
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


def http_get(url: str, timeout: float = 10.0) -> Optional[bytes]:
    req = urllib.request.Request(url, headers=DEFAULT_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        LOGGER.debug("http_get %s err=%s", url, e)
        return None


def get_wikipedia_municipal(town: str) -> Optional[str]:
    """Get the MUNICIPAL .gob.ar link from a pueblo's Wikipedia article.

    Skips provincial-level sites (resultados.*, elecciones.*,
    www.*.gob.ar/...) in favor of the actual municipal site
    www.<town>.gob.ar.
    """
    url = (f"{WIKIPEDIA_API}?action=query&prop=extlinks&titles={urllib.parse.quote(town)}"
           f"&format=json&ellimit=50")
    body = http_get(url, timeout=8.0)
    if not body:
        return None
    try:
        d = json.loads(body)
    except json.JSONDecodeError:
        return None
    pages = d.get("query", {}).get("pages", {})
    # Collect all .gob.ar links, then pick the most municipal-looking one
    all_gobar = []
    for pid, page in pages.items():
        if pid == "-1" or not page:
            continue
        for link in page.get("extlinks", []):
            href = link.get("*", "")
            if ".gob.ar" not in href:
                continue
            all_gobar.append(href)
    if not all_gobar:
        return None
    # Score each: prefer shorter hostname with the town's name
    # The town name might be in the subdomain (e.g., quitilipi.gob.ar
    # or www.quitilipi.gob.ar)
    town_norm = re.sub(r"[^a-z]", "", town.lower())
    def score(url: str) -> int:
        host = urlparse(url).netloc.lower().replace("www.", "")
        # Strongly prefer hosts that contain the town name
        if town_norm and town_norm in re.sub(r"[^a-z]", "", host):
            return 100
        # Avoid provincial results / election sites
        if any(s in host for s in ("resultados", "elecciones", "eleccion",
                                     "transito", "transparencia", "salud",
                                     "educacion", "turismo", "cultura",
                                     "estadisticas", "estadistica")):
            return -100
        # Prefer shorter (municipal sites are shorter)
        return -len(host)
    return max(all_gobar, key=score)


def get_wikipedia_article_text(town: str) -> str:
    """Get the full Wikipedia article text to scan for media mentions."""
    url = (f"{WIKIPEDIA_API}?action=query&prop=extracts&exintro=0&explaintext=1"
           f"&titles={urllib.parse.quote(town)}&format=json")
    body = http_get(url, timeout=8.0)
    if not body:
        return ""
    try:
        d = json.loads(body)
    except json.JSONDecodeError:
        return ""
    pages = d.get("query", {}).get("pages", {})
    for pid, page in pages.items():
        if pid == "-1" or not page:
            continue
        return page.get("extract", "")
    return ""


def extract_media_links_from_html(html: str, base_url: str) -> Set[str]:
    """Extract media-domain URLs from a municipal page HTML."""
    found: Set[str] = set()
    # Find all href targets
    href_pattern = re.compile(
        r'href=["\'](https?://[^"\']+|/[^"\']+|\.\./[^"\']+)["\']',
        re.IGNORECASE,
    )
    for m in href_pattern.finditer(html):
        href = m.group(1)
        # Resolve relative URLs
        full_url = urljoin(base_url, href)
        netloc = urlparse(full_url).netloc.lower()
        netloc = re.sub(r"^www\.", "", netloc)
        if not netloc:
            continue
        # Check if netloc contains a media hint
        if any(hint in netloc for hint in MEDIA_HINTS):
            found.add(netloc)
        # Also check URL path
        path = urlparse(full_url).path.lower()
        if any(hint in path for hint in MEDIA_HINTS):
            found.add(netloc)
    return found


def extract_media_domains_from_text(text: str) -> Set[str]:
    """Find media URLs mentioned in plain text (e.g., 'radiofmquilmes.com.ar')."""
    found: Set[str] = set()
    # Match .com.ar / .ar domains in the text
    for m in re.finditer(
        r'\b([a-z0-9-]+\.(?:com\.ar|ar))\b',
        text.lower(),
    ):
        domain = m.group(1)
        if any(hint in domain for hint in MEDIA_HINTS):
            found.add(domain)
    return found


def discover_for_town(
    conn: sqlite3.Connection,
    town: str,
    province: str,
    codgl: str,
    known_domains: Set[str],
) -> int:
    """Run all discovery for one pueblo. Returns count of new media added."""
    inserted = 0
    found_domains: Set[str] = set()

    # 1. Wikipedia article: extract .gob.ar + scan text for media URLs
    wiki_text = get_wikipedia_article_text(town)
    if wiki_text:
        # Media domains mentioned in the article text
        found_domains |= extract_media_domains_from_text(wiki_text)
    # .gob.ar link for the municipal site
    municipal_url = get_wikipedia_municipal(town)

    # 2. Scrape the municipal site for media links
    if municipal_url:
        # Try the homepage first
        body = http_get(municipal_url, timeout=5.0)
        if body:
            try:
                html = body.decode("utf-8", errors="ignore")
            except Exception:
                html = ""
            found_domains |= extract_media_links_from_html(html, municipal_url)

    # 3. Filter out known domains and add new ones
    new_domains = found_domains - known_domains
    for domain in new_domains:
        # Skip non-Argentine or aggregator domains
        if not any(domain.endswith(tld) for tld in (".ar", ".com.ar", ".gov.ar")):
            continue
        # Skip national aggregators (already in coverage.NATIONAL_AGGREGATORS)
        from scripts.media.discover_via_gnews import NATIONAL_AGGREGATORS
        if any(domain == agg or domain.endswith("." + agg)
               for agg in NATIONAL_AGGREGATORS):
            continue
        # Build a candidate website
        website = f"https://{domain}"
        # Try to infer type from domain
        mtype = "web"
        for kw in ("radio", "fm", "am", "emisora"):
            if kw in domain:
                mtype = "radio"
                break
        for kw in ("diario", "periodico", "noticias", "el", "la"):
            if kw in domain:
                mtype = "diario"
                break

        try:
            ok = coverage.import_radio(
                conn,
                name=domain,
                type=mtype,
                city=town,
                province=province,
                codgl=codgl,
                website=website,
                stream_url=None,
                tags="discovered-via-municipal",
                source="municipal-site",
            )
            if ok:
                inserted += 1
                known_domains.add(domain)
        except Exception as e:
            LOGGER.debug("insert %s: %s", domain, e)

    if inserted > 0:
        LOGGER.info("  [%s] +%d new media (gob.ar=%s)",
                    town, inserted, municipal_url or "none")
    return inserted


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    conn = coverage.get_connection(args.db)

    # Get uncovered pueblos
    sql = """
        SELECT t.name, t.province, t.codgl, t.population
        FROM argentine_towns t
        LEFT JOIN argentine_media m ON t.codgl = m.codgl
        WHERE m.id IS NULL
          AND t.population >= ?
          {max_pop_clause}
          AND t.province IS NOT NULL
        ORDER BY t.population DESC
    """
    max_pop_clause = ""
    if args.max_pop > 0:
        max_pop_clause = f"AND t.population <= {args.max_pop}"
    sql = sql.format(max_pop_clause=max_pop_clause)

    pending = conn.execute(sql, (args.min_pop,)).fetchall()
    if args.limit > 0:
        pending = pending[: args.limit]
    print(f"Discovering via municipal sites for {len(pending)} pueblos "
          f"(>={args.min_pop} hab)...")

    # Build known-domain set for dedup
    known_domains: Set[str] = set()
    for r in conn.execute(
        "SELECT website FROM argentine_media WHERE website IS NOT NULL"
    ).fetchall():
        if r[0]:
            netloc = urlparse(r[0]).netloc.lower()
            netloc = re.sub(r"^www\.", "", netloc)
            if netloc:
                known_domains.add(netloc)
    LOGGER.info("Already known domains: %d", len(known_domains))

    total_inserted = 0
    pueblos_with_match = 0
    done = 0
    t0 = time.monotonic()

    def process(town, province, codgl, pop):
        # Each thread gets its own connection (SQLite3 is thread-local)
        thread_conn = coverage.get_connection(args.db)
        try:
            return discover_for_town(
                thread_conn, town, province, codgl, known_domains
            )
        finally:
            thread_conn.close()

    if args.workers == 1:
        for town, province, codgl, pop in pending:
            try:
                n = process(town, province, codgl, pop)
            except Exception as e:
                LOGGER.warning("town=%s err=%s", town, e)
                n = 0
            done += 1
            total_inserted += n
            if n > 0:
                pueblos_with_match += 1
            if done % 10 == 0:
                conn.commit()
            if done % 25 == 0 or done == len(pending):
                elapsed = time.monotonic() - t0
                rate = done / elapsed if elapsed > 0 else 0
                eta = (len(pending) - done) / rate if rate > 0 else 0
                print(f"  [{done}/{len(pending)}] inserted={total_inserted} "
                      f"pueblos_with_match={pueblos_with_match} "
                      f"rate {rate:.1f}/s ETA {eta/60:.0f}min")
    else:
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            futures = {
                ex.submit(process, town, province, codgl, pop): (town, codgl)
                for town, province, codgl, pop in pending
            }
            for fut in as_completed(futures):
                town, _ = futures[fut]
                try:
                    n = fut.result()
                except Exception as e:
                    LOGGER.warning("town=%s err=%s", town, e)
                    n = 0
                done += 1
                total_inserted += n
                if n > 0:
                    pueblos_with_match += 1
                if done % 10 == 0:
                    conn.commit()
                if done % 25 == 0 or done == len(pending):
                    elapsed = time.monotonic() - t0
                    rate = done / elapsed if elapsed > 0 else 0
                    eta = (len(pending) - done) / rate if rate > 0 else 0
                    print(f"  [{done}/{len(pending)}] inserted={total_inserted} "
                          f"pueblos_with_match={pueblos_with_match} "
                          f"rate {rate:.1f}/s ETA {eta/60:.0f}min")

    conn.commit()
    elapsed = time.monotonic() - t0
    print(f"\nDone: {total_inserted} new media in {pueblos_with_match} pueblos "
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
