# AKIRA / Antena — Developer Reference

Cloudflare 100% edge-native news platform. Mobile-first Reddit/X.com-style feed, extraction engine on the edge, D1 database, R2 images, Vectorize search, Analytics Engine telemetry.

## Quick Start

```bash
pnpm install
cp .env.example .env

# AKIRA (Python — activate venv FIRST)
cd packages/akira && source .venv/bin/activate
python -m uvicorn main:app --host 0.0.0.0 --port 5000

# API (Cloudflare Workers via wrangler dev)
cd packages/api && pnpm dev   # port 8787

# Antena (Astro frontend)
cd packages/antena && pnpm dev   # port 4321
```

## Architecture

- **AKIRA** (port 5000): Python/FastAPI — 10 extractors, synthesis, clustering, circuit breaker, rate limiter, GarbageCollector
- **API** (port 8787): Node/Hono via `wrangler dev` — Cloudflare Workers, mounts D1, KV, R2, Vectorize, Analytics Engine, Queues, Cron Triggers
- **Antena** (port 4321): Astro 5 + Solid.js + Tailwind 4 — static output, PWA via VitePWA, Pages Functions for SSR

```
AKIRA → extracts from RSS, WP, Newspaper, Goose, Sitemap, Playwright, Jina, Video, Social, GoogleNews
   ↓
API  → serves news_cards, locations, categories, clusters, search, image pipeline, tracking
   ↓
Antena → reads API, infinite-scroll feed, top tabs + bottom nav, article SSR via /noticia/[id]
```

## Stack (Cloudflare 100%)

| Service | Use |
|--------|-----|
| Pages | Static hosting for Antena (`packages/antena/dist`) |
| Workers | API backend (Hono), Pages Functions for SSR |
| D1 | `news_cards`, `clusters`, `master_articles`, `sources`, `locations`, `categories` (Drizzle ORM) |
| KV | `CACHE` (edge cache), `SESSION` (Astro sessions) |
| R2 | `antena-images` bucket — news images |
| Image Resizing | On-the-fly AVIF/WebP/JPEG from R2 |
| Vectorize | `news_embeddings` — 384-dim cosine semantic search |
| Analytics Engine | `feed_events` — read events, web vitals, dwell time |
| Queues | `image-pipeline` — async R2 ingestion |
| Cron Triggers | `/__cron/refresh` — every 2 hours |
| Workers AI | Available (embeddings for Vectorize) |

## Endpoints

```
GET  /api/news/feed                    # Public feed (?category=&location_id=&limit=&offset=)
GET  /api/news/{id}                    # Single card
GET  /api/news/{id}/cluster            # All cards in same cluster
GET  /api/locations/tree               # Location hierarchy
GET  /api/categories                   # Categories with icons
GET  /api/sources                      # Active sources with bias
GET  /api/img/{hash}?w=&fmt=&fit=      # Image pipeline (R2 + Image Resizing)
GET  /api/search?q=                    # Search (FTS5 + Vectorize hybrid)
POST /api/track                        # Analytics beacon (Analytics Engine)
GET  /api/stats/health                 # Pipeline stats
POST /cluster/{id}/synthesize          # Neutral master article
GET  /synthesis/master/{id}            # Get master article
GET  /metrics                          # Prometheus
GET  /__cron/refresh                   # Cron trigger (refresh Vectorize, GC, health)
```

Frontend routes:

```
/                  # Feed (Para vos / Siguiendo / Explorar tabs)
/noticia/{id}      # Article detail (Pages Function SSR)
/buscar            # Search
```

## Directory Structure

```
packages/
├── akira/                          # Python/FastAPI extraction engine
│   ├── core/                       # engine, cache, circuit_breaker, synthesis, clustering
│   ├── extractors/                 # 10 extractor classes
│   ├── skills/                     # 8 Hermes skills
│   ├── tests/                      # 15 pytest files
│   ├── models/                     # schemas
│   └── main.py                     # ~40 endpoints
├── api/                            # Node/Hono Cloudflare Worker
│   ├── src/
│   │   ├── routes/                 # news, locations, categories, image, search, track, …
│   │   ├── db/                     # Drizzle schema + migrations
│   │   ├── lib/                    # types, schemas, cache, types
│   │   ├── queues/                 # image-pipeline consumer
│   │   └── crons/                  # refresh handler
│   ├── drizzle.config.ts
│   ├── migrations/                 # Versioned SQL
│   ├── wrangler.toml               # dev/staging/production envs
│   ├── wrangler.staging.toml
│   └── wrangler.production.toml
└── antena/                         # Astro 5 + Solid.js + Tailwind 4
    ├── src/
    │   ├── components/             # common, article, layout, search, menu
    │   ├── lib/                    # api, mappers, image, cache, search, analytics, cloudflare, …
    │   ├── pages/                  # index.astro, noticia/[id].astro
    │   └── functions/api/          # Pages Functions: search.ts, track.ts
    ├── wrangler.toml               # Pages bindings
    └── astro.config.mjs
```

## Key Commands

```bash
# Root
pnpm install
pnpm typecheck         # api + antena
pnpm lint              # api + antena
pnpm test              # vitest (api + antena unit)
pnpm test:e2e          # Playwright (antena)
pnpm lighthouse        # @lhci/cli autorun

# AKIRA tests
cd packages/akira && source .venv/bin/activate && python -m pytest

# Drizzle migrations
cd packages/api && pnpm drizzle-kit generate
cd packages/api && wrangler d1 migrations apply DB --env=production --remote

# Deploy
pnpm deploy:staging    # Pages preview branch
pnpm deploy:prod       # Pages main branch
cd packages/api && wrangler deploy --env=production

# PM2 production
pm2 start ecosystem.config.cjs

# DB stats (local SQLite)
sqlite3 packages/akira/data/akira.db "SELECT COUNT(*) FROM news_cards;"
```

## Drizzle Migrations

```bash
# 1. Edit schema in packages/api/src/db/schema.ts
# 2. Generate migration SQL
cd packages/api && pnpm drizzle-kit generate
# 3. Review the generated SQL in packages/api/migrations/
# 4. Apply locally
wrangler d1 migrations apply DB --local
# 5. Apply to production
wrangler d1 migrations apply DB --env=production --remote
```

## Critical Conventions

- **Python venv**: always `source .venv/bin/activate` before running Python commands in `packages/akira/`
- **pnpm workspace**: run `pnpm install` from root, never npm
- **AKIRA env prefix**: all akira settings use `AKIRA_` prefix (pydantic-settings, `model_config = {"env_prefix": "AKIRA_"}`)
- **SQLite WAL mode**: enabled in `main.py:get_db_connection()` — concurrent reads + PRAGMA optimizations
- **Rate limiter**: 1.5s delay between requests to same domain (`config.py:request_delay`)
- **Circuit breaker**: 5+ consecutive failures pauses a source (`config.py:circuit_breaker_threshold`)
- **Extractors are classes** (not functions) with `NAME` and `PRIORITY` class attributes
- **10 extractors cascade order** (main.py lifespan): RSS → WP → Newspaper → Goose → Sitemap → Playwright → Jina → Video → Social → GoogleNews
- **Batch source resolution**: `_batch_resolve_sources()` does single-query lookup
- **URL dedup**: `filter_new_urls()` in `core/db_helpers.py` is shared by rss.py, wordpress.py, engine.py
- **Zod validation**: every API route validates input with Zod schemas in `packages/api/src/lib/schemas.ts`
- **Cache strategy**: `withCache()` wrapper uses `caches.default` with TTL + SWR; never write to cache on errors
- **R2 image hash**: `sha256(url)` is the canonical key — `c.env.IMAGES.get(hash)`
- **Tailwind 4**: CSS-first `@theme` in `src/lib/design-tokens.css` (no `tailwind.config.js`)
- **Solid signals + TanStack Query**: signals for local UI state, TanStack Query for server cache

## Environment Files

| File | Purpose |
|------|---------|
| `packages/akira/.env` | AKIRA_ prefixed vars (pydantic-settings) |
| `packages/api/.dev.vars` | Cloudflare Workers local secrets |
| `packages/antena/.dev.vars` | Pages local secrets |
| `~/.hermes/.env` | `MINIMAX_API_KEY`, `AKIRA_DB`, `AKIRA_API` for Hermes skills |
| `.env.example` | Root template with all vars |

## MiniMax API

- **Endpoint**: `https://api.minimax.io/v1/text/chatcompletion_v2`
- **Model**: `MiniMax-M2.7`
- **Hardcoded in**: `packages/akira/core/synthesis.py:378-385`
- **Env var**: `MINIMAX_API_KEY` (also in `~/.hermes/.env` for Hermes skills)

## Reference

- [README.md](README.md) — Quickstart + project description
- [docs/architecture.md](docs/architecture.md) — System diagram, data flow, caching layers
- [docs/api.md](docs/api.md) — API endpoints, bindings, schemas
- [docs/deploy.md](docs/deploy.md) — Deploy guide, environments, CI/CD
- [docs/cloudflare-setup.md](docs/cloudflare-setup.md) — One-time Cloudflare provisioning
- [docs/schema.md](docs/schema.md) — Database schema reference
- [docs/archived/TODO.md](docs/archived/TODO.md) — Historical improvement plan
- [docs/archived/webllm-experiment.md](docs/archived/webllm-experiment.md) — Why WebLLM was dropped
