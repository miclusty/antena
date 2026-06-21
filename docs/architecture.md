# Architecture

End-to-end architecture for Antena. The system is 100% edge-native: every request that reaches a user is served from Cloudflare's edge, with the only serverful component being the Python extraction engine (AKIRA) running on a VM.

## System Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         AKIRA (Python — VM)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ RSS         │  │ WordPress   │  │ Newspaper   │  │ Goose       │    │
│  │ extractor   │  │ extractor   │  │ extractor   │  │ extractor   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Sitemap     │  │ Playwright  │  │ Jina        │  │ Video       │    │
│  │ extractor   │  │ extractor   │  │ extractor   │  │ extractor   │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│  ┌─────────────┐  ┌─────────────┐                                         │
│  │ Social      │  │ Google News │  →  SQLite (akira.db)                  │
│  │ extractor   │  │ extractor   │     + synthesis + clustering           │
│  └─────────────┘  └─────────────┘                                         │
│                                                                          │
│  Hermes skills (8) ──────────────────────────────────────────┐          │
│  scout, harvester, analyst, cleaner, publisher, supervisor, │          │
│  smart-harvester, d1-harvest                                 │          │
└─────────────────────────────────────────────────────────────│──────────┘
                                                              │
                                          cron / manual ingest│
                                                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       Cloudflare Edge (100%)                             │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐      │
│  │ Pages: Antena (Astro 5 + Solid.js + Tailwind 4)                │      │
│  │   /              — feed (Para vos / Siguiendo / Explorar)      │      │
│  │   /noticia/{id}  — article SSR via Pages Function             │      │
│  │   /buscar        — search (Pages Function)                    │      │
│  │   PWA: SW, offline fallback, installable                      │      │
│  └────────────────────────────────────────────────────────────────┘      │
│           │                       │                                       │
│           │ TanStack Query        │ Pages Functions                      │
│           │ (client cache)        │ (SSR for /noticia, /api/track)       │
│           ▼                       ▼                                       │
│  ┌────────────────────────────────────────────────────────────────┐      │
│  │ Workers: API (Hono)                                            │      │
│  │   /api/news/feed, /api/news/:id, /api/news/:id/cluster        │      │
│  │   /api/locations/tree, /api/categories, /api/sources          │      │
│  │   /api/img/:hash  (R2 + Image Resizing)                       │      │
│  │   /api/search    (D1 FTS5 + Vectorize)                         │      │
│  │   /api/track     (Analytics Engine writeDataPoint)             │      │
│  │   /__cron/refresh (Vectorize rebuild, GC, health)              │      │
│  │                                                                │      │
│  │   Bindings: D1, KV, R2, Vectorize, Analytics, Queues, AI       │      │
│  └────────────────────────────────────────────────────────────────┘      │
│       │        │        │        │         │          │                  │
│       ▼        ▼        ▼        ▼         ▼          ▼                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐ ┌────────┐ ┌───────┐         │
│  │  D1  │ │  KV  │ │  R2  │ │Vectorize │ │Analytics│ │Queues │         │
│  │      │ │CACHE │ │images│ │embeddings│ │Engine   │ │image- │         │
│  │news_ │ │+SES- │ │      │ │          │ │feed_    │ │pipeline│         │
│  │cards │ │SION  │ │      │ │          │ │events   │ │        │         │
│  └──────┘ └──────┘ └──────┘ └──────────┘ └────────┘ └───────┘         │
└──────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Read path (feed load)

```
1. Browser → Antena SSR
2. Antena → GET /api/news/feed?location_id=…&category=…
3. Worker → Zod validates params
4. Worker → caches.default.match(request)  ──── hit ───→ return cached
                                          ──── miss ──→ query D1
5. Worker → DB.prepare(SELECT … FROM news_cards WHERE …)
6. Worker → caches.default.put(request, response, { ttl: 60, swr: 300 })
7. Worker → 200 JSON to Antena
8. Antena → TanStack Query caches for 30s client-side
9. Antena → Service Worker also caches HTML shell + JS bundle
10. Browser renders feed (top tabs, infinite scroll, haptics)
```

### Read path (article SSR)

```
1. Browser → /noticia/{id}
2. Astro SSR → calls Pages Function /api/noticia/{id}
3. Pages Function → Worker route /api/news/{id}
4. Worker → D1 single-row read (cache hit = return cached)
5. Worker → cache miss path: returns 200 with card
6. Astro renders the article (cluster, fuentes, bias, share, save)
7. Browser hydrates Solid.js
8. Browser fires POST /api/track with read event
9. Worker → Analytics Engine writeDataPoint (dwell time, scroll depth)
```

### Write path (image pipeline)

```
1. AKIRA ingest (cron / Hermes skill) → POST /api/ingest with news_cards
2. Worker → D1 upsert; emits message to image-pipeline queue
3. Queue consumer (image-pipeline.ts) → fetch source image, optimize, upload to R2
4. Consumer → emits "image_stored" event to Analytics Engine
5. On next feed load, /api/img/:hash?w=…&fmt=avif → R2 hit, Image Resizing transforms
```

### Write path (refresh / GC)

```
Cron Trigger every 2h → /__cron/refresh
  1. Vectorize rebuild (re-embed recent news via Workers AI)
  2. D1 GC: drop news > 90 days, dedupe, vacuum
  3. Analytics Engine: emit health event
  4. R2: drop orphaned images (no D1 reference)
```

## Caching Layers

The system has **5 layers of cache** between a user's read and a fresh DB hit:

| Layer | TTL | Hit rate target | Purpose |
|-------|-----|-----------------|---------|
| **1. Service Worker (PWA)** | 7 days | 80% | Offline-first, app shell + last feed |
| **2. Browser (TanStack Query)** | 30s | 60% | Avoid re-fetch on tab focus, infinite scroll pagination |
| **3. Edge cache (`caches.default`)** | 60s | 90% | Hot-path D1 reads (feed, locations, categories) |
| **4. SWR (`stale-while-revalidate`)** | 5 min | 99% | Serve stale + revalidate in background |
| **5. Cloudflare KV (`CACHE`)** | 1 hour | — | Cross-region persistent cache for low-cardinality reads |
| **6. D1** | — | — | Source of truth |

When a request hits the Worker:
1. Check `caches.default` (edge cache) → fast
2. Miss → check KV → medium
3. Miss → query D1 → slow
4. Write back to `caches.default` and KV

L1 + L3 = effectively <50ms p50 for feed loads.

## Routing

Antena uses **file-based routing** via Astro 5:

```
src/pages/
├── index.astro              # /            (feed)
├── noticia/
│   └── [id].astro           # /noticia/:id (article SSR)
└── buscar.astro              # /buscar      (search)
```

Pages Functions (SSR endpoints) live next to pages:

```
src/functions/api/
├── search.ts                 # /api/search
└── track.ts                  # /api/track
```

API Worker (Hono) routes are in `packages/api/src/routes/`:

```
news.ts        → /api/news/feed, /api/news/:id, /api/news/:id/cluster
locations.ts   → /api/locations/tree
categories.ts  → /api/categories
sources.ts     → /api/sources
image.ts       → /api/img/:hash
search.ts      → /api/search
track.ts       → /api/track
stats.ts       → /api/stats/health
synthesis.ts   → /cluster/:id/synthesize, /synthesis/master/:id
ingest.ts      → /api/ingest (Hermes skill write)
health.ts      → /health, /health/detailed
crons/refresh.ts → /__cron/refresh
queues/image-pipeline.ts → image-pipeline consumer
```

### AKIRA module structure

AKIRA's Python codebase uses a **flat layout** (modules live directly in `packages/akira/`, no `akira/` subdirectory). This keeps import paths stable without requiring `pip install -e .` for local dev. The 1954-line `main.py` was split into focused modules in iter 1.3:

```
packages/akira/
├── main.py                   # 62-line shim: CORS + 9 include_router() calls
├── config.py                 # Settings (env_prefix="AKIRA_")
├── conftest.py               # pytest fixture: sets AKIRA_DB_PATH before any import
├── core/
│   ├── app_setup.py          # lifespan, GC loop, build_app(), check_admin()
│   ├── engine.py             # ExtractionEngine (orchestrates 10 extractors)
│   ├── cache.py              # MemoryBackend + CacheManager
│   ├── cache_redis.py        # optional RedisBackend (if redis is installed)
│   ├── llm_client.py         # unified LM Studio + MiniMax client
│   ├── metrics.py            # Prometheus-format counters
│   ├── rate_limiter.py       # 1.5s delay per domain
│   ├── circuit_breaker.py    # 5+ failures pauses a source
│   ├── garbage_collector.py  # cleanup stale news + seen_urls
│   ├── synthesis.py          # MiniMax synthesis engine (master articles)
│   ├── clustering.py         # title-similarity clustering
│   ├── method_learner.py     # per-URL method success tracking
│   ├── method_scorer.py      # scoring table for method selection
│   ├── source_recovery.py    # auto-retry failed sources
│   └── health_monitor.py     # /health/detailed aggregator
├── routes/                   # 9 FastAPI routers, 44 endpoints
│   ├── feed.py               # /api/news/feed, /blindspot, /{id}, /{id}/cluster
│   ├── categories.py         # /api/categories
│   ├── locations.py          # /api/locations, /api/locations/tree
│   ├── sources.py            # /api/sources, /api/sources/{id}/profile
│   ├── radios.py             # /medios/radios
│   ├── extraction.py         # /, /health, /health/detailed, /extract, /extract/google-news/*
│   ├── synthesis.py          # /cluster/*, /synthesis/*
│   ├── admin.py              # /admin/* + /metrics + dashboards (15 endpoints)
│   └── stats.py              # /api/stats/health
├── services/                 # business logic shared across routes
│   ├── source_resolver.py    # batch-resolve source names + URLs + bias
│   ├── feed_service.py       # format_news_card + format_news_cards_batch
│   └── google_news_service.py # Google News ingestion
├── db/
│   └── connection.py         # canonical get_db_connection() with WAL + mmap
├── extractors/               # 10 extractor classes (RSS, WP, Newspaper, etc.)
├── models/                   # pydantic schemas (request/response models)
└── scripts/                  # one-shot scripts (most DEPRECATED — see scripts/DEPRECATED.md)
```

**Route registration order** in `main.py` matters because FastAPI matches wildcards. The feed router registers `/api/news/feed` BEFORE `/api/news/{news_id}` — reversing the order causes `/api/news/feed` to match the wildcard and return a 404-shaped payload.

**Admin auth**: 15 admin endpoints require an `X-Admin-Key` header matching `AKIRA_ADMIN_KEY` env var. The check fires in `check_admin()` dependency before endpoint logic. `/metrics` and `/synthesis/master/{id}` are intentionally public (Prometheus scrape target + read-only master article fetch).

**AKIRA tests**: 196 cases in `packages/akira/tests/`, run via `pytest`. CI runs them on every PR via the `test-akira` job in `.github/workflows/ci.yml`. Test isolation uses a temp `AKIRA_DB_PATH` set in `conftest.py` at package root (the `config.settings` singleton freezes `db_path` at first import, so env vars must be set BEFORE `main` is imported).

## State Management

**Client-side** (Antena):

- **Solid signals** for local UI state (active tab, modal open, scroll position)
- **TanStack Query** for server cache (feed, article, search, bookmarks)
- **IndexedDB** (`src/lib/db.ts`) for offline cache and bookmarks sync
- **localStorage** for user prefs (theme, location)

**Server-side** (API Worker):

- **Stateless** — no session storage between requests (except `SESSION` KV for Astro sessions)
- **Bindings** are the only state (D1, KV, R2, etc.)
- **caches.default** is shared across all instances of the Worker

## Security

| Concern | Mitigation |
|---------|-----------|
| Bots / scraping | Cloudflare Turnstile on ingest + share endpoints |
| Injection | Zod validation on all API inputs (`packages/api/src/lib/schemas.ts`) |
| PII leak | No PII is collected or stored. Analytics events have no user ID, only `newsId`. |
| Auth secrets | Never in `wrangler.toml` — only in `.dev.vars` (local) or `wrangler secret put` (prod) |
| CORS | Workers serve from `*.antena.com.ar` and `api.antena.com.ar`; CORS headers set in `index.ts` |
| OWASP | All inputs validated, all outputs stringified, no `innerHTML` writes, CSP via `_headers` |
| Rate limiting | Per-IP throttling on `/api/track` and `/api/ingest` |
| DDoS | Cloudflare's network-level protection (no extra work) |
| Source reputation | Sources have a bias score + reputation tier in D1; cluster view shows all sources |
| Content security | `Content-Security-Policy` header on Antena `_headers` (no `unsafe-inline`) |

## Performance Budgets

| Metric | Target | Measured |
|--------|--------|----------|
| LCP (mobile 4G) | < 2.5s | 1.8s |
| INP | < 200ms | 110ms |
| CLS | < 0.1 | 0.02 |
| TBT | < 200ms | 90ms |
| Bundle size (initial) | < 100 KB gzip | 78 KB |
| Feed load (cold) | < 500ms p50 | 320ms |
| Feed load (warm cache) | < 50ms p50 | 28ms |
| Lighthouse Perf | > 90 | 96 |
| Lighthouse A11y | > 95 | 98 |
| Lighthouse BP | > 95 | 100 |
| Lighthouse SEO | > 95 | 100 |

## Tech Decisions

- **D1 over Postgres**: Edge-native, zero ops, $0 at our scale. Postgres is faster per-query but requires a region, a connection pool, and a managed service. Edge wins for read-heavy mobile.
- **R2 over S3**: Same S3 API, zero egress fees. Critical for a media-heavy app.
- **Vectorize over Algolia**: Built-in, no extra vendor, integrates with Workers AI for embeddings.
- **Analytics Engine over GA**: Privacy-first (no cookies, no PII), write-only via `writeDataPoint`, SQL-queryable.
- **Hono over Express**: Tiny, Workers-native, great TypeScript inference.
- **Astro over Next.js**: Static-first means 100% of the bundle is pre-rendered. SSR only for `/noticia/:id`. Edge-rendered React via Solid.js is faster than Next.js for this use case.
- **Solid over React**: Fine-grained reactivity, no virtual DOM, smaller bundle.
- **Tailwind 4 over 3**: CSS-first config, no `tailwind.config.js`, faster builds.
- **Drizzle over raw SQL or Prisma**: Type-safe, no codegen, runs in Workers (Prisma's binary engine doesn't).

## Related

- [docs/api.md](api.md) — Endpoint reference
- [docs/cloudflare-setup.md](cloudflare-setup.md) — Provisioning
- [docs/deploy.md](deploy.md) — Deployment
- [docs/schema.md](schema.md) — Database schema
