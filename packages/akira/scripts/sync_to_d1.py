#!/usr/bin/env python3
"""
Sync script: AKIRA local SQLite → Cloudflare D1 local (Miniflare SQLite).

Reads from packages/akira/data/akira.db, writes to the D1 sqlite file that
Miniflare uses for local dev (packages/api/.wrangler/state/v3/d1/.../*.sqlite).

Tables synced: categories, locations, sources, news_cards, master_articles.

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/sync_to_d1.py [--limit N] [--reset]

Flags:
    --limit N   Sync only the N most recent news_cards (default: 5000)
    --reset     Wipe D1 tables first (default: append/update, leave extras)
    --dry-run   Print what would be inserted, don't touch D1
"""

import argparse
import os
import sqlite3
import sys
from pathlib import Path
from typing import Iterable

# ── Paths ────────────────────────────────────────────────────────
HERE = Path(__file__).resolve().parent
AKIRA_ROOT = HERE.parent
REPO_ROOT = AKIRA_ROOT.parent.parent
D1_GLOB = list((REPO_ROOT / "packages/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject").glob("*.sqlite"))
D1_PATH = next((p for p in D1_GLOB if p.name != "metadata.sqlite"), D1_GLOB[0] if D1_GLOB else None)

if not D1_PATH or not D1_PATH.exists():
    print(f"ERROR: D1 sqlite not found at {D1_PATH}. Is wrangler dev running?", file=sys.stderr)
    sys.exit(1)

AKIRA_DB = AKIRA_ROOT / "data/akira.db"
if not AKIRA_DB.exists():
    print(f"ERROR: akira.db not found at {AKIRA_DB}", file=sys.stderr)
    sys.exit(1)

# ── Helpers ──────────────────────────────────────────────────────
def chunked(it: Iterable, size: int) -> Iterable[list]:
    buf = []
    for x in it:
        buf.append(x)
        if len(buf) == size:
            yield buf
            buf = []
    if buf:
        yield buf


def reset_d1_tables(cur: sqlite3.Cursor) -> None:
    for t in ["news_cards", "master_articles", "sources", "locations", "categories"]:
        cur.execute(f"DELETE FROM {t}")
        cur.execute(f"DELETE FROM sqlite_sequence WHERE name='{t}'")
    print("[reset] cleared D1: news_cards, master_articles, sources, locations, categories")


def sync_categories(akira: sqlite3.Connection, d1: sqlite3.Connection) -> int:
    rows = akira.execute("SELECT id, slug, name, icon FROM categories").fetchall()
    d1.executemany(
        "INSERT OR REPLACE INTO categories (id, slug, name, icon) VALUES (?, ?, ?, ?)",
        rows,
    )
    return len(rows)


def sync_locations(akira: sqlite3.Connection, d1: sqlite3.Connection) -> int:
    rows = akira.execute(
        "SELECT id, name, province, country, lat, lng, population, type, parent_id FROM locations"
    ).fetchall()
    # Normalize type: AKIRA uses 'ciudad', D1 default is 'city'. Map common variants.
    type_map = {
        "ciudad": "city",
        "provincia": "state",
        "pais": "country",
        "autonomous_city": "city",
    }
    norm = [
        (r[0], r[1], r[2], r[3] or "AR", r[4], r[5], r[6], type_map.get(r[7], r[7] or "city"), r[8])
        for r in rows
    ]
    d1.executemany(
        "INSERT OR REPLACE INTO locations (id, name, province, country, lat, lng, population, type, parent_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        norm,
    )
    return len(norm)


def sync_sources(akira: sqlite3.Connection, d1: sqlite3.Connection) -> int:
    # AKIRA sources columns (verified via PRAGMA): id, name, url, domain,
    # location_id, province, type, rss_url, wp_api_url, sitemap_url,
    # extraction_method, reliability_score, is_active, deactivation_reason,
    # last_fetch, last_success, fetch_count, error_count, news_count,
    # gacetilla_count, avg_bias, created_at, updated_at, last_harvest_at,
    # last_seen_url
    # NOTE: AKIRA does NOT have `country` or `bias_score` columns. We default
    # country to 'AR' and bias_score to 0.0 to match D1 schema.
    rows = akira.execute(
        """SELECT id, name, url, domain, location_id, province, type,
                  rss_url, wp_api_url, sitemap_url, extraction_method,
                  reliability_score, is_active, deactivation_reason,
                  last_fetch, last_success, last_harvest_at, fetch_count,
                  error_count, news_count, gacetilla_count, avg_bias,
                  created_at, updated_at
           FROM sources"""
    ).fetchall()
    norm = [
        (
            r[0], r[1], r[2], r[3],          # id, name, url, domain
            "AR", r[5], r[4], r[6],          # country=AR, province, location_id, type
            r[7], r[8], r[9], r[10],         # rss, wp, sitemap, extraction_method
            r[11], 0.0,                      # reliability_score, bias_score=0
            r[12], r[13],                    # is_active, deactivation_reason
            r[14], r[15], r[16],             # last_fetch, last_success, last_harvest_at
            r[17], r[18], r[19], r[20], r[21],  # counts + avg_bias
            r[22], r[23],                    # created_at, updated_at
        )
        for r in rows
    ]
    d1.executemany(
        """INSERT OR REPLACE INTO sources
           (id, name, url, domain, country, province, location_id, type,
            rss_url, wp_api_url, sitemap_url, extraction_method,
            reliability_score, bias_score, is_active, deactivation_reason,
            last_fetch, last_success, last_harvest_at, fetch_count,
            error_count, news_count, gacetilla_count, avg_bias,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        norm,
    )
    return len(norm)


def sync_news_cards(akira: sqlite3.Connection, d1: sqlite3.Connection, limit: int) -> int:
    # AKIRA news_cards columns (verified via PRAGMA):
    #   id, location_id, title, summary, image_url, bias_score, is_gacetilla,
    #   cluster_id, category, source_ids, published_at, created_at,
    #   quality_score, gacetilla_confidence, neutral_summary, bias_reasoning,
    #   synced, synced_at, sync_error, body
    # D1 news_cards columns (from migrations/0000):
    #   id, location_id, title, summary, body, image_url, source_url,
    #   source_name, source_id, category, bias_score, is_gacetilla,
    #   gacetilla_confidence, sources_count, quality_score, cluster_id,
    #   published_at, created_at
    rows = akira.execute(
        f"""SELECT id, location_id, title, summary, image_url, bias_score,
                   is_gacetilla, cluster_id, category, source_ids,
                   published_at, created_at, quality_score, gacetilla_confidence,
                   body
            FROM news_cards
            ORDER BY created_at DESC
            LIMIT ?""",
        (limit,),
    ).fetchall()
    # Re-order to match D1's expected 18 columns.
    # AKIRA idx → D1 col:
    #   0 id, 1 location_id, 2 title, 3 summary, 14 body, 4 image_url,
    #   12 quality_score, 8 category, 5 bias_score, 6 is_gacetilla,
    #   13 gacetilla_confidence, 7 cluster_id, 10 published_at, 11 created_at
    # (source_url, source_name, source_id, sources_count filled in by
    # resolve_source_meta() below)
    norm = []
    for r in rows:
        norm.append((
            r[0], r[1], r[2], r[3], r[14], r[4],    # id, loc, title, summary, body, image
            None, None, None, r[8],                 # source_url, source_name, source_id, category
            r[5], r[6], r[13], None, r[12],        # bias, is_gacetilla, gacetilla_conf, sources_count, quality
            r[7], r[10], r[11],                    # cluster_id, published_at, created_at
        ))
    d1.executemany(
        """INSERT OR REPLACE INTO news_cards
           (id, location_id, title, summary, body, image_url,
            source_url, source_name, source_id, category,
            bias_score, is_gacetilla, gacetilla_confidence,
            sources_count, quality_score, cluster_id,
            published_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        norm,
    )
    return len(norm)


def sync_master_articles(akira: sqlite3.Connection, d1: sqlite3.Connection) -> int:
    # AKIRA master_articles columns (verified via PRAGMA): id, cluster_id,
    # title, summary, verified_facts, disputed_claims, officialist_perspective,
    # opposition_perspective, neutral_perspective, sources_count, bias_min,
    # bias_max, bias_avg, created_at, updated_at
    # D1 master_articles columns: id, cluster_id, title, summary, body,
    # verified_facts, disputed_claims, officialist_perspective,
    # opposition_perspective, neutral_perspective, sources_count, bias_min,
    # bias_max, bias_avg, created_at
    # (D1 does NOT have `body` nor `updated_at`. We default body to NULL and
    # skip updated_at — D1 will fall back to created_at.)
    rows = akira.execute(
        """SELECT id, cluster_id, title, summary,
                  verified_facts, disputed_claims, officialist_perspective,
                  opposition_perspective, neutral_perspective, sources_count,
                  bias_min, bias_max, bias_avg, created_at
           FROM master_articles"""
    ).fetchall()
    norm = [
        (
            r[0], r[1], r[2], r[3], None,        # id, cluster, title, summary, body=None
            r[4], r[5], r[6], r[7], r[8],        # verified, disputed, officialist, opposition, neutral
            r[9], r[10], r[11], r[12], r[13],   # counts, biases, created_at
        )
        for r in rows
    ]
    d1.executemany(
        """INSERT OR REPLACE INTO master_articles
           (id, cluster_id, title, summary, body, verified_facts,
            disputed_claims, officialist_perspective, opposition_perspective,
            neutral_perspective, sources_count, bias_min, bias_max, bias_avg,
            created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        norm,
    )
    return len(norm)


def resolve_source_meta(akira: sqlite3.Connection, d1: sqlite3.Connection) -> None:
    """
    For each news_card in D1, look up the source metadata from AKIRA via
    source_ids (CSV) → first source. We do this by reading the AKIRA
    source_ids we just synced, joining to AKIRA sources to get the name+url
    AND the source's location_id (which is more specific than the news_card's
    own location_id — news_cards often point to the country while sources
    point to the actual province or city).
    """
    # Pull source_ids from AKIRA and the synced D1 ids
    news_with_sources = akira.execute(
        "SELECT id, source_ids FROM news_cards WHERE source_ids IS NOT NULL"
    ).fetchall()
    sources = {
        row[0]: (row[1], row[2], row[3], row[4])  # name, url, location_id, province
        for row in akira.execute("SELECT id, name, url, location_id, province FROM sources").fetchall()
    }

    updates = []
    loc_updates = []
    for news_id, source_ids_csv in news_with_sources:
        ids = [int(s) for s in source_ids_csv.split(",") if s.strip().isdigit()]
        if not ids:
            continue
        # Use the first source that has a specific location_id (not country=1)
        first_specific = next(
            (sources[i] for i in ids if i in sources and sources[i][2] and sources[i][2] != 1),
            None,
        )
        if not first_specific:
            first_specific = sources.get(ids[0])
        if not first_specific:
            continue
        name, url, src_loc_id, src_province = first_specific
        updates.append((name, url, ids[0], len(ids), news_id))
        # Also re-point the news_card's location_id to the source's location
        # so that joins to locations/cities work.
        if src_loc_id:
            loc_updates.append((src_loc_id, news_id))

    if updates:
        d1.executemany(
            """UPDATE news_cards
               SET source_name = ?, source_url = ?, source_id = ?, sources_count = ?
               WHERE id = ?""",
            updates,
        )
    if loc_updates:
        d1.executemany(
            "UPDATE news_cards SET location_id = ? WHERE id = ?",
            loc_updates,
        )
    print(f"[resolve] updated {len(updates)} news_cards with source metadata, {len(loc_updates)} with location_id")


# ── Main ─────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="Sync AKIRA SQLite → D1 local")
    ap.add_argument("--limit", type=int, default=5000, help="Max news_cards to sync (default 5000)")
    ap.add_argument("--reset", action="store_true", help="Wipe D1 tables before sync")
    ap.add_argument("--dry-run", action="store_true", help="Print plan, don't write")
    args = ap.parse_args()

    print(f"[paths] akira: {AKIRA_DB}")
    print(f"[paths] d1:    {D1_PATH}")
    print(f"[flags] limit={args.limit} reset={args.reset} dry-run={args.dry_run}")

    if args.dry_run:
        akira = sqlite3.connect(str(AKIRA_DB))
        akira.row_factory = None
        for t in ["categories", "locations", "sources", "news_cards", "master_articles"]:
            n = akira.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"[dry-run] would sync {n:>6} rows from {t}")
        return 0

    # Stop wrangler so we can write to its D1 (it holds the file open)
    print("[hint] if wrangler is running, the sync will still work but the new rows may not")
    print("       appear in the API until you restart wrangler dev. Press Ctrl+C now if")
    print("       you want to restart it first. Continuing in 3s...")
    import time
    time.sleep(3)

    akira = sqlite3.connect(str(AKIRA_DB))
    d1 = sqlite3.connect(str(D1_PATH))

    d1.execute("PRAGMA journal_mode=WAL")
    d1.execute("PRAGMA synchronous=OFF")

    if args.reset:
        reset_d1_tables(d1)
        d1.commit()

    n_cat = sync_categories(akira, d1)
    print(f"[sync] categories: {n_cat}")
    d1.commit()

    n_loc = sync_locations(akira, d1)
    print(f"[sync] locations:  {n_loc}")
    d1.commit()

    n_src = sync_sources(akira, d1)
    print(f"[sync] sources:    {n_src}")
    d1.commit()

    n_news = sync_news_cards(akira, d1, args.limit)
    print(f"[sync] news_cards: {n_news}")
    d1.commit()

    resolve_source_meta(akira, d1)
    d1.commit()

    n_master = sync_master_articles(akira, d1)
    print(f"[sync] master_articles: {n_master}")
    d1.commit()

    # Verify
    print()
    print("=== D1 after sync ===")
    for t in ["categories", "locations", "sources", "news_cards", "master_articles"]:
        n = d1.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t}: {n}")

    n_clusters = d1.execute(
        "SELECT COUNT(DISTINCT cluster_id) FROM news_cards WHERE cluster_id IS NOT NULL"
    ).fetchone()[0]
    print(f"  distinct clusters: {n_clusters}")

    d1.close()
    akira.close()
    print()
    print("[done] restart wrangler dev (kill 8800 + restart) to see new data via API")
    return 0


if __name__ == "__main__":
    sys.exit(main())
