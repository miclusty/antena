# DEPRECATED 2026-06-20: Push slugs to Cloudflare D1.
# Superseded by scripts/sync_to_d1.py which syncs all changes.
# Do NOT run this script unless you know what you're doing. See git history
# for the implementation if you need to revive it.
#
# Original docstring preserved below for reference.
#
"""Read all (id, slug, slug_date) from local SQLite and push to production D1.

One-shot. Idempotent (uses UPDATE which is a no-op for same value).
"""
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
DB = ROOT / "data" / "akira.db"
BATCH = 200  # rows per wrangler invocation; D1's max-statement-length is ~100KB


def main() -> int:
    conn = sqlite3.connect(str(DB))
    rows = conn.execute(
        "SELECT id, slug, slug_date FROM news_cards "
        "WHERE slug != '' AND slug_date != '' "
        "ORDER BY published_at DESC"
    ).fetchall()
    conn.close()
    print(f"Read {len(rows)} cards with slugs from local DB")

    if not rows:
        print("Nothing to push.")
        return 0

    api_dir = ROOT.parent / "api"
    total = 0
    for batch_start in range(0, len(rows), BATCH):
        batch = rows[batch_start : batch_start + BATCH]
        statements = []
        for card_id, slug, slug_date in batch:
            # Escape single quotes in slug (unlikely but defensive)
            slug_safe = slug.replace("'", "''")
            sd_safe = slug_date.replace("'", "''")
            statements.append(
                f"UPDATE news_cards SET slug='{slug_safe}', slug_date='{sd_safe}' "
                f"WHERE id='{card_id}'"
            )
        sql = ";\n".join(statements) + ";"
        # Write to a temp file and pass via --file
        tmp = Path("/tmp/seo-deploy/d1-batch.sql")
        tmp.parent.mkdir(exist_ok=True, parents=True)
        tmp.write_text(sql)
        result = subprocess.run(
            [
                "pnpm",
                "wrangler",
                "d1",
                "execute",
                "DB",
                "--env=production",
                "--remote",
                "--file",
                str(tmp),
            ],
            cwd=str(api_dir),
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"Batch {batch_start}-{batch_start+len(batch)} FAILED:")
            print(result.stderr[:500])
            print(result.stdout[:500])
            return 1
        total += len(batch)
        print(f"  ✓ Pushed {total}/{len(rows)} cards")

    print(f"Done. Pushed {total} cards to D1.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
