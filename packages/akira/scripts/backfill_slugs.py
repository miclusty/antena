"""One-time backfill: generate slug + slug_date for all news_cards.

Idempotent. Safe to re-run. Logs progress.

Usage:
    python -m scripts.backfill_slugs --dry-run
    python -m scripts.backfill_slugs
"""
import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extractors._slug import make_slug


def get_existing_slugs_for_date(conn: sqlite3.Connection, slug_date: str) -> set[str]:
    rows = conn.execute(
        "SELECT slug FROM news_cards WHERE slug_date = ? AND slug != ''",
        (slug_date,),
    ).fetchall()
    return {r[0] for r in rows}


def resolve_slug(base_slug: str, slug_date: str, existing: set[str], article_id: str = "") -> str:
    if base_slug not in existing:
        return base_slug
    suffix = (article_id or "x")[:6].lower()
    candidate = f"{base_slug}-{suffix}"
    if candidate not in existing:
        return candidate
    i = 2
    while f"{base_slug}-{suffix}-{i}" in existing:
        i += 1
    return f"{base_slug}-{suffix}-{i}"


def slug_date_from_published_at(published_at: str | None) -> str:
    if not published_at:
        return datetime.utcnow().strftime("%Y-%m-%d")
    try:
        return published_at[:10]
    except Exception:
        return datetime.utcnow().strftime("%Y-%m-%d")


def backfill(db_path: str, dry_run: bool = False, batch_size: int = 1000) -> int:
    conn = sqlite3.connect(db_path)
    cursor = conn.execute(
        "SELECT id, title, published_at, slug, slug_date FROM news_cards WHERE slug = '' OR slug IS NULL"
    )
    rows = cursor.fetchall()
    total = len(rows)
    print(f"Found {total} news_cards to backfill", file=sys.stderr)
    if total == 0:
        return 0
    cache: dict[str, set[str]] = {}
    updated = 0
    batch = []
    for i, (article_id, title, published_at, _old_slug, _old_date) in enumerate(rows, 1):
        slug_date = slug_date_from_published_at(published_at)
        if slug_date not in cache:
            cache[slug_date] = get_existing_slugs_for_date(conn, slug_date)
        existing = cache[slug_date]
        base = make_slug(title or "")
        final = resolve_slug(base, slug_date, existing, article_id)
        cache[slug_date].add(final)
        batch.append((final, slug_date, article_id))
        if len(batch) >= batch_size:
            if not dry_run:
                conn.executemany(
                    "UPDATE news_cards SET slug = ?, slug_date = ? WHERE id = ?",
                    batch,
                )
                conn.commit()
            updated += len(batch)
            batch = []
    if batch:
        if not dry_run:
            conn.executemany(
                "UPDATE news_cards SET slug = ?, slug_date = ? WHERE id = ?",
                batch,
            )
            conn.commit()
        updated += len(batch)
    conn.close()
    mode = "WOULD update" if dry_run else "Updated"
    print(f"{mode} {updated}/{total} rows", file=sys.stderr)
    return updated


def main():
    parser = argparse.ArgumentParser(description="Backfill slug + slug_date for news_cards")
    parser.add_argument("--db", default="data/akira.db", help="Path to SQLite database")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no writes")
    parser.add_argument("--batch-size", type=int, default=1000, help="Rows per commit batch")
    args = parser.parse_args()
    updated = backfill(args.db, dry_run=args.dry_run, batch_size=args.batch_size)
    sys.exit(0 if updated >= 0 else 1)


if __name__ == "__main__":
    main()
