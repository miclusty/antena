#!/usr/bin/env python3
"""
Second-pass GNews discovery for pueblos still uncovered.

First pass (discover_via_gnews.py) found 67.7% of pueblos. The
remaining ~275 are smaller towns where the broad queries
"{town} {province}", "diario {town}", "radio {town}" returned
nothing.

This second pass tries more specific queries:
  - "noticias {town}" — generic local news
  - "fm {town}" — radio FM only
  - "am {town}" — AM radio
  - "fm am {town}" — combined
  - "medio {town}" — local media
  - "periodico {town}" — newspaper

Queries are run in parallel (ThreadPoolExecutor) for ~5x speedup
over the first pass. No rate limiting observed at delay=0.

CLI: same as discover_via_gnews.py
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
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Optional, Set

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Reuse helpers from the first-pass script
from scripts.media.discover_via_gnews import (  # noqa: E402
    NATIONAL_AGGREGATORS,
    AR_TLDS,
    DEFAULT_HEADERS,
    fetch_gnews,
    infer_type,
)
from core import coverage


LOGGER = logging.getLogger("akira.discovery.gnews2")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Second-pass GNews discovery for uncovered pueblos"
    )
    p.add_argument("--db", default=coverage.DEFAULT_DB)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--min-pop", type=int, default=4000)
    p.add_argument("--max-pop", type=int, default=0,
                    help="Process pueblos with pop <= this (skip big cities)")
    p.add_argument("--delay", type=float, default=1.5)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    conn = coverage.get_connection(args.db)

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
    print(f"Second-pass for {len(pending)} pueblos "
          f"({args.min_pop}+{'-' + str(args.max_pop) if args.max_pop else ''} hab)...")

    # Build the known-domain lookup
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

    # More specific queries
    inserted = 0
    pueblos_with_match = 0
    done = 0
    t0 = time.monotonic()

    # Process pueblos in parallel batches. The bottleneck was
    # 5 sequential network queries per pueblo (~30s per pueblo).
    # With 3-5 parallel workers, throughput goes 3-5x.
    POOL_SIZE = 4

    def process_one(town: str, province: str, codgl: str, pop: int) -> int:
        queries = [
            f"noticias {town} {province}",
            f"fm {town} {province}",
            f"am {town} {province}",
            f"periodico {town}",
            f"medio {town} {province}",
        ]
        domain_to_info: Dict[str, Dict] = {}
        # Run queries in parallel within a single pueblo
        with ThreadPoolExecutor(max_workers=len(queries)) as ex:
            futures = {ex.submit(fetch_gnews, q): q for q in queries}
            for fut in as_completed(futures):
                try:
                    results = fut.result()
                except Exception:
                    continue
                for r in results:
                    if r["domain"] in domain_to_info:
                        continue
                    if r["domain"] in known_domains:
                        continue
                    domain_to_info[r["domain"]] = r

        if not domain_to_info:
            return 0

        LOGGER.info("  [%s] found %d new domains", town, len(domain_to_info))
        local_inserted = 0
        for domain, info in domain_to_info.items():
            mtype = infer_type(domain, info.get("sample_title", ""))
            try:
                ok = coverage.import_radio(
                    conn,
                    name=domain,
                    type=mtype,
                    city=town,
                    province=province,
                    codgl=codgl,
                    website=info["url"],
                    stream_url=None,
                    tags=f"discovered-via-gnews2",
                    source="google-news-rss2",
                )
                if ok:
                    local_inserted += 1
                    known_domains.add(domain)
            except Exception as e:
                LOGGER.debug("insert failed: %s", e)
        return local_inserted

    with ThreadPoolExecutor(max_workers=POOL_SIZE) as ex:
        futures = {
            ex.submit(process_one, town, province, codgl, pop): (town, codgl)
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
            inserted += n
            if n > 0:
                pueblos_with_match += 1
            if done % 10 == 0:
                conn.commit()  # batched commit
            if done % 25 == 0 or done == len(pending):
                elapsed = time.monotonic() - t0
                rate = done / elapsed if elapsed > 0 else 0
                eta = (len(pending) - done) / rate if rate > 0 else 0
                print(f"  [{done}/{len(pending)}] inserted={inserted} "
                      f"pueblos_with_match={pueblos_with_match} "
                      f"rate {rate:.1f}/s ETA {eta/60:.0f}min")

    conn.commit()

    elapsed = time.monotonic() - t0
    print(f"\nDone: {inserted} new media in {pueblos_with_match} pueblos "
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
