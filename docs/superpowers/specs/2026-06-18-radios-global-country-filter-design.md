# Radios globales con filtro de país del usuario — Design Spec

**Date**: 2026-06-18
**Status**: Draft (pending user review)
**Owner**: antena / AKIRA
**Related**: M1 national coverage module (818 AR radios imported 2026-06-XX),
[macOS Media Session spec](./2026-06-18-macos-media-session-design.md) (planned, separate)

---

## Goal

Expand the live radio directory from 818 Argentine stations to **~25,000 stations across 216 countries** by importing `random-radio/crawler/data/skill_radio.db` in full. The Antena site must **always filter the radio list by the visitor's country** by default (auto-detected via Cloudflare's `cf-ipcountry` header), with a manual override that persists across sessions.

## Why

- 818 AR radios already cover pueblos well, but travellers, expats and curious users want to listen to radio from anywhere.
- The `random-radio` project already curated 25k stations from Radio Garden — wasted if we don't surface them.
- Country-first filtering matches Antena's editorial philosophy: *the news of your place*, extended to *the sound of your place*.

## Non-goals

- ❌ GPS geolocation (precision not needed; cf-ipcountry is good enough)
- ❌ i18n / UI translation (the selector shows flag + ISO code, no localized strings)
- ❌ Cross-device sync of country override (no auth, no server-side preference)
- ❌ Mirror radios to D1 (AKIRA SQLite stays as source of truth)
- ❌ Per-stream health checks (existing error handling is enough)
- ❌ Filtering by bitrate / codec / genre in the UI (data is stored but not exposed)

---

## Architecture

```
[random-radio DB]                              [antena.com.ar]
   25,182 estaciones                               Visitor in 🇧🇷
   216 países                  ┌─────────────────┐
       │                       │                 ▼
       ▼                       │   ┌──────────────────────────┐
┌──────────────────┐           │   │   Cloudflare Edge         │
│ import_random_   │           │   │   GET /api/stats/radios   │
│ radio_global.py  │           │   │   cf-ipcountry: BR        │
│ (AKIRA script)   │           │   │   cookie: antena_country  │
└────────┬─────────┘           │   └────────┬─────────────────┘
         │                     │            │ HTTP
         ▼                     │            ▼
┌──────────────────┐           │   ┌──────────────────────────┐
│ AKIRA SQLite     │◄──────────┘   │   AKIRA /medios/radios     │
│ tabla `media`    │   tunnel      │   WHERE country=?          │
│ 25k radios       │               │   ?country=CL&limit=200    │
└──────────────────┘               └──────────────────────────┘
```

**Data flow per request:**

1. Visitor loads `/radios` or opens the persistent `RadioPlayer`
2. Browser GET `/api/stats/radios` (no query params)
3. Cloudflare Worker reads `cf-ipcountry` header → falls back to `AR` if `XX`/`T1`
4. Worker reads cookie `antena_country` → if present, **overrides** the header value
5. Worker calls AKIRA `/medios/radios?country=<resolved>&limit=200`
6. AKIRA SQL query filters by `media.country`, returns rows
7. Worker caches the response in `caches.default` keyed on `(country, offset, limit)`, TTL 15 min
8. Browser receives the slice, `RadiosExplorer` paginates on scroll

---

## Data layer (AKIRA SQLite)

### Schema migration

**Table rename** `argentine_media` → `media`:

```sql
ALTER TABLE argentine_media RENAME TO media;
```

**Add `country` column with NOT NULL DEFAULT** (SQLite ≥ 3.31 auto-fills existing rows):

```sql
ALTER TABLE media ADD COLUMN country TEXT NOT NULL DEFAULT 'AR';
```

The 1,181 existing rows become `country='AR'` automatically via the DEFAULT. No explicit UPDATE needed.

**Backwards-compat view** (queries that still reference `argentine_media` keep working):

```sql
CREATE VIEW argentine_media AS
  SELECT * FROM media WHERE country = 'AR';
```

Affected legacy callers (none expected to break, but listed for awareness):

- `packages/akira/core/coverage/__init__.py` — uses the table in many places
- `packages/akira/scripts/media/discover_via_citation.py` — joins on it
- `packages/akira/scripts/media/discover_radio_garden.py`
- `packages/akira/scripts/media/discover_via_municipal.py`

The view makes the rename transparent.

### New nullable columns

Added after the rename + `country` column, in the same migration:

```sql
ALTER TABLE media ADD COLUMN country_code TEXT;     -- ISO-3166-1 alpha-2 (mirrors country for new rows)
ALTER TABLE media ADD COLUMN language     TEXT;     -- 'es', 'pt', 'en', ...
ALTER TABLE media ADD COLUMN bitrate      TEXT;     -- '128', '64', ...
ALTER TABLE media ADD COLUMN codec        TEXT;     -- 'mp3', 'aac', ...
```

These remain nullable — populated by the import script, not required for existing rows.

### Indexes

```sql
CREATE INDEX IF NOT EXISTS idx_media_country        ON media(country);
CREATE INDEX IF NOT EXISTS idx_media_country_type   ON media(country, type);
CREATE INDEX IF NOT EXISTS idx_media_country_city   ON media(country, city);
```

### Import script

**New file** `packages/akira/scripts/media/import_random_radio_global.py`

Responsibilities:

1. Open `random-radio/crawler/data/skill_radio.db`
2. Pull rows where `stream_url IS NOT NULL AND stream_url != ''`
3. For each row, normalize city, match against `argentine_towns` (only for AR; non-AR rows store `codgl=NULL`)
4. Insert into `media` with `country` from the source row
5. Use `executemany` in batches of 500 to keep memory bounded
6. Deduplicate via existing `UNIQUE(name, city, type)` constraint — `INSERT OR IGNORE`
7. Source field: `'random-radio'` for AR (matches existing convention), `'random-radio-global'` for everyone else

The existing `import_random_radio.py` script is **deprecated** but kept for the `--reset` flag (clearing AR random-radio rows). The new script supersedes it.

CLI:

```bash
cd packages/akira && source .venv/bin/activate
python scripts/media/import_random_radio_global.py          # full import
python scripts/media/import_random_radio_global.py --reset  # drop all random-radio* rows first
python scripts/media/import_random_radio_global.py --dry-run # parse + count, no writes
```

Expected output:

```
random-radio: 25182 stations with stream_url
Imported (matched): 18742 (duplicates skipped: 1283)
Imported (unmatched, codgl=NULL): 5157
Elapsed: 412.3s

Coverage: 821/851 pueblos (96.5%)    -- AR only, unchanged
Total media: 26943
By type: {radio: 25182, diario: 1245, tv: 387, web: 129}
By country: {AR: 818, US: 3638, BR: 2328, ES: 1005, FR: 779, ...}
```

### Storage growth

Current DB size: ~80 MB (news_cards + clusters + media). After import: ~140 MB total. Comfortably under Cloudflare's notional limits for SQLite, well under the AKIRA server's disk.

---

## API layer

### AKIRA `GET /medios/radios`

Modified endpoint at `packages/akira/main.py:1725`.

New query params:

| Param    | Type   | Default | Description                                       |
|----------|--------|---------|---------------------------------------------------|
| `country`| string | (none)  | ISO-3166-1 alpha-2. If omitted, returns all AR.  |
| `limit`  | int    | 200     | Max rows. Hard cap 5000.                         |
| `offset` | int    | 0       | Pagination offset.                               |
| `codgl`  | string | (none)  | Unchanged. Filter to a specific pueblo.          |
| `province` | string | (none) | Unchanged. Filter to a specific province.       |

SQL:

```python
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
```

Response (unchanged shape, enriched fields):

```json
{
  "items": [
    {
      "id": 42,
      "name": "Radio Mitre",
      "stream_url": "https://...",
      "website": "https://radiomitre.cienradios.com",
      "city": "Buenos Aires",
      "province": "Buenos Aires",
      "country": "AR",
      "country_code": "AR",
      "language": "es",
      "bitrate": "128",
      "codec": "mp3",
      "codgl": "02000",
      "tags": "am,noticias",
      "type": "radio",
      "source": "random-radio"
    }
  ],
  "total": 818,
  "country": "AR",
  "offset": 0,
  "limit": 200
}
```

### Cloudflare Worker `GET /api/stats/radios`

Modified at `packages/api/src/routes/stats.ts:107`.

Country resolution logic:

```ts
function resolveCountry(c: Context): string {
  // 1. User override (cookie)
  const cookieCountry = getCookie(c.req.raw, 'antena_country');
  if (cookieCountry && /^[A-Z]{2}$/.test(cookieCountry)) {
    return cookieCountry;
  }
  // 2. Cloudflare geolocation
  const cf = c.req.header('cf-ipcountry')?.toUpperCase();
  if (cf && cf !== 'XX' && cf !== 'T1' && /^[A-Z]{2}$/.test(cf)) {
    return cf;
  }
  // 3. Safe fallback
  return 'AR';
}
```

Cache key now includes country and offset:

```ts
const cacheKey = new Request(
  `https://akira-api.miclusty.workers.dev/api/stats/radios?` +
  `country=${resolved}&offset=${offset}&limit=${limit}`
);
```

If `AKIRA_URL` returns 0 items (e.g., country with no radios), fall through to the D1 sources fallback AND try `country=AR` once. If `AR` also returns 0, return empty array (degenerate case — should not happen).

### New endpoint `GET /api/stats/radios/countries`

Lives in `packages/api/src/routes/stats.ts` next to `/radios`.

Returns the index used by the `CountrySelector` UI:

```ts
{
  countries: [
    { code: "AR", name: "Argentina",   flag: "🇦🇷", count: 818 },
    { code: "US", name: "Estados Unidos", flag: "🇺🇸", count: 3638 },
    { code: "BR", name: "Brasil",      flag: "🇧🇷", count: 2328 },
    ...
  ],
  detected: "AR",         // cf-ipcountry value (or fallback)
  override: null,         // cookie value (or null)
  total: 25182            // grand total across all countries
}
```

Implementation: AKIRA exposes `GET /medios/radios/countries` that returns the full `(country, count)` list (cheap aggregate query). Worker wraps it with the `detected`/`override` fields.

Cache: `caches.default` TTL 24h. Counts only change when the import script runs.

---

## Frontend layer (Antena)

### New module `src/lib/user-country.ts`

```ts
import { createSignal } from 'solid-js';

const LS_KEY = 'antena.radio.country';
const COOKIE = 'antena_country';

const [country, setCountry] = createSignal<string>('AR');
const [detectedCountry, setDetected] = createSignal<string | null>(null);
const [isOverride, setIsOverride] = createSignal(false);

export async function loadUserCountry(): Promise<string> {
  // 1. localStorage override wins immediately
  const ls = typeof localStorage !== 'undefined'
    ? localStorage.getItem(LS_KEY)
    : null;
  if (ls && /^[A-Z]{2}$/.test(ls)) {
    setCountry(ls);
    setIsOverride(true);
    return ls;
  }

  // 2. Ask the backend for detected + override
  try {
    const r = await fetch(`${API}/api/stats/radios/countries`);
    const data = await r.json();
    setDetected(data.detected);
    setCountry(data.override ?? data.detected ?? 'AR');
    setIsOverride(Boolean(data.override));
  } catch {
    // network failure — keep default 'AR'
  }
  return country();
}

export function setUserCountry(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return;
  localStorage.setItem(LS_KEY, code);
  document.cookie = `${COOKIE}=${code}; path=/; max-age=86400; SameSite=Lax`;
  setCountry(code);
  setIsOverride(true);
}

export function clearUserCountry() {
  localStorage.removeItem(LS_KEY);
  document.cookie = `${COOKIE}=; path=/; max-age=0`;
  setIsOverride(false);
  // caller should re-fetch detected
}

export { country, detectedCountry, isOverride };
```

### New component `src/components/radios/CountrySelector.tsx`

UI:

- Drawer / popover triggered from a button in `RadioPlayer` and `RadiosExplorer`
- Top: search input ("Buscar país…")
- List: 216 rows sorted by `count DESC`, each row: `🇦🇷 Argentina · 818 radios`
- Current country is highlighted with a checkmark
- On click: `setUserCountry(code)` + close + dispatch `antena:country-changed` event
- Below list: link "Restablecer detección automática" → `clearUserCountry()`

Static country list lives in `src/lib/countries.ts` (ISO-2 → name + flag). This avoids depending on the API just to render the selector UI.

```ts
// src/lib/countries.ts — abbreviated example
export const COUNTRIES: Record<string, { name: string; flag: string }> = {
  AR: { name: 'Argentina',       flag: '🇦🇷' },
  US: { name: 'Estados Unidos',  flag: '🇺🇸' },
  BR: { name: 'Brasil',          flag: '🇧🇷' },
  ES: { name: 'España',          flag: '🇪🇸' },
  // ... 213 more
};
```

The list is fetched from `worldcities.csv` (already in `random-radio/crawler/data/`) at build time. Script: `scripts/generate-countries.ts` runs in CI, output committed.

### `RadioPlayer.tsx` changes

Located at `packages/antena/src/components/common/RadioPlayer.tsx`.

- On mount: `await loadUserCountry()` then `loadRadios()` (passing `?country=...`)
- Header line: `🇦🇷 Tocá para elegir radio · Buenos Aires` becomes `🇦🇷 Argentina · Tocá para elegir radio`
- New button **"Cambiar país"** next to the favorite star
- On `antena:country-changed` event: refetch radios with the new country; pause current playback (do not auto-play — respect browser autoplay policy)
- `currentCityRadios` memo filters from the current country slice

### `RadiosExplorer.tsx` changes

Located at `packages/antena/src/components/radios/RadiosExplorer.tsx`.

- Receives `initialCountry` prop from the page (from SSR `Astro.locals` or `null` to force client fetch)
- All fetches append `&country=${currentCountry()}`
- Header counter: `1.432 radios de 🇦🇷 Argentina` (vs. flat `818` today)
- Province / city filters still work, now scoped within the country

### `pages/radios.astro` changes

Located at `packages/antena/src/pages/radios.astro`.

- The Astro SSR pass no longer tries to fetch the full list (it doesn't know the country at build time)
- `RadiosExplorer` receives `radios={[]}` as the initial prop
- Page meta (title, description, JSON-LD) still renders server-side with hard-coded counts and the country's generic copy
- Real radios load client-side via the `?country=` flow

---

## Edge cases

| Case | Behavior |
|------|----------|
| `cf-ipcountry == "XX"` or `"T1"` (Cloudflare: IP unknown) | Fallback to `AR`, log `console.warn('[radio] unknown country, defaulting AR')` |
| Country with 0 radios (e.g., user from Liechtenstein `LI`) | Show toast `No hay radios para 🇱🇮 Liechtenstein. Mostrando 🇦🇷 Argentina.` + load AR |
| `stream_url` 404 / no response on play | Existing: `RadioPlayer.setError('Stream no disponible. Probá otra radio.')` (line 321) |
| Override cookie expired / invalid | Reset to `cf-ipcountry`, delete the cookie |
| Two browser tabs with different countries | Each tab is independent (localStorage doesn't sync across tabs). Acceptable. |
| Country change while playing | Pause current stream; do not auto-play the first radio of the new country |
| Browser back / forward | Country lives in localStorage + cookie, **not in URL**. Deliberate: avoids SEO fragmentation of `/radios`. Revisit if analytics show shareable URLs are needed. |
| Streaming CORS (HLS/MP3 cross-origin) | Already handled: no `crossorigin` attribute (line 309) |
| First load with no network | Extend existing error message: `'No se pudieron cargar las radios. Revisá tu conexión.'` |

---

## Migration plan

**Phase 0 — Pre-flight (10 min)**
- Run `pnpm typecheck && pnpm lint && pnpm test` to confirm clean baseline
- `cp packages/akira/data/akira.db packages/akira/data/akira.db.bak.$(date +%s)`

**Phase 1 — Local schema migration (5 min)**
- Apply all ALTERs in a single SQLite CLI session on `packages/akira/data/akira.db`:
  ```sql
  ALTER TABLE argentine_media RENAME TO media;
  ALTER TABLE media ADD COLUMN country      TEXT NOT NULL DEFAULT 'AR';
  ALTER TABLE media ADD COLUMN country_code TEXT;
  ALTER TABLE media ADD COLUMN language     TEXT;
  ALTER TABLE media ADD COLUMN bitrate      TEXT;
  ALTER TABLE media ADD COLUMN codec        TEXT;
  CREATE VIEW argentine_media AS SELECT * FROM media WHERE country = 'AR';
  CREATE INDEX idx_media_country      ON media(country);
  CREATE INDEX idx_media_country_type ON media(country, type);
  CREATE INDEX idx_media_country_city ON media(country, city);
  ```
- Verify: `SELECT COUNT(*) FROM media;` returns 1181; `SELECT COUNT(*) FROM argentine_media;` returns 1181; `SELECT COUNT(*) FROM media WHERE country='AR';` returns 1181

**Phase 2 — Import 25k radios (5–10 min)**
- `cd packages/akira && source .venv/bin/activate`
- `python scripts/media/import_random_radio_global.py`
- Verify: `SELECT country, COUNT(*) FROM media WHERE type='radio' GROUP BY country ORDER BY COUNT(*) DESC LIMIT 5;` shows AR 818, US 3638, BR 2328, ES 1005, FR 779

**Phase 3 — AKIRA endpoint update (15 min)**
- Modify `main.py:1725` to accept `?country=` and `?offset=`
- Smoke test: `curl localhost:5100/medios/radios?country=US&limit=5`

**Phase 4 — API Worker update (20 min)**
- Modify `routes/stats.ts` for country resolution + cookie
- Add `routes/stats.ts:/radios/countries` endpoint
- Verify cache: two requests with different countries → two cache keys

**Phase 5 — Frontend (40 min)**
- New `src/lib/user-country.ts`
- New `src/lib/countries.ts` + `scripts/generate-countries.ts`
- New `src/components/radios/CountrySelector.tsx`
- Modify `RadioPlayer.tsx`
- Modify `RadiosExplorer.tsx`
- Modify `pages/radios.astro`

**Phase 6 — Verification (20 min)**
- `pnpm typecheck && pnpm lint && pnpm test`
- Dev local: open `http://localhost:4321/radios`, verify default AR radios show
- Dev local: `document.cookie = 'antena_country=CL'` then reload → CL radios show
- Dev local: `localStorage.removeItem('antena.radio.country')` → back to AR

**Phase 7 — Deploy (10 min)**
- `pnpm deploy:staging` → smoke test on staging URL
- `cd packages/api && wrangler deploy --env=staging` → smoke test
- Verify AKIRA receives real traffic, p99 < 500ms
- `pnpm deploy:prod` + `wrangler deploy --env=production`

**Total: ~2.5 hours**

---

## Testing

### Unit tests (AKIRA)

`packages/akira/tests/test_import_random_radio_global.py`:

- Imports a 5-country sample correctly (mock DB)
- Dedupes via `UNIQUE(name, city, type)` on re-run
- Skips rows with NULL `stream_url`
- Assigns `country_code` from country name when missing

### Unit tests (API)

`packages/api/tests/test_stats_radios_country.ts`:

- No `cf-ipcountry` header → fallback `AR`
- `cf-ipcountry=BR` + no cookie → returns BR
- `cf-ipcountry=BR` + cookie `antena_country=CL` → returns CL (override wins)
- `cf-ipcountry=XX` → fallback `AR`
- `cf-ipcountry=LI` (0 radios) → fallback to AR with a header note

`packages/api/tests/test_stats_radios_countries.ts`:

- Returns list sorted by `count DESC`
- Includes flag emoji + ISO code
- Cache hit on second call (TTL respected)

### Frontend tests (Antena)

`packages/antena/src/tests/user-country.test.ts`:

- localStorage has priority over fetch
- `setUserCountry('CL')` writes localStorage + cookie
- Without localStorage or fetch → defaults to `AR`

`packages/antena/src/tests/CountrySelector.test.tsx`:

- Renders list with flags
- Filters by name when typing
- onClick → `setUserCountry` + closes drawer

### E2E (Playwright)

`packages/antena/tests/e2e/radios-country.spec.ts`:

- Load `/radios` → sees AR radios (default)
- Click "Cambiar país" → drawer opens
- Click "🇧🇷 Brasil" → explorer reloads with BR radios
- Reload page → override persists (BR still selected)

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Import takes >15 min, blocks deploy | Medium | Low | `--dry-run` flag; AKIRA serves AR-only in the meantime |
| SQLite DB grows >500 MB | Low | Medium | Indexes cover queries; add `VACUUM` to `/__cron/refresh` |
| `cf-ipcountry` inaccurate (VPN, datacenter) | High | Low | Manual override is available and persisted |
| D1 schema drift if mirrored later | Low | Low | Drizzle schema updated in this PR even though D1 isn't populated |
| Dead `stream_url` rows | High | Low | Player's existing error handler; future health-check pass |
| Lighthouse score drops from extra bundle | Low | Medium | `CountrySelector` lazy-loaded (`<Show when={open()}>`); static country list is ~8 KB |

---

## Out of scope (YAGNI)

- Geolocation via `navigator.geolocation`
- UI i18n / language switcher
- Cross-device sync of country override (no auth system)
- Stream health checks (AKIRA has `availability_checks` table — separate future task)
- Mirror to D1 (decided: AKIRA SQLite is source of truth)
- Bitrate / codec / genre filters in the UI (data stored, not exposed)
- Non-emoji flag fallback (use 🌍 for unknown ISO codes)

---

## Related specs

- [macOS Media Session](./2026-06-18-macos-media-session-design.md) — separate spec for keyboard / media-key integration
- `docs/architecture.md` — overall data flow (no changes needed)
- `docs/schema.md` — Drizzle schema reference (will need `media` table sync, even though D1 isn't populated yet)

---

## Open questions

_None at design time. All blocking decisions resolved during brainstorming 2026-06-18._
