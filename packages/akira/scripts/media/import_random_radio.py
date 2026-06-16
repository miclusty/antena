#!/usr/bin/env python3
"""
Import Argentine radio stations from random-radio's SQLite.

random-radio at ~/proyectos/random-radio has 818 Argentine radio
stations collected from Radio Garden's public API. This script:

  1. Opens random-radio's skill_radio.db
  2. For each Argentine station, normalizes the city and matches
     against argentine_towns (with alias resolution for Gran
     Mendoza, Gran Rosario, Gran Córdoba, etc)
  3. Inserts into argentine_media with type='radio', source='random-radio'

Re-runnable. Uses INSERT OR IGNORE on UNIQUE(name,city,type) so
duplicates are silently skipped. Coverage stats are printed at
the end.

CLI:
    --db PATH     AKIRA sqlite path (default from env)
    --rr-db PATH  random-radio sqlite path
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import coverage


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Import AR radios from random-radio into AKIRA"
    )
    p.add_argument(
        "--db", default=coverage.DEFAULT_DB,
        help="AKIRA sqlite database path",
    )
    p.add_argument(
        "--rr-db",
        default="/Users/omatic/proyectos/random-radio/crawler/data/skill_radio.db",
        help="random-radio sqlite database path",
    )
    p.add_argument(
        "--reset", action="store_true",
        help="Drop existing random-radio imports before re-importing",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()

    if not os.path.exists(args.rr_db):
        print(f"ERROR: random-radio db not found at {args.rr_db}")
        return 1
    if not os.path.exists(args.db):
        print(f"ERROR: AKIRA db not found at {args.db}")
        return 1

    conn = coverage.get_connection(args.db)
    rr = sqlite3.connect(args.rr_db)

    if args.reset:
        deleted = conn.execute(
            "DELETE FROM argentine_media WHERE source = 'random-radio'"
        ).rowcount
        print(f"Reset: deleted {deleted} existing random-radio imports")
        conn.commit()

    towns = coverage.load_towns(conn)
    print(f"Loaded {len(towns)} towns from AKIRA db")

    ar_radios = rr.execute("""
        SELECT name, city, website, tags, stream_url
        FROM stations
        WHERE country = 'Argentina'
          AND city IS NOT NULL AND city != ''
    """).fetchall()
    print(f"random-radio: {len(ar_radios)} Argentine stations with city")

    imported = 0
    duplicates = 0
    unmatched_saved = 0
    unmatched: dict[str, int] = {}

    t0 = time.monotonic()
    for name, city, website, tags, stream_url in ar_radios:
        ncity = coverage.normalize(city)

        # Direct match
        if ncity in towns:
            t = towns[ncity]
            inserted = coverage.import_radio(
                conn,
                name=name,
                type="radio",
                city=city,
                province=t[1],
                codgl=t[2],
                website=website,
                stream_url=stream_url,
                tags=tags,
                source="random-radio",
            )
            if inserted:
                imported += 1
            else:
                duplicates += 1
            continue

        # Reverse alias: smaller → bigger agglomerate
        matched_codgl = None
        matched_prov = None
        for big, smalls in coverage.CITY_ALIASES.items():
            if coverage.normalize(big) in towns and ncity in (
                coverage.normalize(s) for s in smalls
            ):
                big_t = towns[coverage.normalize(big)]
                matched_codgl = big_t[2]
                matched_prov = big_t[1]
                break

        if matched_codgl:
            inserted = coverage.import_radio(
                conn,
                name=name,
                type="radio",
                city=city,
                province=matched_prov,
                codgl=matched_codgl,
                website=website,
                stream_url=stream_url,
                tags=tags,
                source="random-radio",
            )
            if inserted:
                imported += 1
            else:
                duplicates += 1
            continue

        # No pueblo match. Save as national with codgl=NULL so
        # the data isn't lost — these are typically radios that
        # list their city as "Buenos Aires" (which is a province,
        # not a pueblo) or stations in towns Radio Garden groups
        # under a different cabecera. Future: we can attach them
        # to specific CABA comunas or provincial cabeceras.
        inserted = coverage.import_radio(
            conn,
            name=name,
            type="radio",
            city=city,
            province=None,  # no province match either
            codgl=None,
            website=website,
            stream_url=stream_url,
            tags=tags,
            source="random-radio",
        )
        if inserted:
            unmatched_saved += 1
        else:
            duplicates += 1
        unmatched[city] = unmatched.get(city, 0) + 1

    conn.commit()
    elapsed = time.monotonic() - t0

    print(f"\nImported (matched): {imported} (duplicates skipped: {duplicates})")
    print(f"Imported (unmatched, codgl=NULL): {unmatched_saved}")
    print(f"Unmatched cities: {len(unmatched)} ({sum(unmatched.values())} stations)")
    print(f"Elapsed: {elapsed:.1f}s")

    if unmatched:
        print("\nTop unmatched cities (need alias):")
        for c, n in sorted(unmatched.items(), key=lambda x: -x[1])[:15]:
            print(f"  {c}: {n}")

    print()
    s = coverage.stats(conn)
    print(f"Coverage: {s['covered_towns']}/{s['total_towns']} pueblos "
          f"({s['coverage_pct']}%)")
    print(f"Total media: {sum(s['by_type'].values())}")
    print(f"By type: {s['by_type']}")

    rr.close()
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
