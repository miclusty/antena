#!/usr/bin/env python3
"""Import all radio stations from random-radio's SQLite into AKIRA.

random-radio at ~/proyectos/random-radio has 25,182 radio stations
across 216 countries collected from Radio Garden's public API. This
script pulls them all (not just AR), normalizes cities for AR rows
against argentine_towns, and inserts into AKIRA's `media` table.

CLI:
    --db PATH         AKIRA sqlite path (default from env)
    --rr-db PATH      random-radio sqlite path
    --reset           Drop existing random-radio* rows before re-importing
    --dry-run         Parse + count without writing to AKIRA DB
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import coverage


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Import radios from random-radio (all countries) into AKIRA"
    )
    p.add_argument("--db", default=coverage.DEFAULT_DB, help="AKIRA sqlite path")
    p.add_argument(
        "--rr-db",
        default="/Users/omatic/proyectos/random-radio/crawler/data/skill_radio.db",
        help="random-radio sqlite path",
    )
    p.add_argument(
        "--reset", action="store_true",
        help="Drop existing random-radio* rows before re-importing",
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="Parse and count without writing to AKIRA DB",
    )
    return p.parse_args(argv)


def main(args_override: list[str] | None = None) -> int:
    args = parse_args(args_override)

    if not os.path.exists(args.rr_db):
        print(f"ERROR: random-radio db not found at {args.rr_db}")
        return 1
    if not args.dry_run and not os.path.exists(args.db):
        print(f"ERROR: AKIRA db not found at {args.db}")
        return 1

    conn = coverage.get_connection(args.db) if not args.dry_run else None
    rr = sqlite3.connect(args.rr_db)

    if args.reset and not args.dry_run:
        deleted = conn.execute(
            "DELETE FROM media WHERE source IN ('random-radio', 'random-radio-global')"
        ).rowcount
        print(f"Reset: deleted {deleted} existing random-radio* rows")
        conn.commit()

    towns = coverage.load_towns(conn) if not args.dry_run else {}

    rows = rr.execute("""
        SELECT name, city, country, country_code, website, stream_url,
               tags, language, bitrate, codec
        FROM stations
        WHERE stream_url IS NOT NULL AND stream_url != ''
    """).fetchall()
    print(f"random-radio: {len(rows)} stations with stream_url")

    if args.dry_run:
        country_counts: dict[str, int] = {}
        for _name, _city, country, *_rest in rows:
            country_counts[country or "Unknown"] = country_counts.get(country or "Unknown", 0) + 1
        print(f"\nBy country (top 15):")
        for c, n in sorted(country_counts.items(), key=lambda x: -x[1])[:15]:
            print(f"  {c}: {n}")
        rr.close()
        return 0

    imported_matched = 0
    imported_unmatched_ar = 0
    imported_non_ar = 0
    duplicates = 0
    t0 = time.monotonic()

    BATCH = 500
    batch: list[tuple] = []

    for name, city, country, country_code, website, stream_url, tags, language, bitrate, codec in rows:
        country = country or "Unknown"
        is_argentine = country == "Argentina"

        province: str | None = None
        codgl: str | None = None
        matched = False

        if is_argentine and city:
            ncity = coverage.normalize(city)
            if ncity in towns:
                t = towns[ncity]
                province, codgl = t[1], t[2]
                matched = True
            else:
                for big, smalls in coverage.CITY_ALIASES.items():
                    if coverage.normalize(big) in towns and ncity in (
                        coverage.normalize(s) for s in smalls
                    ):
                        big_t = towns[coverage.normalize(big)]
                        province, codgl = big_t[1], big_t[2]
                        matched = True
                        break

        source = "random-radio" if is_argentine else "random-radio-global"

        iso_country = country_code or country

        batch.append((
            name, city or "", province, codgl,
            website, stream_url, tags, source,
            iso_country, country_code, language, bitrate, codec,
        ))

        if len(batch) >= BATCH:
            inserted = _flush_batch(conn, batch)
            imported_matched += inserted["matched"]
            imported_unmatched_ar += inserted["unmatched_ar"]
            imported_non_ar += inserted["non_ar"]
            duplicates += inserted["duplicates"]
            batch.clear()

    if batch:
        inserted = _flush_batch(conn, batch)
        imported_matched += inserted["matched"]
        imported_unmatched_ar += inserted["unmatched_ar"]
        imported_non_ar += inserted["non_ar"]
        duplicates += inserted["duplicates"]

    conn.commit()
    elapsed = time.monotonic() - t0

    print(f"\nImported (AR matched): {imported_matched}")
    print(f"Imported (AR unmatched, codgl=NULL): {imported_unmatched_ar}")
    print(f"Imported (non-AR): {imported_non_ar}")
    print(f"Duplicates skipped: {duplicates}")
    print(f"Elapsed: {elapsed:.1f}s")

    print()
    try:
        s = coverage.stats(conn)
        print(f"Coverage: {s['covered_towns']}/{s['total_towns']} pueblos ({s['coverage_pct']}%)")
        print(f"Total media: {sum(s['by_type'].values())}")
    except sqlite3.OperationalError as e:
        print(f"Coverage stats skipped: {e}")

    country_counts = conn.execute("""
        SELECT country, COUNT(*) FROM media
        WHERE type = 'radio' AND country IS NOT NULL
        GROUP BY country ORDER BY COUNT(*) DESC LIMIT 10
    """).fetchall()
    print(f"\nTop countries:")
    for c, n in country_counts:
        print(f"  {c}: {n}")

    conn.close()
    rr.close()
    return 0


def _flush_batch(conn: sqlite3.Connection, batch: list[tuple]) -> dict:
    """Insert a batch, returning counts by category."""
    matched = 0
    unmatched_ar = 0
    non_ar = 0
    duplicates = 0
    for row in batch:
        (name, city, province, codgl, website, stream_url, tags, source,
         country, country_code, language, bitrate, codec) = row
        try:
            cur = conn.execute(
                """
                INSERT OR IGNORE INTO media (
                    name, type, city, province, codgl,
                    website, stream_url, tags, source,
                    country, country_code, language, bitrate, codec
                ) VALUES (?, 'radio', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (name, city, province, codgl, website, stream_url, tags,
                 source, country, country_code, language, bitrate, codec),
            )
            if cur.rowcount == 1:
                if country == "Argentina":
                    if codgl:
                        matched += 1
                    else:
                        unmatched_ar += 1
                else:
                    non_ar += 1
            else:
                duplicates += 1
        except sqlite3.IntegrityError:
            duplicates += 1
    return {"matched": matched, "unmatched_ar": unmatched_ar,
            "non_ar": non_ar, "duplicates": duplicates}


if __name__ == "__main__":
    sys.exit(main())
