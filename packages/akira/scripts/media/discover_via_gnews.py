#!/usr/bin/env python3
"""
Discover local media via Google News RSS for each uncovered pueblo.

For each pueblo in argentine_towns that has NO media in
argentine_media, query Google News RSS with:
  1. "{town} {province}" — the broadest, catches any news mention
  2. "diario {town}" — newspaper-specific
  3. "radio {town}" — radio-specific

For each unique source domain in the results, add it to
argentine_media. The domain is what matters — Google News
returns the publisher's URL in <source url="..."> for every
item, so we deduplicate by domain.

Why Google News (not direct Google search):
  - Has a public RSS endpoint, no API key, no JS required
  - Aggregates ~100+ local sources per query
  - Already filtered to news (vs random web pages)
  - Supports geolocation via the gl=AR parameter
  - The "CBMi..." article URLs are not useful but the
    <source url="..."> in each item IS the publisher domain
  - Result limit is ~100 items per query, so we use 2-3
    queries per pueblo to maximize recall

CLI:
    --db PATH       AKIRA sqlite
    --limit N       Process at most N pueblos (0 = all)
    --min-pop N     Only pueblos with population >= N
    --delay SEC     Sleep between queries (default 1.0)
    --dry-run       Show what would be added, don't write
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
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from typing import Dict, List, Optional, Set, Tuple
from xml.etree import ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import coverage


LOGGER = logging.getLogger("akira.discovery.gnews")

GOOGLE_NEWS_RSS = (
    "https://news.google.com/rss/search?q={query}&hl=es-419&gl=AR&ceid=AR:es-419"
)

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/rss+xml, text/xml, */*",
}

# Some domains are national/aggregators and don't represent
# local coverage. We skip them so we only keep genuinely local
# sources per pueblo.
NATIONAL_AGGREGATORS = {
    # International platforms
    "com.google", "google.com", "youtube.com", "facebook.com",
    "twitter.com", "x.com", "instagram.com", "tiktok.com",
    "linkedin.com", "reddit.com", "medium.com", "substack.com",
    "washingtonpost.com", "nytimes.com", "theguardian.com",
    "bbc.com", "bbc.co.uk", "cnn.com", "cnn.es",
    # Top Argentine national news (we already have these in
    # `sources` table; no value in adding again)
    "infobae.com", "lanacion.com.ar", "clarin.com", "perfil.com",
    "pagina12.com.ar", "ambito.com", "cronista.com",
    "ole.com.ar", "tn.com.ar", "c5n.com", "cadenabauer.com",
    "radiomitre.cienradios.com", "cadenadeayer.com",
    "la100.cienradios.com", "eldestapeweb.com", "eldestape.com",
    "filonews.com", "futurock.com", "futurockfm.com",
    "ciudadanodiario.com.ar", "lavoz.com.ar", "losandes.com.ar",
    "mdzol.com", "lagaceta.com.ar", "eldiariodejujuy.com",
    "rionegro.com.ar", "lavozdetandil.com", "lavozdeparana.com.ar",
    "eldiariomza.com", "elciudadanoweb.com", "diariouno.com.ar",
    "losandes.com.ar", "elsol.com.ar", "eltribuno.com",
    "elindependiente.com.ar", "edicionrural.com", "ruralnet.com.ar",
    "bcr.com.ar", "baenegocios.com", "minutouno.com",
    "diariopopular.com.ar", "urgente24.com", "realpolitik.com.ar",
    "cadena3.com", "radionacional.com.ar", "nacional823.com.ar",
    "lasextaseccion.com.ar", "laventanaverdedigital.com.ar",
    "filonews.com", "lacapital.com.ar", "elciudadano.com.ar",
    # Wire services
    "telam.com.ar", "tlam.com.ar",  # Télam
    "reuters.com", "ap.org", "apnews.com", "efe.com", "afp.com",
    # Social/syndication
    "rss.com", "feedburner.com", "feedproxy.google.com",
}

# Top-level domains we accept. Argentina uses .ar, .com.ar,
# .gov.ar, .edu.ar, and a few niche ones. Foreign domains
# (Spain .es, Italy .it, Chile .cl, etc.) get noise like
# diariodemallorca.es when searching for a pueblo with the
# same name. We want truly Argentine sources.
AR_TLDS = (".ar", ".com.ar", ".gov.ar", ".edu.ar", ".int.ar")

# Domain → inferred type. Most small-town sites are either
# digital-first diarios (portal) or local radio stations. We
# default to 'web' and let downstream scripts refine.
DOMAIN_TYPE_HINTS = {
    "radio": ["fm", "radio", "cadena", "emisora", "am"],
    "diario": ["diario", "eldiario", "eltiempo", "elcomercial",
                "lanueva", "elche", "elortiba", "elargentino",
                "nueva", "tribuna", "opinion", "lacuarta",
                "tiempo", "sur", "noticias"],
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Discover local media via Google News RSS"
    )
    p.add_argument("--db", default=coverage.DEFAULT_DB)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--min-pop", type=int, default=4000)
    p.add_argument("--delay", type=float, default=1.0)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


def http_get(url: str, timeout: float = 15.0) -> Optional[bytes]:
    req = urllib.request.Request(url, headers=DEFAULT_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            return resp.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        LOGGER.debug("http_get %s err=%s", url, e)
        return None


def fetch_gnews(query: str) -> List[Dict]:
    """Fetch Google News RSS for query, return list of {source, url} dicts.

    Each <item> in the RSS has a <source url="..."> element that
    is the publisher's domain. The <link> element points to
    Google's URL-shortened article (CBMi...), which we ignore.
    We dedupe by source domain so the same media isn't added twice
    for a single pueblo.
    """
    url = GOOGLE_NEWS_RSS.format(query=urllib.parse.quote(query))
    body = http_get(url)
    if not body:
        return []
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        LOGGER.debug("parse error for %s: %s", query, e)
        return []
    items = []
    seen_domains: Set[str] = set()
    for item in root.iter("item"):
        # The <source> child has the publisher url
        source_elem = item.find("source")
        source_url = source_elem.get("url") if source_elem is not None else None
        if not source_url:
            continue
        # Normalize: strip www, lowercase
        netloc = urllib.parse.urlparse(source_url).netloc.lower()
        netloc = re.sub(r"^www\.", "", netloc)
        if not netloc or netloc in seen_domains:
            continue
        # Skip national aggregators
        if any(netloc == agg or netloc.endswith("." + agg)
               for agg in NATIONAL_AGGREGATORS):
            continue
        # Skip Google's own redirect URLs
        if "news.google" in netloc:
            continue
        # Strict: only Argentine TLDs. This eliminates 90% of
        # the noise (diariodemallorca.es, etc.) which Google
        # returns because pueblo names exist in other countries
        # (Pergamino is in Spain, Moreno is in Spain, etc.)
        if not any(netloc.endswith(tld) for tld in AR_TLDS):
            continue
        seen_domains.add(netloc)
        title_elem = item.find("title")
        title = title_elem.text if title_elem is not None else ""
        items.append({
            "domain": netloc,
            "url": source_url,
            "sample_title": title,
        })
    return items


def infer_type(domain: str, sample_title: str) -> str:
    """Guess media type from domain and a sample article title."""
    d = domain.lower()
    t = sample_title.lower()
    for type_, keywords in DOMAIN_TYPE_HINTS.items():
        for kw in keywords:
            if kw in d or kw in t:
                return type_
    return "web"


def fetch_website_for_domain(domain: str) -> Optional[str]:
    """Try to find a public website for this domain. For
    www.example.com.ar we can guess the root. We just return
    the domain itself with https:// — we'll discover RSS via
    a follow-up script."""
    return f"https://{domain}"


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
          AND t.province IS NOT NULL
        ORDER BY t.population DESC
    """
    pending = conn.execute(sql, (args.min_pop,)).fetchall()
    if args.limit > 0:
        pending = pending[: args.limit]
    print(f"Discovering media for {len(pending)} pueblos (>= {args.min_pop} hab)...")

    # Build the known-domain lookup so we don't re-insert
    known_domains: Set[str] = set()
    for r in conn.execute(
        "SELECT website FROM argentine_media WHERE website IS NOT NULL"
    ).fetchall():
        if r[0]:
            netloc = urllib.parse.urlparse(r[0]).netloc.lower()
            netloc = re.sub(r"^www\.", "", netloc)
            if netloc:
                known_domains.add(netloc)

    LOGGER.info("Already known domains: %d", len(known_domains))

    inserted = 0
    skipped_dup = 0
    pueblos_with_match = 0
    done = 0
    t0 = time.monotonic()

    for town, province, codgl, pop in pending:
        # Build queries
        queries = [
            f"{town} {province}",
            f"diario {town}",
            f"radio {town}",
        ]
        domain_to_info: Dict[str, Dict] = {}
        for q in queries:
            if args.delay > 0:
                time.sleep(args.delay)
            results = fetch_gnews(q)
            for r in results:
                if r["domain"] in domain_to_info:
                    continue
                if r["domain"] in known_domains:
                    skipped_dup += 1
                    continue
                domain_to_info[r["domain"]] = r

        if domain_to_info:
            pueblos_with_match += 1
            LOGGER.info("  [%s] found %d new domains: %s",
                        town, len(domain_to_info),
                        ", ".join(sorted(domain_to_info.keys())[:5]))

            if not args.dry_run:
                for domain, info in domain_to_info.items():
                    website = info["url"]
                    mtype = infer_type(domain, info.get("sample_title", ""))
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
                            tags=f"discovered-via-gnews",
                            source="google-news-rss",
                        )
                        if ok:
                            inserted += 1
                            known_domains.add(domain)
                        else:
                            skipped_dup += 1
                    except Exception as e:
                        LOGGER.debug("insert failed: %s", e)
                conn.commit()

        done += 1
        if done % 25 == 0 or done == len(pending):
            elapsed = time.monotonic() - t0
            rate = done / elapsed if elapsed > 0 else 0
            eta = (len(pending) - done) / rate if rate > 0 else 0
            print(f"  [{done}/{len(pending)}] inserted={inserted} "
                  f"pueblos_with_match={pueblos_with_match} "
                  f"rate {rate:.1f}/s ETA {eta/60:.0f}min")

    elapsed = time.monotonic() - t0
    print(f"\nDone: {inserted} new media in {pueblos_with_match} pueblos "
          f"({done} searched) in {elapsed/60:.1f}min")
    if not args.dry_run:
        s = coverage.stats(conn)
        print(f"Total coverage: {s['covered_towns']}/{s['total_towns']} "
              f"({s['coverage_pct']}%)")
        print(f"Total media: {sum(s['by_type'].values())}")
        print(f"By source: {s['by_source']}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
