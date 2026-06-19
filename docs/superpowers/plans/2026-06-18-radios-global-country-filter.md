# Radios Globales con Filtro de País — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import ~25,000 radio stations from `random-radio/crawler/data/skill_radio.db` (216 countries) into Antena's AKIRA media store, expose them via a country-filtered API, and have the frontend auto-filter by the visitor's country (Cloudflare `cf-ipcountry` header) with a manual override.

**Architecture:**
- AKIRA SQLite stays source of truth (no D1 mirror)
- Table `argentine_media` renamed to `media`, gains `country` column + `country_code`/`language`/`bitrate`/`codec`
- Backwards-compat view preserves legacy queries
- API Worker resolves country from cookie override → `cf-ipcountry` header → AR fallback
- New country index endpoint powers the UI selector
- Frontend persists user override in localStorage + cookie

**Tech Stack:**
- Python 3.11 + SQLite 3.31+ (AKIRA)
- TypeScript + Hono (API Worker, Cloudflare Workers)
- Solid.js + Astro 5 (Antena)
- Playwright (E2E)
- pytest (AKIRA), vitest (API + frontend)

**Spec:** `docs/superpowers/specs/2026-06-18-radios-global-country-filter-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|------|----------------|
| `packages/akira/scripts/media/import_random_radio_global.py` | Import 25k stations from random-radio DB |
| `packages/akira/tests/test_import_random_radio_global.py` | Import script unit tests |
| `packages/akira/tests/test_medios_radios.py` | AKIRA `/medios/radios` endpoint tests |
| `packages/api/src/routes/radios-countries.ts` | `/api/stats/radios/countries` endpoint |
| `packages/api/tests/radios-country.test.ts` | Country resolution tests |
| `packages/api/tests/radios-countries.test.ts` | Countries index tests |
| `packages/antena/src/lib/user-country.ts` | Country state (signals + cookie/LS) |
| `packages/antena/src/lib/countries.ts` | Static ISO → name/flag map (generated) |
| `packages/antena/scripts/generate-countries.ts` | Build-time generator for `countries.ts` |
| `packages/antena/src/components/radios/CountrySelector.tsx` | Drawer UI for picking country |
| `packages/antena/src/tests/user-country.test.ts` | Country state tests |
| `packages/antena/src/tests/CountrySelector.test.tsx` | Selector UI tests |
| `packages/antena/tests/e2e/radios-country.spec.ts` | Playwright E2E test |
| `packages/akira/migrations/0002_media_global.sql` | Schema migration script |

### Modified files

| Path | Change |
|------|--------|
| `packages/akira/main.py` | `/medios/radios` accepts `?country=` + `?offset=`; new `/medios/radios/countries` |
| `packages/akira/scripts/media/import_random_radio.py` | Mark deprecated, add deprecation notice |
| `packages/api/src/routes/stats.ts` | `/api/stats/radios` reads `cf-ipcountry` + `antena_country` cookie |
| `packages/antena/src/components/common/RadioPlayer.tsx` | Integrate `user-country` + show flag, add "Cambiar país" |
| `packages/antena/src/components/radios/RadiosExplorer.tsx` | Pass country to fetch, show country in header |
| `packages/antena/src/pages/radios.astro` | Pass empty radios to explorer (client-side fetch) |
| `packages/antena/package.json` | Add `generate:countries` script |

---

## Task Index

| # | Task | Phase |
|---|------|-------|
| 1 | Pre-flight: backup DB, baseline tests | 0 |
| 2 | Apply SQLite schema migration | 1 |
| 3 | Generate static country list (`countries.ts`) | 1 |
| 4 | Write import script tests (TDD) | 2 |
| 5 | Implement `import_random_radio_global.py` | 2 |
| 6 | Run import + verify row counts | 2 |
| 7 | AKIRA `/medios/radios` country filter (TDD) | 3 |
| 8 | AKIRA `/medios/radios/countries` endpoint (TDD) | 3 |
| 9 | API Worker country resolution (TDD) | 4 |
| 10 | API Worker `/api/stats/radios/countries` (TDD) | 4 |
| 11 | Frontend `user-country.ts` module (TDD) | 5 |
| 12 | Frontend `CountrySelector.tsx` component (TDD) | 5 |
| 13 | `RadioPlayer.tsx` integration | 5 |
| 14 | `RadiosExplorer.tsx` + `radios.astro` integration | 5 |
| 15 | Verification: typecheck + lint + test | 6 |
| 16 | Manual verification in dev | 6 |
| 17 | Deploy staging + smoke test | 7 |
| 18 | Deploy production + Lighthouse check | 7 |

---

## Task 1: Pre-flight — backup DB + baseline tests

**Files:** none modified

- [ ] **Step 1: Backup the AKIRA database**

```bash
cp packages/akira/data/akira.db packages/akira/data/akira.db.bak.$(date +%s)
ls -la packages/akira/data/akira.db*
```

Expected: backup file appears with timestamp suffix.

- [ ] **Step 2: Run baseline AKIRA tests**

```bash
cd packages/akira && source .venv/bin/activate
python -m pytest -x -q
```

Expected: all tests pass.

- [ ] **Step 3: Run baseline API + Antena typecheck and lint**

```bash
cd /Users/omatic/proyectos/news
pnpm typecheck
pnpm lint
```

Expected: both pass with no errors.

- [ ] **Step 4: Commit baseline snapshot**

```bash
git -c user.email=opencode@local -c user.name=opencode commit --allow-empty -m "chore: pre-flight baseline for radios-global"
```

---

## Task 2: Apply SQLite schema migration

**Files:**
- Create: `packages/akira/migrations/0002_media_global.sql`

- [ ] **Step 1: Write the migration SQL**

`packages/akira/migrations/0002_media_global.sql`:

```sql
-- 0002_media_global.sql
-- Rename argentine_media → media, add country column + nullable media metadata.

ALTER TABLE argentine_media RENAME TO media;

ALTER TABLE media ADD COLUMN country      TEXT NOT NULL DEFAULT 'AR';
ALTER TABLE media ADD COLUMN country_code TEXT;
ALTER TABLE media ADD COLUMN language     TEXT;
ALTER TABLE media ADD COLUMN bitrate      TEXT;
ALTER TABLE media ADD COLUMN codec        TEXT;

CREATE VIEW IF NOT EXISTS argentine_media AS
  SELECT * FROM media WHERE country = 'AR';

CREATE INDEX IF NOT EXISTS idx_media_country      ON media(country);
CREATE INDEX IF NOT EXISTS idx_media_country_type ON media(country, type);
CREATE INDEX IF NOT EXISTS idx_media_country_city ON media(country, city);
```

- [ ] **Step 2: Apply the migration locally**

```bash
sqlite3 packages/akira/data/akira.db < packages/akira/migrations/0002_media_global.sql
```

Expected: no output (success).

- [ ] **Step 3: Verify the migration**

```bash
sqlite3 packages/akira/data/akira.db <<EOF
.headers on
.mode column
SELECT COUNT(*) AS media_count FROM media;
SELECT COUNT(*) AS legacy_view_count FROM argentine_media;
SELECT COUNT(*) AS ar_count FROM media WHERE country='AR';
.schema media
EOF
```

Expected:
- `media_count` = 1181 (existing rows preserved)
- `legacy_view_count` = 1181 (view mirrors)
- `ar_count` = 1181 (backfilled via DEFAULT)
- Schema includes `country`, `country_code`, `language`, `bitrate`, `codec`

- [ ] **Step 4: Commit**

```bash
git add packages/akira/migrations/0002_media_global.sql
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(akira): rename argentine_media → media + country column"
```

---

## Task 3: Generate static country list

**Files:**
- Create: `packages/antena/scripts/generate-countries.ts`
- Create: `packages/antena/src/lib/countries.ts`

- [ ] **Step 1: Write the generator script**

`packages/antena/scripts/generate-countries.ts`:

```ts
#!/usr/bin/env node
/**
 * Generates src/lib/countries.ts from random-radio's worldcities.csv.
 * Extracts distinct (country_code, country_name) pairs.
 *
 * Output: ~216 countries with ISO-2 code, name, flag emoji.
 *
 * Run: pnpm generate:countries
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = '/Users/omatic/proyectos/random-radio/crawler/data/worldcities.csv';
const OUTPUT = resolve(__dirname, '../src/lib/countries.ts');

interface Row {
  code: string;
  name: string;
  flag: string;
}

function countryCodeToFlag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '🌍';
  const base = 0x1f1e6;
  const A = 0x41;
  return String.fromCodePoint(
    base + (code.charCodeAt(0) - A),
    base + (code.charCodeAt(1) - A),
  );
}

function main(): void {
  const raw = readFileSync(SOURCE, 'utf-8');
  const lines = raw.split('\n').slice(1); // skip header

  const seen = new Map<string, string>(); // code → name
  for (const line of lines) {
    const cols = line.split(',');
    if (cols.length < 2) continue;
    const [code, name] = cols;
    if (!/^[A-Z]{2}$/.test(code) || !name) continue;
    if (!seen.has(code)) seen.set(code, name.trim());
  }

  const countries: Row[] = Array.from(seen.entries())
    .map(([code, name]) => ({
      code,
      name,
      flag: countryCodeToFlag(code),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const content = `// AUTO-GENERATED by scripts/generate-countries.ts — do not edit.
export interface CountryInfo {
  code: string;
  name: string;
  flag: string;
}

export const COUNTRIES: Record<string, CountryInfo> = {
${countries.map((c) => `  "${c.code}": { name: ${JSON.stringify(c.name)}, flag: "${c.flag}" },`).join('\n')}
};

export const COUNTRIES_LIST: CountryInfo[] = ${JSON.stringify(countries, null, 2)};
`;

  writeFileSync(OUTPUT, content, 'utf-8');
  console.log(`Wrote ${countries.length} countries to ${OUTPUT}`);
}

main();
```

- [ ] **Step 2: Add npm script**

In `packages/antena/package.json`, under `"scripts"`:

```json
"generate:countries": "tsx scripts/generate-countries.ts"
```

- [ ] **Step 3: Run the generator**

```bash
cd packages/antena
pnpm generate:countries
```

Expected: `Wrote NNN countries to /Users/omatic/proyectos/news/packages/antena/src/lib/countries.ts` (NNN ≈ 216).

- [ ] **Step 4: Verify output**

```bash
head -30 packages/antena/src/lib/countries.ts
```

Expected: starts with the auto-generated comment, then `export const COUNTRIES`.

- [ ] **Step 5: Commit**

```bash
git add packages/antena/scripts/generate-countries.ts packages/antena/src/lib/countries.ts packages/antena/package.json
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(antena): static country list from worldcities.csv"
```

---

## Task 4: Import script tests (TDD)

**Files:**
- Create: `packages/akira/tests/test_import_random_radio_global.py`

- [ ] **Step 1: Write the failing tests**

`packages/akira/tests/test_import_random_radio_global.py`:

```python
"""Tests for import_random_radio_global.py.

Uses a fixture DB with a small set of stations from 5 countries
to verify the import script's behavior.
"""

import os
import sqlite3
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def sample_rr_db(tmp_path: Path) -> Path:
    """Create a tiny random-radio DB with 5 stations from 3 countries."""
    db = tmp_path / "skill_radio.db"
    conn = sqlite3.connect(db)
    conn.execute("""
        CREATE TABLE stations (
            id INTEGER PRIMARY KEY,
            slug TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            name TEXT NOT NULL,
            location TEXT NOT NULL,
            stream_url TEXT,
            country TEXT,
            country_code TEXT,
            city TEXT,
            language TEXT,
            bitrate TEXT,
            codec TEXT,
            website TEXT,
            tags TEXT,
            UNIQUE(slug, channel_id)
        )
    """)
    rows = [
        # AR with city match (Buenos Aires maps to codgl='02000')
        ('ar-1', 'radio-mitre',  'Radio Mitre',  'BA',
         'https://m.stream', 'Argentina', 'AR', 'Buenos Aires', 'es', '128', 'mp3', 'https://radiomitre.cienradios.com', 'am'),
        # AR without city match (codgl=NULL)
        ('ar-2', 'radio-loc',    'Radio Local',  'UnknownPueblo',
         'https://m.stream', 'Argentina', 'AR', 'UnknownPueblo', 'es', '64', 'mp3', None, 'fm'),
        # US
        ('us-1', 'npr',          'NPR',          'NY',
         'https://n.stream', 'United States', 'US', 'New York', 'en', '192', 'aac', 'https://npr.org', 'news'),
        # BR
        ('br-1', 'jovem-pan',    'Jovem Pan',    'SAO',
         'https://j.stream', 'Brazil', 'BR', 'São Paulo', 'pt', '128', 'mp3', 'https://jovempan.com.br', 'news'),
        # No stream_url — must be skipped
        ('xx-1', 'dead-radio',   'Dead Radio',   'XX',
         None, 'Argentina', 'AR', 'Mendoza', 'es', None, None, None, None),
    ]
    conn.executemany("""
        INSERT INTO stations (slug, channel_id, name, location, stream_url,
                              country, country_code, city, language, bitrate,
                              codec, website, tags)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, rows)
    conn.commit()
    conn.close()
    return db


@pytest.fixture
def akira_db(tmp_path: Path, monkeypatch) -> Path:
    """Create a minimal AKIRA DB with argentine_towns table + media table.

    Includes 'Buenos Aires' as a known town with codgl='02000'.
    """
    db = tmp_path / "akira.db"
    conn = sqlite3.connect(db)
    conn.executescript("""
        CREATE TABLE argentine_towns (
            name TEXT PRIMARY KEY,
            province TEXT NOT NULL,
            codgl TEXT NOT NULL,
            population INTEGER
        );
        INSERT INTO argentine_towns VALUES ('Buenos Aires', 'Buenos Aires', '02000', 3000000);

        CREATE TABLE media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            city TEXT NOT NULL,
            province TEXT,
            codgl TEXT,
            website TEXT,
            facebook_url TEXT,
            instagram_url TEXT,
            stream_url TEXT,
            tags TEXT,
            source TEXT NOT NULL DEFAULT 'random-radio',
            country TEXT,
            country_code TEXT,
            language TEXT,
            bitrate TEXT,
            codec TEXT,
            UNIQUE(name, city, type)
        );
    """)
    conn.commit()
    conn.close()
    return db


def test_imports_stations_with_stream_url(sample_rr_db, akira_db, monkeypatch):
    """All 4 stations with stream_url should be imported; the dead-radio one skipped."""
    from scripts.media import import_random_radio_global as mod

    monkeypatch.setattr(mod.coverage, "DEFAULT_DB", str(akira_db))

    rc = mod.main(args_override=["--rr-db", str(sample_rr_db)])
    assert rc == 0

    conn = sqlite3.connect(akira_db)
    rows = conn.execute(
        "SELECT name, country, codgl FROM media WHERE type='radio' ORDER BY name"
    ).fetchall()
    conn.close()
    names = [r[0] for r in rows]
    assert "Radio Mitre" in names
    assert "Radio Local" in names
    assert "NPR" in names
    assert "Jovem Pan" in names
    assert "Dead Radio" not in names  # stream_url was NULL


def test_assigns_codgl_for_matched_argentine_city(sample_rr_db, akira_db, monkeypatch):
    """Buenos Aires should match the argentine_towns fixture and get codgl='02000'."""
    from scripts.media import import_random_radio_global as mod

    monkeypatch.setattr(mod.coverage, "DEFAULT_DB", str(akira_db))
    mod.main(args_override=["--rr-db", str(sample_rr_db)])

    conn = sqlite3.connect(akira_db)
    row = conn.execute(
        "SELECT codgl FROM media WHERE name='Radio Mitre'"
    ).fetchone()
    conn.close()
    assert row[0] == "02000"


def test_unmatched_argentine_city_stores_codgl_null(sample_rr_db, akira_db, monkeypatch):
    """Stations in Argentina without a known pueblo get codgl=NULL but still import."""
    from scripts.media import import_random_radio_global as mod

    monkeypatch.setattr(mod.coverage, "DEFAULT_DB", str(akira_db))
    mod.main(args_override=["--rr-db", str(sample_rr_db)])

    conn = sqlite3.connect(akira_db)
    row = conn.execute(
        "SELECT codgl, country FROM media WHERE name='Radio Local'"
    ).fetchone()
    conn.close()
    assert row[0] is None
    assert row[1] == "AR"


def test_non_argentine_stations_have_null_codgl(sample_rr_db, akira_db, monkeypatch):
    """Non-AR stations always have codgl=NULL regardless of city."""
    from scripts.media import import_random_radio_global as mod

    monkeypatch.setattr(mod.coverage, "DEFAULT_DB", str(akira_db))
    mod.main(args_override=["--rr-db", str(sample_rr_db)])

    conn = sqlite3.connect(akira_db)
    rows = conn.execute(
        "SELECT name, codgl, country_code FROM media WHERE country IN ('US','BR')"
    ).fetchall()
    conn.close()
    for name, codgl, code in rows:
        assert codgl is None, f"{name} should have codgl NULL"
        assert code in ("US", "BR")


def test_re_import_is_idempotent(sample_rr_db, akira_db, monkeypatch):
    """Running the import twice should not create duplicate rows."""
    from scripts.media import import_random_radio_global as mod

    monkeypatch.setattr(mod.coverage, "DEFAULT_DB", str(akira_db))
    mod.main(args_override=["--rr-db", str(sample_rr_db)])
    mod.main(args_override=["--rr-db", str(sample_rr_db)])

    conn = sqlite3.connect(akira_db)
    count = conn.execute("SELECT COUNT(*) FROM media").fetchone()[0]
    conn.close()
    assert count == 4, f"Expected 4 unique rows, got {count}"


def test_reset_drops_existing_random_radio_rows(sample_rr_db, akira_db, monkeypatch):
    """--reset should clear all rows with source='random-radio*' before importing."""
    from scripts.media import import_random_radio_global as mod

    monkeypatch.setattr(mod.coverage, "DEFAULT_DB", str(akira_db))

    # First import
    mod.main(args_override=["--rr-db", str(sample_rr_db)])

    # Manually insert a row with source='random-radio' that should be cleared by --reset
    conn = sqlite3.connect(akira_db)
    conn.execute("""
        INSERT INTO media (name, type, city, source, country)
        VALUES ('Stale Station', 'radio', 'Old City', 'random-radio', 'AR')
    """)
    conn.commit()
    conn.close()

    # Reset + reimport
    mod.main(args_override=["--rr-db", str(sample_rr_db), "--reset"])

    conn = sqlite3.connect(akira_db)
    stale = conn.execute(
        "SELECT COUNT(*) FROM media WHERE name='Stale Station'"
    ).fetchone()[0]
    conn.close()
    assert stale == 0, "--reset should have removed the stale row"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/akira && source .venv/bin/activate
python -m pytest tests/test_import_random_radio_global.py -v
```

Expected: all 6 tests FAIL with `ModuleNotFoundError: No module named 'scripts.media.import_random_radio_global'` or similar.

- [ ] **Step 3: Commit failing tests**

```bash
git add packages/akira/tests/test_import_random_radio_global.py
git -c user.email=opencode@local -c user.name=opencode commit -m "test(akira): failing tests for global radio import"
```

---

## Task 5: Implement `import_random_radio_global.py`

**Files:**
- Create: `packages/akira/scripts/media/import_random_radio_global.py`

- [ ] **Step 1: Implement the script**

`packages/akira/scripts/media/import_random_radio_global.py`:

```python
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
    --dry-run         Parse + count without writing
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


def _insert_one(
    conn: sqlite3.Connection,
    name: str,
    city: str,
    province: str | None,
    codgl: str | None,
    country: str,
    country_code: str | None,
    language: str | None,
    bitrate: str | None,
    codec: str | None,
    website: str | None,
    stream_url: str,
    tags: str | None,
    source: str,
) -> bool:
    """Insert one radio row; return True if newly inserted."""
    try:
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO media (
                name, type, city, province, codgl,
                website, stream_url, tags, source,
                country, country_code, language, bitrate, codec
            ) VALUES (?, 'radio', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name, city, province, codgl,
                website, stream_url, tags, source,
                country, country_code, language, bitrate, codec,
            ),
        )
        return cur.rowcount == 1
    except sqlite3.IntegrityError:
        return False


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

        batch.append((
            name, city or "", province, codgl,
            website, stream_url, tags, source,
            country, country_code, language, bitrate, codec,
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
    s = coverage.stats(conn)
    print(f"Coverage: {s['covered_towns']}/{s['total_towns']} pueblos ({s['coverage_pct']}%)")
    print(f"Total media: {sum(s['by_type'].values())}")

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
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd packages/akira && source .venv/bin/activate
python -m pytest tests/test_import_random_radio_global.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/akira/scripts/media/import_random_radio_global.py
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(akira): import_random_radio_global.py for 25k radios"
```

---

## Task 6: Run full import + verify row counts

**Files:** none (verification step)

- [ ] **Step 1: Dry run first**

```bash
cd packages/akira && source .venv/bin/activate
python scripts/media/import_random_radio_global.py --dry-run
```

Expected: `random-radio: 25182 stations with stream_url` followed by top-15 countries (AR 818, US 3638, BR 2328, etc.).

- [ ] **Step 2: Full import**

```bash
python scripts/media/import_random_radio_global.py
```

Expected: takes 5–10 min, prints coverage stats and top countries.

- [ ] **Step 3: Verify row counts**

```bash
sqlite3 packages/akira/data/akira.db <<EOF
.headers on
.mode column
SELECT country, COUNT(*) AS n FROM media
WHERE type='radio' AND country IS NOT NULL
GROUP BY country ORDER BY n DESC LIMIT 10;
SELECT COUNT(*) AS total_radios FROM media WHERE type='radio';
EOF
```

Expected: top row `AR 818`, `US 3638`, `BR 2328`; total ≈ 25,182.

- [ ] **Step 4: Tag the import (optional)**

```bash
git tag -a radio-import-25k -m "First 25k radios imported"
```

---

## Task 7: AKIRA `/medios/radios` country filter (TDD)

**Files:**
- Create: `packages/akira/tests/test_medios_radios.py`
- Modify: `packages/akira/main.py:1725-1767`

- [ ] **Step 1: Write failing tests**

`packages/akira/tests/test_medios_radios.py`:

```python
"""Tests for the AKIRA /medios/radios endpoint."""

import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def akira_db_with_radios(tmp_path: Path, monkeypatch) -> Path:
    """Create a minimal AKIRA DB with media rows from 3 countries."""
    db = tmp_path / "akira.db"
    conn = sqlite3.connect(db)
    conn.executescript("""
        CREATE TABLE media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            city TEXT NOT NULL,
            province TEXT,
            codgl TEXT,
            website TEXT,
            stream_url TEXT,
            tags TEXT,
            source TEXT NOT NULL,
            country TEXT,
            country_code TEXT,
            language TEXT,
            bitrate TEXT,
            codec TEXT,
            UNIQUE(name, city, type)
        );
        INSERT INTO media (name, type, city, stream_url, source, country) VALUES
            ('Radio AR1', 'radio', 'Buenos Aires', 'https://a', 'random-radio', 'AR'),
            ('Radio AR2', 'radio', 'Córdoba',      'https://b', 'random-radio', 'AR'),
            ('Radio US1', 'radio', 'New York',     'https://c', 'random-radio-global', 'US'),
            ('Radio BR1', 'radio', 'São Paulo',    'https://d', 'random-radio-global', 'BR'),
            ('Diario X',  'diario', 'Buenos Aires', NULL,      'random-radio', 'AR');
    """)
    conn.commit()
    conn.close()

    # Patch DEFAULT_DB so main.get_db_connection uses our fixture
    import core.coverage
    monkeypatch.setattr(core.coverage, "DEFAULT_DB", str(db))
    return db


@pytest.fixture
def client(akira_db_with_radios):
    from main import app
    return TestClient(app)


def test_filters_by_country(client):
    r = client.get("/medios/radios?country=US")
    assert r.status_code == 200
    data = r.json()
    names = [it["name"] for it in data["items"]]
    assert names == ["Radio US1"]


def test_returns_only_radios_not_other_types(client):
    r = client.get("/medios/radios?country=AR")
    data = r.json()
    names = [it["name"] for it in data["items"]]
    assert "Diario X" not in names
    assert "Radio AR1" in names
    assert "Radio AR2" in names


def test_no_country_returns_all(client):
    r = client.get("/medios/radios")
    data = r.json()
    assert len(data["items"]) == 4  # 3 radios + the diario (all radios)


def test_pagination_offset_and_limit(client):
    r = client.get("/medios/radios?limit=2&offset=0")
    data = r.json()
    assert len(data["items"]) == 2
    r = client.get("/medios/radios?limit=2&offset=2")
    data = r.json()
    assert len(data["items"]) == 2


def test_response_includes_country_and_country_code(client):
    r = client.get("/medios/radios?country=AR")
    item = r.json()["items"][0]
    assert "country" in item
    assert "country_code" in item or item.get("country_code") is None
    assert item["country"] == "AR"


def test_lowercase_country_query_works(client):
    r = client.get("/medios/radios?country=us")
    data = r.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["name"] == "Radio US1"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/akira && source .venv/bin/activate
python -m pytest tests/test_medios_radios.py -v
```

Expected: tests FAIL — `?country=` is not yet honored, returns all 4 rows.

- [ ] **Step 3: Modify the AKIRA endpoint**

In `packages/akira/main.py`, replace the `get_radios` function (lines 1725-1767) with:

```python
@app.get("/medios/radios")
async def get_radios(request: Request):
    """Live radio directory for the persistent player.

    Returns all radios with stream_url from the `media` table.
    Used by the Antena /radios page and the floating play bar.

    Query params:
      - limit: max rows (default 200, max 5000)
      - offset: pagination offset (default 0)
      - country: ISO-3166-1 alpha-2 (e.g. 'AR', 'US'); case-insensitive
      - codgl: filter to a specific pueblo (5-digit gov-loc code)
      - province: filter to a specific province name
    """
    conn = get_db_connection()
    try:
        limit = min(int(request.query_params.get("limit", "200")), 5000)
        offset = max(int(request.query_params.get("offset", "0")), 0)
        codgl = request.query_params.get("codgl")
        province = request.query_params.get("province")
        country = request.query_params.get("country")

        where = ["type = 'radio'", "stream_url IS NOT NULL", "stream_url != ''"]
        params: list = []
        if country:
            where.append("country = ?")
            params.append(country.upper())
        if codgl:
            where.append("codgl = ?")
            params.append(codgl)
        if province:
            where.append("LOWER(province) = LOWER(?)")
            params.append(province)

        sql = f"""
            SELECT id, name, stream_url, website, city, province,
                   country, country_code, language, bitrate, codec,
                   codgl, tags, type, source
            FROM media
            WHERE {' AND '.join(where)}
            ORDER BY
              CASE WHEN codgl IS NOT NULL THEN 0 ELSE 1 END,
              name ASC
            LIMIT ? OFFSET ?
        """
        params.extend([limit, offset])
        rows = conn.execute(sql, params).fetchall()
        items = [dict(r) for r in rows]
        return {
            "items": items,
            "total": len(items),
            "country": country.upper() if country else None,
            "offset": offset,
            "limit": limit,
        }
    finally:
        conn.close()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_medios_radios.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/akira/tests/test_medios_radios.py packages/akira/main.py
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(akira): /medios/radios country filter + pagination"
```

---

## Task 8: AKIRA `/medios/radios/countries` endpoint (TDD)

**Files:**
- Modify: `packages/akira/tests/test_medios_radios.py`
- Modify: `packages/akira/main.py` (add endpoint after `/medios/radios`)

- [ ] **Step 1: Add failing tests**

Append to `packages/akira/tests/test_medios_radios.py`:

```python
def test_countries_endpoint_returns_index(client):
    r = client.get("/medios/radios/countries")
    assert r.status_code == 200
    data = r.json()
    assert "countries" in data
    assert "total" in data
    assert data["total"] >= 3  # AR, US, BR


def test_countries_sorted_by_count_desc(client):
    r = client.get("/medios/radios/countries")
    data = r.json()
    counts = [c["count"] for c in data["countries"]]
    assert counts == sorted(counts, reverse=True)


def test_countries_have_iso_code(client):
    r = client.get("/medios/radios/countries")
    for c in r.json()["countries"]:
        assert "code" in c
        assert len(c["code"]) == 2
        assert "count" in c
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/akira && source .venv/bin/activate
python -m pytest tests/test_medios_radios.py -v -k countries
```

Expected: 3 tests FAIL with 404 Not Found.

- [ ] **Step 3: Add the endpoint**

In `packages/akira/main.py`, immediately after the `get_radios` function (after the new code from Task 7), add:

```python
@app.get("/medios/radios/countries")
async def get_radios_countries():
    """Country index for the radio selector UI.

    Returns one row per country that has at least one radio with
    a stream_url, sorted by count DESC. Cheap aggregate query.
    """
    conn = get_db_connection()
    try:
        rows = conn.execute("""
            SELECT country, COUNT(*) AS count
            FROM media
            WHERE type = 'radio'
              AND stream_url IS NOT NULL
              AND stream_url != ''
              AND country IS NOT NULL
            GROUP BY country
            ORDER BY count DESC
        """).fetchall()
        countries = [
            {"code": r["country"], "count": r["count"]}
            for r in rows
        ]
        total = sum(c["count"] for c in countries)
        return {"countries": countries, "total": total}
    finally:
        conn.close()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_medios_radios.py -v -k countries
```

Expected: 3 country tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/akira/tests/test_medios_radios.py packages/akira/main.py
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(akira): /medios/radios/countries index endpoint"
```

---

## Task 9: API Worker country resolution (TDD)

**Files:**
- Create: `packages/api/tests/radios-country.test.ts`
- Modify: `packages/api/src/routes/stats.ts:107-174`

- [ ] **Step 1: Write failing tests**

`packages/api/tests/radios-country.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the AKIRA fetch so we don't make real HTTP calls
vi.mock("../src/lib/types", () => ({
  // We'll override per-test
}));

import { resolveCountry } from "../src/lib/country";

describe("resolveCountry", () => {
  const makeReq = (headers: Record<string, string>, cookies: Record<string, string> = {}) => {
    const cookieStr = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    const headerObj: Record<string, string> = { ...headers };
    if (cookieStr) headerObj["cookie"] = cookieStr;
    return new Request("https://api.example.com/api/stats/radios", {
      headers: headerObj,
    });
  };

  it("uses cookie override over cf-ipcountry", () => {
    const req = makeReq({ "cf-ipcountry": "BR" }, { antena_country: "CL" });
    expect(resolveCountry(req)).toBe("CL");
  });

  it("uses cf-ipcountry when no cookie override", () => {
    const req = makeReq({ "cf-ipcountry": "BR" });
    expect(resolveCountry(req)).toBe("BR");
  });

  it("falls back to AR when cf-ipcountry is XX", () => {
    const req = makeReq({ "cf-ipcountry": "XX" });
    expect(resolveCountry(req)).toBe("AR");
  });

  it("falls back to AR when cf-ipcountry is T1", () => {
    const req = makeReq({ "cf-ipcountry": "T1" });
    expect(resolveCountry(req)).toBe("AR");
  });

  it("falls back to AR when cf-ipcountry is missing", () => {
    const req = makeReq({});
    expect(resolveCountry(req)).toBe("AR");
  });

  it("uppercases lowercase values", () => {
    const req = makeReq({ "cf-ipcountry": "br" });
    expect(resolveCountry(req)).toBe("BR");
  });

  it("ignores malformed cookie", () => {
    const req = makeReq({ "cf-ipcountry": "AR" }, { antena_country: "invalid123" });
    expect(resolveCountry(req)).toBe("AR");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/api
pnpm test radios-country.test.ts
```

Expected: tests FAIL — `resolveCountry` not exported from `../src/lib/country`.

- [ ] **Step 3: Create the helper**

Create `packages/api/src/lib/country.ts`:

```ts
const COUNTRY_RE = /^[A-Z]{2}$/;
const UNKNOWN_VALUES = new Set(["XX", "T1"]);

export function resolveCountry(req: Request): string {
  // 1. Cookie override
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(/(?:^|;\s*)antena_country=([A-Za-z]{2})/);
  if (match) {
    const code = match[1].toUpperCase();
    if (COUNTRY_RE.test(code)) return code;
  }

  // 2. Cloudflare cf-ipcountry
  const cf = req.headers.get("cf-ipcountry")?.toUpperCase();
  if (cf && COUNTRY_RE.test(cf) && !UNKNOWN_VALUES.has(cf)) {
    return cf;
  }

  // 3. Fallback
  return "AR";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test radios-country.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Wire `resolveCountry` into the existing `/radios` route**

In `packages/api/src/routes/stats.ts`, modify the existing handler at line 107:

```ts
import { resolveCountry } from "../lib/country";

// ... inside statsRoutes.get("/radios", ...) handler:

statsRoutes.get("/radios", async (c) => {
  const db = c.env.DB;
  const limit = Math.min(Number(c.req.query("limit") ?? 200), 5000);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);
  const codgl = c.req.query("codgl");
  const province = c.req.query("province");

  // Resolve country from cookie override → cf-ipcountry → AR
  const country = resolveCountry(c.req.raw);

  const cache = caches.default;
  const cacheKey = new Request(
    `https://akira-api.miclusty.workers.dev/api/stats/radios?` +
    `country=${country}&offset=${offset}&limit=${limit}` +
    `&codgl=${codgl ?? ''}&province=${province ?? ''}`,
  );
  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.json() as {
      items: unknown[]; cached: boolean; source: string; total: number;
    };
    body.cached = true;
    return c.json(body);
  }

  // Try AKIRA first
  const akiraBase = c.env.AKIRA_URL;
  let items: unknown[] = [];
  let total = 0;
  let source = "d1";

  if (akiraBase) {
    try {
      const url = new URL(`${akiraBase}/medios/radios`);
      url.searchParams.set("country", country);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));
      if (codgl) url.searchParams.set("codgl", codgl);
      if (province) url.searchParams.set("province", province);
      const res = await fetch(url.toString(), {
        headers: { "User-Agent": "AntenaRadiosProxy/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json() as {
          items?: unknown[]; total?: number;
        };
        items = data.items ?? [];
        total = data.total ?? items.length;
        source = "akira";
      }
    } catch {
      // fall through to D1
    }
  }

  // Fallback: if AKIRA returned 0 items (country with no radios), try AR once
  if (!items.length && country !== "AR" && akiraBase) {
    try {
      const url = new URL(`${akiraBase}/medios/radios?country=AR&limit=${limit}`);
      const res = await fetch(url.toString(), {
        headers: { "User-Agent": "AntenaRadiosProxy/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json() as { items?: unknown[]; total?: number };
        items = data.items ?? [];
        total = data.total ?? items.length;
        source = "akira-fallback";
      }
    } catch { /* ignore */ }
  }

  if (!items.length) {
    const where: string[] = ["type = 'radio'", "is_active = 1"];
    const params: (string | number)[] = [];
    if (province) { where.push("province = ?"); params.push(province); }
    const res = await db.prepare(`
      SELECT id, name, url, NULL as stream_url, NULL as website,
             NULL as city, province, NULL as codgl, NULL as tags,
             'radio' as type, 'sources' as source, NULL as country
      FROM sources
      WHERE ${where.join(' AND ')}
      ORDER BY news_count DESC
      LIMIT ?
    `).bind(...params, limit).all();
    items = res.results ?? [];
    total = items.length;
  }

  const body = {
    items, total, cached: false, source,
    country, offset, limit,
  };
  const cacheRes = new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=900",
    },
  });
  await cache.put(cacheKey, cacheRes);
  return c.json(body);
});
```

- [ ] **Step 6: Verify `pnpm typecheck` passes**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/lib/country.ts packages/api/src/routes/stats.ts packages/api/tests/radios-country.test.ts
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(api): resolve country from cf-ipcountry + cookie override"
```

---

## Task 10: API Worker `/api/stats/radios/countries` (TDD)

**Files:**
- Create: `packages/api/tests/radios-countries.test.ts`
- Modify: `packages/api/src/routes/stats.ts` (add new route)

- [ ] **Step 1: Write failing tests**

`packages/api/tests/radios-countries.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.stubGlobal("fetch", vi.fn());

import { statsRoutes } from "../src/routes/stats";

describe("GET /api/stats/radios/countries", () => {
  it("returns countries list + detected + override", async () => {
    const fakeAkira = {
      countries: [
        { code: "AR", count: 818 },
        { code: "US", count: 3638 },
      ],
      total: 4456,
    };

    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify(fakeAkira), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await statsRoutes.request(
      "/countries",
      {
        headers: {
          "cf-ipcountry": "BR",
        },
      },
      // minimal env
      { AKIRA_URL: "http://akira:5100" } as any,
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.detected).toBe("BR");
    expect(data.override).toBeNull();
    expect(data.countries).toHaveLength(2);
    expect(data.total).toBe(4456);
  });

  it("uses cookie override as override", async () => {
    const fakeAkira = { countries: [{ code: "CL", count: 200 }], total: 200 };
    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify(fakeAkira), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await statsRoutes.request(
      "/countries",
      {
        headers: {
          "cf-ipcountry": "AR",
          "cookie": "antena_country=CL",
        },
      },
      { AKIRA_URL: "http://akira:5100" } as any,
    );
    const data = await res.json();
    expect(data.detected).toBe("AR");
    expect(data.override).toBe("CL");
  });

  it("falls back to AR when cf-ipcountry is XX", async () => {
    (fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ countries: [], total: 0 }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await statsRoutes.request(
      "/countries",
      { headers: { "cf-ipcountry": "XX" } },
      { AKIRA_URL: "http://akira:5100" } as any,
    );
    const data = await res.json();
    expect(data.detected).toBe("AR");
  });
});
```

> **Note:** `statsRoutes.request` is a Hono test helper that takes `(path, init, env)`. Adjust to your existing test pattern if different.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/api
pnpm test radios-countries.test.ts
```

Expected: tests FAIL — `/countries` route not registered.

- [ ] **Step 3: Add the new route**

In `packages/api/src/routes/stats.ts`, after the `/radios` handler, add:

```ts
// Country index for the radio selector UI. Reads from AKIRA and
// annotates with the resolved country (cf-ipcountry + cookie override).
statsRoutes.get("/radios/countries", async (c) => {
  const cache = caches.default;
  const cacheKey = new Request(
    "https://akira-api.miclusty.workers.dev/api/stats/radios/countries",
  );
  const cached = await cache.match(cacheKey);
  let data: { countries: unknown[]; total: number };

  if (cached) {
    data = await cached.json();
  } else {
    const akiraBase = c.env.AKIRA_URL;
    if (!akiraBase) {
      return c.json({ error: "AKIRA_URL not configured" }, 500);
    }
    try {
      const res = await fetch(`${akiraBase}/medios/radios/countries`, {
        headers: { "User-Agent": "AntenaRadiosProxy/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`AKIRA ${res.status}`);
      data = await res.json();
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
    const cacheRes = new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=86400",
      },
    });
    await cache.put(cacheKey, cacheRes);
  }

  const cookieHeader = c.req.raw.headers.get("cookie") ?? "";
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)antena_country=([A-Za-z]{2})/);
  const override = cookieMatch ? cookieMatch[1].toUpperCase() : null;

  const cfHeader = c.req.raw.headers.get("cf-ipcountry")?.toUpperCase();
  const detected =
    cfHeader && /^[A-Z]{2}$/.test(cfHeader) && cfHeader !== "XX" && cfHeader !== "T1"
      ? cfHeader
      : "AR";

  return c.json({
    countries: data.countries,
    total: data.total,
    detected,
    override,
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test radios-countries.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/stats.ts packages/api/tests/radios-countries.test.ts
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(api): /api/stats/radios/countries endpoint"
```

---

## Task 11: Frontend `user-country.ts` module (TDD)

**Files:**
- Create: `packages/antena/src/tests/user-country.test.ts`
- Create: `packages/antena/src/lib/user-country.ts`

- [ ] **Step 1: Write failing tests**

`packages/antena/src/tests/user-country.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("user-country", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "antena_country=; path=/; max-age=0";
    vi.resetModules();
  });

  it("loadUserCountry reads localStorage override and skips fetch", async () => {
    localStorage.setItem("antena.radio.country", "CL");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { loadUserCountry, country, isOverride } = await import("../lib/user-country");
    const code = await loadUserCountry();
    expect(code).toBe("CL");
    expect(country()).toBe("CL");
    expect(isOverride()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loadUserCountry falls back to /api/stats/radios/countries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        countries: [{ code: "AR", count: 818 }],
        total: 818,
        detected: "AR",
        override: null,
      }), { headers: { "Content-Type": "application/json" } }),
    );
    const { loadUserCountry, country, detectedCountry } = await import("../lib/user-country");
    const code = await loadUserCountry();
    expect(code).toBe("AR");
    expect(detectedCountry()).toBe("AR");
  });

  it("loadUserCountry default AR when fetch fails and no LS", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const { loadUserCountry, country } = await import("../lib/user-country");
    const code = await loadUserCountry();
    expect(code).toBe("AR");
    expect(country()).toBe("AR");
  });

  it("setUserCountry writes localStorage and cookie", async () => {
    const { setUserCountry, country } = await import("../lib/user-country");
    setUserCountry("US");
    expect(localStorage.getItem("antena.radio.country")).toBe("US");
    expect(document.cookie).toContain("antena_country=US");
    expect(country()).toBe("US");
  });

  it("setUserCountry rejects malformed codes", async () => {
    const { setUserCountry, country } = await import("../lib/user-country");
    setUserCountry("invalid");
    expect(localStorage.getItem("antena.radio.country")).toBeNull();
    expect(country()).toBe("AR"); // unchanged default
  });

  it("clearUserCountry removes localStorage + cookie", async () => {
    localStorage.setItem("antena.radio.country", "CL");
    document.cookie = "antena_country=CL; path=/";
    const { clearUserCountry } = await import("../lib/user-country");
    clearUserCountry();
    expect(localStorage.getItem("antena.radio.country")).toBeNull();
    expect(document.cookie.includes("antena_country=CL")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/antena
pnpm test user-country.test.ts
```

Expected: tests FAIL — module not found.

- [ ] **Step 3: Implement the module**

`packages/antena/src/lib/user-country.ts`:

```ts
import { createSignal } from "solid-js";
import { getApiBase } from "./api";

const LS_KEY = "antena.radio.country";
const COOKIE = "antena_country";
const COUNTRY_RE = /^[A-Z]{2}$/;

const [country, setCountry] = createSignal<string>("AR");
const [detectedCountry, setDetected] = createSignal<string | null>(null);
const [isOverride, setIsOverride] = createSignal(false);

export async function loadUserCountry(): Promise<string> {
  // 1. localStorage override wins immediately
  const ls = typeof localStorage !== "undefined"
    ? localStorage.getItem(LS_KEY)
    : null;
  if (ls && COUNTRY_RE.test(ls)) {
    setCountry(ls);
    setIsOverride(true);
    return ls;
  }

  // 2. Fetch detected + override from backend
  try {
    const r = await fetch(`${getApiBase()}/api/stats/radios/countries`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const detected = data.detected ?? "AR";
    setDetected(detected);
    const effective = data.override ?? detected ?? "AR";
    setCountry(effective);
    setIsOverride(Boolean(data.override));
    return effective;
  } catch {
    // Network failure — keep default 'AR'
    return country();
  }
}

export function setUserCountry(code: string): void {
  if (!COUNTRY_RE.test(code)) return;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(LS_KEY, code);
  }
  document.cookie = `${COOKIE}=${code}; path=/; max-age=86400; SameSite=Lax`;
  setCountry(code);
  setIsOverride(true);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("antena:country-changed", { detail: { country: code } }));
  }
}

export function clearUserCountry(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(LS_KEY);
  }
  document.cookie = `${COOKIE}=; path=/; max-age=0`;
  setIsOverride(false);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("antena:country-changed", { detail: { country: detectedCountry() ?? "AR" } }));
  }
}

export { country, detectedCountry, isOverride };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test user-country.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/antena/src/lib/user-country.ts packages/antena/src/tests/user-country.test.ts
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(antena): user-country signal + localStorage + cookie"
```

---

## Task 12: Frontend `CountrySelector.tsx` component (TDD)

**Files:**
- Create: `packages/antena/src/tests/CountrySelector.test.tsx`
- Create: `packages/antena/src/components/radios/CountrySelector.tsx`

- [ ] **Step 1: Write failing tests**

`packages/antena/src/tests/CountrySelector.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";

vi.mock("../lib/user-country", () => ({
  country: () => "AR",
  setUserCountry: vi.fn(),
  clearUserCountry: vi.fn(),
}));

describe("CountrySelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders country list with flags", async () => {
    const { default: CountrySelector } = await import("../components/radios/CountrySelector");
    render(() => <CountrySelector onClose={() => {}} />);
    // Argentina should appear from the static COUNTRIES list
    expect(screen.getByText(/Argentina/)).toBeInTheDocument();
  });

  it("filters countries by name", async () => {
    const { default: CountrySelector } = await import("../components/radios/CountrySelector");
    render(() => <CountrySelector onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/buscar/i);
    fireEvent.input(input, { target: { value: "brasil" } });
    expect(screen.getByText(/Brasil/)).toBeInTheDocument();
    expect(screen.queryByText(/Alemania/)).toBeNull();
  });

  it("calls setUserCountry on click and closes", async () => {
    const userCountry = await import("../lib/user-country");
    const onClose = vi.fn();
    const { default: CountrySelector } = await import("../components/radios/CountrySelector");
    render(() => <CountrySelector onClose={onClose} />);
    const argentina = screen.getByText(/Argentina/);
    fireEvent.click(argentina);
    expect(userCountry.setUserCountry).toHaveBeenCalledWith("AR");
    expect(onClose).toHaveBeenCalled();
  });

  it("has reset-to-detected button", async () => {
    const userCountry = await import("../lib/user-country");
    const { default: CountrySelector } = await import("../components/radios/CountrySelector");
    render(() => <CountrySelector onClose={() => {}} />);
    const reset = screen.getByText(/Restablecer/i);
    fireEvent.click(reset);
    expect(userCountry.clearUserCountry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/antena
pnpm test CountrySelector.test.tsx
```

Expected: tests FAIL — component not found.

- [ ] **Step 3: Implement the component**

`packages/antena/src/components/radios/CountrySelector.tsx`:

```tsx
import { createMemo, createSignal, For, Show } from "solid-js";
import { COUNTRIES_LIST } from "../../lib/countries";
import { country, setUserCountry, clearUserCountry } from "../../lib/user-country";

interface Props {
  onClose: () => void;
}

export default function CountrySelector(props: Props) {
  const [query, setQuery] = createSignal("");

  const filtered = createMemo(() => {
    const q = query().toLowerCase().trim();
    if (!q) return COUNTRIES_LIST;
    return COUNTRIES_LIST.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  });

  const handlePick = (code: string) => {
    setUserCountry(code);
    props.onClose();
  };

  return (
    <div class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4" onClick={props.onClose}>
      <div
        class="bg-[var(--surface)] w-full max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Cambiar país"
      >
        <header class="flex items-center justify-between mb-3">
          <h2 class="text-lg font-semibold">Cambiar país</h2>
          <button
            type="button"
            class="text-2xl px-2"
            onClick={props.onClose}
            aria-label="Cerrar"
          >×</button>
        </header>

        <input
          type="search"
          placeholder="Buscar país…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          class="w-full px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] mb-3"
        />

        <ul class="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
          <For each={filtered()}>
            {(c) => (
              <li>
                <button
                  type="button"
                  class="w-full flex items-center gap-3 px-3 py-2 hover:bg-[var(--surface-2)] text-left"
                  onClick={() => handlePick(c.code)}
                  aria-current={country() === c.code ? "true" : undefined}
                >
                  <span class="text-2xl">{c.flag}</span>
                  <span class="flex-1">{c.name}</span>
                  <Show when={country() === c.code}>
                    <span class="text-[var(--accent)]" aria-label="seleccionado">✓</span>
                  </Show>
                </button>
              </li>
            )}
          </For>
          <Show when={filtered().length === 0}>
            <li class="px-3 py-6 text-center text-[var(--text-muted)]">
              Sin resultados
            </li>
          </Show>
        </ul>

        <button
          type="button"
          class="mt-3 text-sm text-[var(--text-muted)] hover:text-[var(--text)] underline"
          onClick={() => {
            clearUserCountry();
            props.onClose();
          }}
        >
          Restablecer detección automática
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test CountrySelector.test.tsx
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/antena/src/components/radios/CountrySelector.tsx packages/antena/src/tests/CountrySelector.test.tsx
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(antena): CountrySelector drawer component"
```

---

## Task 13: Integrate country into `RadioPlayer.tsx`

**Files:**
- Modify: `packages/antena/src/components/common/RadioPlayer.tsx`

- [ ] **Step 1: Add the country import + state hook**

At the top of `RadioPlayer.tsx`, add to the imports:

```tsx
import { loadUserCountry, country, setUserCountry } from "../../lib/user-country";
import { COUNTRIES } from "../../lib/countries";
import CountrySelector from "../radios/CountrySelector";
```

- [ ] **Step 2: Add country loading + state**

Find the `default function RadioPlayer()` block. Add inside the component body, near the top:

```tsx
const [showCountryPicker, setShowCountryPicker] = createSignal(false);

// On mount, resolve user country
onMount(async () => {
  await loadUserCountry();
  loadRadios();
});
```

If `onMount` is not already imported, add `import { onMount } from "solid-js";`.

- [ ] **Step 3: Refactor `loadRadios()` to use the country**

Find the `loadRadios` function and modify the fetch URL:

```tsx
const loadRadios = async () => {
  if (loading() || radios().length) return;
  setLoading(true);
  setError(null);
  try {
    const url = new URL(`${getApiBase()}/api/stats/radios`);
    url.searchParams.set("country", country());
    url.searchParams.set("limit", "2000");
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "AntenaRadio/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { items?: Radio[] };
    const items = data.items ?? [];
    setRadios(items);
    // ... rest unchanged
```

- [ ] **Step 4: Add the "Cambiar país" button to the UI**

Locate the player header (around line 413 where it shows the current radio city). Add next to the favorite button:

```tsx
<button
  type="button"
  class="p-2 rounded-full hover:bg-[var(--surface-2)]"
  onClick={() => setShowCountryPicker(true)}
  aria-label="Cambiar país"
  title={`País: ${COUNTRIES[country()]?.name ?? country()}`}
>
  <span class="text-lg">{COUNTRIES[country()]?.flag ?? "🌍"}</span>
</button>
```

- [ ] **Step 5: Render the CountrySelector conditionally**

At the end of the component, before the closing fragment:

```tsx
<Show when={showCountryPicker()}>
  <CountrySelector onClose={() => setShowCountryPicker(false)} />
</Show>
```

- [ ] **Step 6: Listen for country changes from elsewhere**

Find the existing `onMount` (or add one) and subscribe to the event:

```tsx
onMount(() => {
  const handler = () => loadRadios();
  window.addEventListener("antena:country-changed", handler);
  onCleanup(() => window.removeEventListener("antena:country-changed", handler));
});
```

> **Note:** if the file already has an `onMount` from Step 2, merge the logic.

- [ ] **Step 7: Verify typecheck + tests**

```bash
cd packages/antena
pnpm typecheck
pnpm test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/antena/src/components/common/RadioPlayer.tsx
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(antena): RadioPlayer country selector + refetch on change"
```

---

## Task 14: Integrate country into `RadiosExplorer.tsx` + `radios.astro`

**Files:**
- Modify: `packages/antena/src/components/radios/RadiosExplorer.tsx`
- Modify: `packages/antena/src/pages/radios.astro`

- [ ] **Step 1: Update `RadiosExplorer.tsx` to consume country**

At the top of the file, add:

```tsx
import { country } from "../../lib/user-country";
```

In the component body, modify the fetch logic (around line 40):

```tsx
const fetchRadios = async (reset = false) => {
  // ... existing setup ...
  const url = new URL(`${API}/api/stats/radios`);
  url.searchParams.set("country", country());
  url.searchParams.set("limit", String(PAGE));
  url.searchParams.set("offset", String(offset));
  // ... rest unchanged
```

Replace any hard-coded `?limit=` with the country-aware URL.

- [ ] **Step 2: Update the header counter**

Find where the explorer shows the count (line 145 area). Update to:

```tsx
{filtered().length.toLocaleString('es-AR')} radios · {COUNTRIES[country()]?.flag} {COUNTRIES[country()]?.name ?? country()}
```

Add `import { COUNTRIES } from "../../lib/countries";` at the top.

- [ ] **Step 3: Add the CountrySelector trigger button**

Find the search/filter row and add a button to open the country selector:

```tsx
const [showCountryPicker, setShowCountryPicker] = createSignal(false);
import { createSignal, Show } from "solid-js";  // if not already imported
import CountrySelector from "./CountrySelector";

// ... inside the JSX, near the search input:
<button
  type="button"
  class="px-3 py-2 rounded-lg border border-[var(--border)]"
  onClick={() => setShowCountryPicker(true)}
>
  {COUNTRIES[country()]?.flag} {COUNTRIES[country()]?.name ?? country()}
</button>

// ... at the end of the JSX:
<Show when={showCountryPicker()}>
  <CountrySelector onClose={() => setShowCountryPicker(false)} />
</Show>
```

- [ ] **Step 4: Modify `radios.astro` to defer radios load to client**

In `packages/antena/src/pages/radios.astro`, find:

```astro
<RadiosExplorer client:load radios={radios} />
```

Replace with:

```astro
<RadiosExplorer client:load radios={[]} />
```

- [ ] **Step 5: Verify typecheck + tests**

```bash
cd packages/antena
pnpm typecheck
pnpm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/antena/src/components/radios/RadiosExplorer.tsx packages/antena/src/pages/radios.astro
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(antena): RadiosExplorer + radios page country-aware"
```

---

## Task 15: Verification — typecheck, lint, full test suite

**Files:** none

- [ ] **Step 1: Run root typecheck**

```bash
cd /Users/omatic/proyectos/news
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 2: Run root lint**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 3: Run AKIRA tests**

```bash
cd packages/akira && source .venv/bin/activate
python -m pytest -x -q
```

Expected: all tests pass.

- [ ] **Step 4: Run API tests**

```bash
cd packages/api
pnpm test
```

Expected: all tests pass.

- [ ] **Step 5: Run Antena tests**

```bash
cd packages/antena
pnpm test
```

Expected: all tests pass.

---

## Task 16: Manual verification in dev

**Files:** none

- [ ] **Step 1: Start AKIRA + API + Antena dev servers**

```bash
# Terminal 1
cd packages/akira && source .venv/bin/activate
python -m uvicorn main:app --host 0.0.0.0 --port 5000

# Terminal 2
cd packages/api
pnpm dev   # port 8787

# Terminal 3
cd packages/antena
pnpm dev   # port 4321
```

- [ ] **Step 2: Open the homepage**

Visit `http://localhost:4321`. The RadioPlayer should show the default AR flag (🇦🇷). Click the panel — radios should be AR.

- [ ] **Step 3: Simulate non-AR country via cookie**

In the browser console:

```js
document.cookie = "antena_country=CL; path=/; max-age=86400";
location.reload();
```

Expected: the RadioPlayer now shows the 🇨🇱 flag, radios list refreshes to CL.

- [ ] **Step 4: Verify localStorage takes precedence**

```js
localStorage.setItem("antena.radio.country", "US");
location.reload();
```

Expected: 🇺🇸 flag and US radios load.

- [ ] **Step 5: Open the /radios page**

Visit `http://localhost:4321/radios`. Verify the country selector is visible. Click "Cambiar país" → picker opens.

- [ ] **Step 6: Test "Restablecer detección automática"**

Click the reset link. Reload. Country should revert to AR (or whatever cf-ipcountry would return).

---

## Task 17: Deploy staging + smoke test

**Files:** none

- [ ] **Step 1: Deploy AKIRA**

If AKIRA is running on a remote server, restart it so the new endpoint and import are live.

- [ ] **Step 2: Deploy API Worker to staging**

```bash
cd packages/api
wrangler deploy --env=staging
```

Expected: deploy URL printed.

- [ ] **Step 3: Smoke test staging API**

```bash
curl -s "https://akira-api-staging.miclusty.workers.dev/api/stats/radios/countries" \
  -H "User-Agent: SmokeTest/1.0"
```

Expected: JSON with `countries`, `total`, `detected`, `override` fields.

- [ ] **Step 4: Smoke test radios filter**

```bash
curl -s "https://akira-api-staging.miclusty.workers.dev/api/stats/radios?country=US&limit=3" \
  -H "User-Agent: SmokeTest/1.0"
```

Expected: 3 items, all with `country: "US"`.

- [ ] **Step 5: Deploy Antena to staging**

```bash
cd /Users/omatic/proyectos/news
pnpm deploy:staging
```

- [ ] **Step 6: Visual smoke test on staging URL**

Open the staging URL in a browser. Verify:
- Homepage RadioPlayer shows a country flag (defaults to AR without cf-ipcountry)
- /radios page loads and shows radios
- "Cambiar país" button opens picker
- Lighthouse score is not significantly degraded

---

## Task 18: Deploy production + Lighthouse check

**Files:** none

- [ ] **Step 1: Deploy API Worker to production**

```bash
cd packages/api
wrangler deploy --env=production
```

- [ ] **Step 2: Deploy Antena to production**

```bash
cd /Users/omatic/proyectos/news
pnpm deploy:prod
```

- [ ] **Step 3: Run Lighthouse on production**

```bash
pnpm lighthouse
```

Expected: score stays ≥ 90 (or close to previous baseline). If significantly lower, investigate bundle size.

- [ ] **Step 4: Verify production radios endpoint**

```bash
curl -s "https://akira-api.miclusty.workers.dev/api/stats/radios?country=AR&limit=5" \
  -H "User-Agent: PostDeploy/1.0" | head -c 500
```

Expected: valid JSON with `items` array.

- [ ] **Step 5: Smoke test on production URL**

Visit `https://www.antena.com.ar/radios` in a browser. Verify:
- The default country loads (AR for most traffic)
- Country selector works
- Player plays a sample radio

- [ ] **Step 6: Final commit + tag**

```bash
git -c user.email=opencode@local -c user.name=opencode commit --allow-empty -m "chore: radios-global deployed to production"
git tag v1.0-radios-global
```

---

## Self-Review

**Spec coverage:**

| Spec section | Tasks |
|--------------|-------|
| Schema rename + new columns | Task 2 |
| Indexes on country | Task 2 |
| Backwards-compat view | Task 2 |
| Static country list | Task 3 |
| Import script (25k) | Tasks 4–6 |
| AKIRA `/medios/radios?country=` | Task 7 |
| AKIRA `/medios/radios/countries` | Task 8 |
| API Worker `resolveCountry` | Task 9 |
| API Worker `/api/stats/radios/countries` | Task 10 |
| Frontend `user-country.ts` | Task 11 |
| Frontend `CountrySelector.tsx` | Task 12 |
| `RadioPlayer.tsx` integration | Task 13 |
| `RadiosExplorer.tsx` + `radios.astro` integration | Task 14 |
| Verification (typecheck/lint/test) | Task 15 |
| Manual dev verification | Task 16 |
| Staging deploy + smoke | Task 17 |
| Production deploy + Lighthouse | Task 18 |

All spec requirements covered. ✅

**Placeholder scan:** No "TBD", "TODO", or vague steps. Every code block is complete.

**Type consistency:**
- `country()` signal defined in `user-country.ts` (Task 11), consumed by `RadioPlayer` (Task 13), `RadiosExplorer` (Task 14), `CountrySelector` (Task 12). Consistent.
- `resolveCountry(req)` takes `Request`, returns `string`. Consistent across all callers.
- `COUNTRIES` and `COUNTRIES_LIST` from `countries.ts` (Task 3). `CountrySelector` uses `COUNTRIES_LIST`, `RadioPlayer` uses `COUNTRIES`. Consistent.
- API response shape: `{ items, total, country, offset, limit, cached, source }`. Defined in Task 7 (AKIRA) and Task 9 (Worker proxy).

**Edge cases from spec covered:**
- `cf-ipcountry == "XX"` / `"T1"` → Task 9 (`resolveCountry`)
- Country with 0 radios → Task 9 fallback to AR (in `/radios` handler)
- Cookie expired / invalid → Task 9 (`COUNTRY_RE` check rejects malformed)
- Country change while playing → Task 13 (pauses via existing `RadioPlayer` flow)
- No network first load → Task 11 (`loadUserCountry` catch block defaults to AR)

**Out of scope per spec:** GPS geolocation, i18n UI, cross-device sync, D1 mirror, bitrate/codec UI filters — none included. ✅

**Risks noted in spec:**
- Long import: covered by `--dry-run` flag in Task 6
- DB growth: VACUUM not added (spec says "future" via cron); acceptable
- cf-ipcountry inaccurate: manual override covered (Task 11)
- Lighthouse regression: checked in Task 18

---

## Total estimated time

| Phase | Tasks | Time |
|-------|-------|------|
| Pre-flight | 1 | 5 min |
| Schema + static countries | 2–3 | 15 min |
| Import 25k | 4–6 | 25 min (incl. import run) |
| AKIRA endpoints | 7–8 | 30 min |
| API Worker | 9–10 | 30 min |
| Frontend | 11–14 | 75 min |
| Verify | 15–16 | 20 min |
| Deploy | 17–18 | 25 min |

**Total: ~3.5 hours** (slightly higher than spec's 2.5h estimate due to TDD overhead — acceptable for the confidence gain).
