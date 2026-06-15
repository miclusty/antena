#!/usr/bin/env python3
"""
Sync script: AKIRA local SQLite → Cloudflare D1 (REMOTE / production).

This is the production equivalent of sync_to_d1.py. Instead of writing
directly to the Miniflare SQLite file, it generates INSERT statements
and pipes them to `wrangler d1 execute --remote`.

Usage:
    cd packages/akira
    source .venv/bin/activate
    python scripts/sync_to_d1_remote.py [--limit N] [--config wrangler.production.toml]

Flags:
    --limit N       Sync only the N most recent news_cards (default: 10000)
    --config PATH   Path to wrangler config (default: ../api/wrangler.production.toml)
    --batch-size N  Rows per INSERT batch (default: 100, D1 limit is ~100KB per request)
    --tables LIST   Comma-separated tables to sync (default: all)
"""

import argparse
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
AKIRA_ROOT = HERE.parent
API_ROOT = AKIRA_ROOT.parent / "api"
AKIRA_DB = AKIRA_ROOT / "data/akira.db"


def generate_inserts(table: str, columns: list[str], rows: list[tuple]) -> list[str]:
    """Build a list of INSERT OR REPLACE statements."""
    if not rows:
        return []
    cols_csv = ", ".join(f'"{c}"' for c in columns)
    stmts = []
    for r in rows:
        vals_csv = ", ".join(_sql_value(v) for v in r)
        stmts.append(f'INSERT OR REPLACE INTO "{table}" ({cols_csv}) VALUES ({vals_csv});')
    return stmts


def _sql_value(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, bool):
        return "1" if v else "0"
    s = str(v).replace("'", "''")
    return f"'{s}'"


def read_categories(akira: sqlite3.Connection) -> list[str]:
    rows = akira.execute("SELECT id, slug, name, icon FROM categories").fetchall()
    return generate_inserts("categories", ["id", "slug", "name", "icon"], rows)


def read_locations(akira: sqlite3.Connection) -> list[str]:
    rows = akira.execute(
        "SELECT id, name, province, country, lat, lng, population, type, parent_id FROM locations"
    ).fetchall()
    type_map = {"ciudad": "city", "provincia": "state", "pais": "country", "autonomous_city": "city"}
    norm = [
        (r[0], r[1], r[2], r[3] or "AR", r[4], r[5], r[6], type_map.get(r[7], r[7] or "city"), r[8])
        for r in rows
    ]
    return generate_inserts(
        "locations", ["id", "name", "province", "country", "lat", "lng", "population", "type", "parent_id"],
        norm,
    )


def read_sources(akira: sqlite3.Connection) -> list[str]:
    # 24 columns from AKIRA sources, + 2 synthesized (country='AR', bias_score=0) = 26 total
    rows = akira.execute(
        """SELECT id, name, url, domain, location_id, province, type,
                  rss_url, wp_api_url, sitemap_url, extraction_method,
                  reliability_score, is_active, deactivation_reason,
                  last_fetch, last_success, last_harvest_at, fetch_count,
                  error_count, news_count, gacetilla_count, avg_bias,
                  created_at, updated_at
           FROM sources"""
    ).fetchall()
    # Re-order to match D1 sources column order:
    # AKIRA idx → D1 col:
    #   0 id, 1 name, 2 url, 3 domain, "AR" country, 5 province, 4 location_id, 6 type,
    #   7 rss_url, 8 wp_api_url, 9 sitemap_url, 10 extraction_method,
    #   11 reliability_score, 0.0 bias_score, 12 is_active, 13 deactivation_reason,
    #   14 last_fetch, 15 last_success, 16 last_harvest_at, 17 fetch_count,
    #   18 error_count, 19 news_count, 20 gacetilla_count, 21 avg_bias,
    #   22 created_at, 23 updated_at
    norm = [
        (r[0], r[1], r[2], r[3], "AR", r[5], r[4], r[6],
         r[7], r[8], r[9], r[10], r[11], 0.0,
         r[12], r[13], r[14], r[15], r[16], r[17], r[18], r[19], r[20],
         r[21], r[22], r[23])
        for r in rows
    ]
    return generate_inserts(
        "sources",
        ["id", "name", "url", "domain", "country", "province", "location_id", "type",
         "rss_url", "wp_api_url", "sitemap_url", "extraction_method",
         "reliability_score", "bias_score", "is_active", "deactivation_reason",
         "last_fetch", "last_success", "last_harvest_at", "fetch_count",
         "error_count", "news_count", "gacetilla_count", "avg_bias",
         "created_at", "updated_at"],
        norm,
    )


def read_news_cards(akira: sqlite3.Connection, limit: int) -> tuple[list[str], list[tuple]]:
    """Returns (insert_stmts_for_news_cards, raw_rows_for_source_meta_pass)"""
    rows = akira.execute(
        f"""SELECT id, location_id, title, summary, image_url, bias_score,
                   is_gacetilla, cluster_id, category, source_ids,
                   published_at, created_at, quality_score, gacetilla_confidence,
                   body, article_url
            FROM news_cards
            ORDER BY created_at DESC
            LIMIT ?""",
        (limit,),
    ).fetchall()
    norm = []
    for r in rows:
        # Indexes in the SELECT above:
        #   0 id, 1 location_id, 2 title, 3 summary, 4 image_url,
        #   5 bias_score, 6 is_gacetilla, 7 cluster_id, 8 category,
        #   9 source_ids, 10 published_at, 11 created_at,
        #   12 quality_score, 13 gacetilla_confidence,
        #   14 body, 15 article_url
        norm.append((
            r[0], r[1], r[2], r[3], r[14], r[4],
            None, None, None, r[8],    # source_url, source_name, source_id (set by UPDATE pass), category
            r[15],                       # article_url (NEW, from local SQLite)
            r[5], r[6], r[13], None, r[12],
            r[7], r[10], r[11],
        ))
    inserts = generate_inserts(
        "news_cards",
        ["id", "location_id", "title", "summary", "body", "image_url",
         "source_url", "source_name", "source_id", "category",
         "article_url",
         "bias_score", "is_gacetilla", "gacetilla_confidence",
         "sources_count", "quality_score", "cluster_id",
         "published_at", "created_at"],
        norm,
    )
    return inserts, rows


def read_source_meta_updates(akira: sqlite3.Connection, news_rows: list[tuple]) -> list[str]:
    """UPDATE news_cards SET source_name/source_url/source_id/sources_count/location_id
    based on parsing source_ids CSV → first source's metadata."""
    sources = {
        row[0]: (row[1], row[2], row[3], row[4])
        for row in akira.execute("SELECT id, name, url, location_id, province FROM sources").fetchall()
    }
    updates = []
    for r in news_rows:
        news_id, source_ids_csv = r[0], r[9]
        if not source_ids_csv:
            continue
        ids = [int(s) for s in source_ids_csv.split(",") if s.strip().isdigit()]
        if not ids:
            continue
        first_specific = next(
            (sources[i] for i in ids if i in sources and sources[i][2] and sources[i][2] != 1),
            None,
        )
        if not first_specific:
            first_specific = sources.get(ids[0])
        if not first_specific:
            continue
        name, url, src_loc_id, _province = first_specific
        # UPDATE: name, url, source_id, sources_count, location_id
        updates.append(
            f"UPDATE news_cards SET source_name = {_sql_value(name)}, "
            f"source_url = {_sql_value(url)}, source_id = {ids[0]}, "
            f"sources_count = {len(ids)}, location_id = {src_loc_id} "
            f"WHERE id = {_sql_value(news_id)};"
        )
    return updates


def read_master_articles(akira: sqlite3.Connection) -> list[str]:
    rows = akira.execute(
        """SELECT id, cluster_id, title, summary, verified_facts, disputed_claims,
                  officialist_perspective, opposition_perspective, neutral_perspective,
                  sources_count, bias_min, bias_max, bias_avg, created_at
           FROM master_articles"""
    ).fetchall()
    norm = [
        (r[0], r[1], r[2], r[3], None, r[4], r[5], r[6], r[7], r[8],
         r[9], r[10], r[11], r[12], r[13])
        for r in rows
    ]
    return generate_inserts(
        "master_articles",
        ["id", "cluster_id", "title", "summary", "body", "verified_facts",
         "disputed_claims", "officialist_perspective", "opposition_perspective",
         "neutral_perspective", "sources_count", "bias_min", "bias_max", "bias_avg",
         "created_at"],
        norm,
    )


def read_entities(akira: sqlite3.Connection) -> list[str]:
    """Sync the entity knowledge base (LMWIKI part 1: entities).

    D1's entities table uses the same shape as the local SQLite
    one, so we can stream the rows directly. The mention_count
    column is denormalized (sum of entity_mentions rows) — we
    recompute it on the local side before sync.
    """
    rows = akira.execute(
        """SELECT id, name, type, aliases, first_seen, last_seen,
                  mention_count, created_at, updated_at
           FROM entities
           ORDER BY id"""
    ).fetchall()
    return generate_inserts(
        "entities",
        ["id", "name", "type", "aliases", "first_seen", "last_seen",
         "mention_count", "created_at", "updated_at"],
        rows,
    )


def read_entity_mentions(akira: sqlite3.Connection) -> list[str]:
    """Sync which cards mention which entities. The (card_id,
    entity_id) UNIQUE index on D1 makes this idempotent."""
    rows = akira.execute(
        """SELECT id, card_id, entity_id, confidence, created_at
           FROM entity_mentions
           ORDER BY id"""
    ).fetchall()
    return generate_inserts(
        "entity_mentions",
        ["id", "card_id", "entity_id", "confidence", "created_at"],
        rows,
    )


def read_entity_co_occurrences(akira: sqlite3.Connection) -> list[str]:
    """Sync the co-occurrence graph. (entity_a_id, entity_b_id)
    is the PRIMARY KEY on D1 so duplicate inserts are skipped."""
    rows = akira.execute(
        """SELECT entity_a_id, entity_b_id, card_count, last_seen
           FROM entity_co_occurrences
           ORDER BY entity_a_id, entity_b_id"""
    ).fetchall()
    return generate_inserts(
        "entity_co_occurrences",
        ["entity_a_id", "entity_b_id", "card_count", "last_seen"],
        rows,
    )


def read_rag_queries(akira: sqlite3.Connection, limit: int = 5000) -> list[str]:
    """Sync the RAG audit log. Bounded by --limit to keep D1
    inserts small (the rag_queries table can grow fast)."""
    rows = akira.execute(
        """SELECT id, cluster_id, model, prompt_tokens, completion_tokens,
                  neighbors_used, entities_used, perspectives, latency_ms, created_at
           FROM rag_queries
           ORDER BY id DESC
           LIMIT ?""",
        (limit,),
    ).fetchall()
    return generate_inserts(
        "rag_queries",
        ["id", "cluster_id", "model", "prompt_tokens", "completion_tokens",
         "neighbors_used", "entities_used", "perspectives", "latency_ms",
         "created_at"],
        rows,
    )


def execute_d1(stmts: list[str], config: str, batch_size: int = 100) -> tuple[int, int]:
    """Pipe batches of statements to wrangler d1 execute --remote.

    Runs in a clean /tmp working directory to avoid the project's
    .npmrc (which contains `approve-builds=true`, triggering an
    npm warning that npx treats as a non-zero exit code).
    """
    if not stmts:
        return 0, 0
    total = len(stmts)
    executed = 0
    failed = 0
    with tempfile.TemporaryDirectory(prefix="wrangler-sync-") as tmp:
        # Copy wrangler.toml + migrations into the clean dir
        config_path = Path(config)
        target = Path(tmp) / "wrangler.toml"
        target.write_text(config_path.read_text())
        # Copy migrations dir if present
        migrations_src = config_path.parent / "migrations"
        if migrations_src.exists():
            import shutil
            shutil.copytree(migrations_src, Path(tmp) / "migrations")
        for i in range(0, total, batch_size):
            batch = stmts[i:i + batch_size]
            with tempfile.NamedTemporaryFile(mode="w", suffix=".sql", delete=False, dir=tmp) as f:
                f.write("\n".join(batch))
                tmp_path = f.name
            try:
                cmd = [
                    "npx", "--no", "wrangler", "d1", "execute", "DB",
                    "--remote", "--file", tmp_path,
                ]
                # Use a clean cwd to avoid .npmrc pollution
                result = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=120, cwd=tmp,
                    env={**os.environ, "npm_config_loglevel": "error"},
                )
                if result.returncode == 0:
                    executed += len(batch)
                    print(f"  [batch {i // batch_size + 1}/{(total + batch_size - 1) // batch_size}] "
                          f"{len(batch)} statements OK")
                else:
                    failed += len(batch)
                    err = (result.stderr or result.stdout or "").strip()
                    print(f"  [batch {i // batch_size + 1}] FAILED: rc={result.returncode} {err[:300]}")
            finally:
                try:
                    os.unlink(tmp_path)
                except FileNotFoundError:
                    pass
    return executed, failed


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync AKIRA SQLite → D1 (remote/production)")
    ap.add_argument("--limit", type=int, default=10000, help="Max news_cards (default 10000)")
    ap.add_argument("--config", default=str(API_ROOT / "wrangler.production.toml"))
    ap.add_argument("--batch-size", type=int, default=100)
    ap.add_argument("--tables", default="all", help="Comma-separated list or 'all'")
    args = ap.parse_args()

    if not Path(args.config).exists():
        print(f"ERROR: wrangler config not found: {args.config}", file=sys.stderr)
        sys.exit(1)
    if not AKIRA_DB.exists():
        print(f"ERROR: akira.db not found: {AKIRA_DB}", file=sys.stderr)
        sys.exit(1)

    print(f"[config] {args.config}")
    print(f"[akira] {AKIRA_DB}")
    print(f"[flags] limit={args.limit} batch={args.batch_size}")

    akira = sqlite3.connect(str(AKIRA_DB))

    tables = (args.tables.split(",") if args.tables != "all"
              else ["categories", "locations", "sources", "news_cards",
                    "master_articles", "entities", "entity_mentions",
                    "entity_co_occurrences", "rag_queries"])

    if "categories" in tables:
        print("\n[sync] categories...")
        stmts = read_categories(akira)
        ex, fail = execute_d1(stmts, args.config, args.batch_size)
        print(f"  → {ex} OK, {fail} failed")

    if "locations" in tables:
        print("\n[sync] locations...")
        stmts = read_locations(akira)
        ex, fail = execute_d1(stmts, args.config, args.batch_size)
        print(f"  → {ex} OK, {fail} failed")

    if "sources" in tables:
        print("\n[sync] sources...")
        stmts = read_sources(akira)
        ex, fail = execute_d1(stmts, args.config, args.batch_size)
        print(f"  → {ex} OK, {fail} failed")

    news_rows = []
    if "news_cards" in tables:
        print(f"\n[sync] news_cards (limit {args.limit})...")
        stmts, news_rows = read_news_cards(akira, args.limit)
        ex, fail = execute_d1(stmts, args.config, args.batch_size)
        print(f"  → {ex} OK, {fail} failed")

        # Pass 2: resolve source metadata + re-point location_id
        if news_rows:
            print(f"\n[resolve] source metadata for {len(news_rows)} news...")
            updates = read_source_meta_updates(akira, news_rows)
            ex, fail = execute_d1(updates, args.config, args.batch_size)
            print(f"  → {ex} OK, {fail} failed")

    if "master_articles" in tables:
        print("\n[sync] master_articles...")
        stmts = read_master_articles(akira)
        ex, fail = execute_d1(stmts, args.config, args.batch_size)
        print(f"  → {ex} OK, {fail} failed")

    if "entities" in tables:
        print("\n[sync] entities...")
        stmts = read_entities(akira)
        ex, fail = execute_d1(stmts, args.config, args.batch_size)
        print(f"  → {ex} OK, {fail} failed")

    if "entity_mentions" in tables:
        print("\n[sync] entity_mentions...")
        stmts = read_entity_mentions(akira)
        ex, fail = execute_d1(stmts, args.config, args.batch_size)
        print(f"  → {ex} OK, {fail} failed")

    if "entity_co_occurrences" in tables:
        print("\n[sync] entity_co_occurrences...")
        stmts = read_entity_co_occurrences(akira)
        ex, fail = execute_d1(stmts, args.config, args.batch_size)
        print(f"  → {ex} OK, {fail} failed")

    if "rag_queries" in tables:
        print("\n[sync] rag_queries...")
        stmts = read_rag_queries(akira, limit=args.limit)
        ex, fail = execute_d1(stmts, args.config, args.batch_size)
        print(f"  → {ex} OK, {fail} failed")

    akira.close()
    print("\n[done] D1 remote populated. Verify with:")
    print(f'  npx wrangler d1 execute DB --config {args.config} --remote '
          '--command "SELECT COUNT(*) FROM news_cards"')
    return 0


if __name__ == "__main__":
    sys.exit(main())
