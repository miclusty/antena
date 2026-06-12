# API Reference

The Antena API runs as a Cloudflare Worker (Hono). All endpoints are edge-cached via `caches.default` and use Drizzle + Zod for type-safe, validated reads.

- **Base URL (production)**: `https://api.antena.com.ar`
- **Base URL (preview)**: `https://antena-api.<branch>.workers.dev`
- **Base URL (local)**: `http://localhost:8787`

## Bindings

Declared in `packages/api/src/lib/types.ts` and configured in `wrangler.toml`:

| Binding | Type | Purpose |
|---------|------|---------|
| `DB` | D1Database | All `news_cards`, `clusters`, `master_articles`, `sources`, `locations`, `categories` reads |
| `CACHE` | KVNamespace | Edge cache for low-cardinality reads (locations tree, categories list) |
| `IMAGES` | R2Bucket | News image storage; accessed via `c.env.IMAGES.get(hash)` |
| `VECTORS` | VectorizeIndex | 384-dim cosine semantic search index (`news_embeddings`) |
| `ANALYTICS` | AnalyticsEngineDataset | `feed_events` — read events, dwell time, scroll depth |
| `IMAGE_QUEUE` | Queue | `image-pipeline` async consumer (fetch → optimize → R2) |
| `AI` | Ai | Workers AI binding (embeddings, future summarization) |
| `ENVIRONMENT` | string | `"development" \| "staging" \| "production"` |
| `API_KEY` | secret | Optional; required on `/api/ingest` |
| `PULSO_API_KEY` | secret | Optional; required on `/api/ingest/pulso` |
| `MINIMAX_API_KEY` | secret | Required on `/cluster/:id/synthesize` |
| `AKIRA_URL` | string | URL of the Python extraction engine (for fallback) |

Env vars are read via `[vars]` in `wrangler.toml`. Secrets are set with `wrangler secret put <NAME>` (never committed).

## Endpoints

### Public read API

#### `GET /api/news/feed`

Paginated news feed. **Edge-cached** (TTL 60s, SWR 5 min).

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `location_id` | int | — | Filter to a specific location |
| `category` | string | — | Filter by category slug |
| `limit` | int | 20 | 1–100 |
| `offset` | int | 0 | — |
| `bias` | enum | `all` | `all \| left \| right \| neutral` |
| `time` | enum | `all` | `hour \| today \| week \| all` |
| `min_quality` | float | — | 0–1, minimum source reliability |

Response (`FeedResponse`):

```json
{
  "news": [
    {
      "id": "abc123",
      "title": "Título de la noticia",
      "summary": "Resumen…",
      "image_url": "https://api.antena.com.ar/api/img/abc…?w=800&fmt=avif",
      "source_name": "La Voz",
      "source_ids": "12,34",
      "category": "política",
      "location_id": 1234,
      "location_name": "Córdoba",
      "bias_score": -0.42,
      "is_gacetilla": 0,
      "cluster_id": "cluster-xyz",
      "published_at": "2026-06-11T14:00:00Z",
      "created_at": "2026-06-11T14:05:00Z"
    }
  ],
  "location": null,
  "category": "política",
  "total": 1247,
  "page": 1,
  "per_page": 20
}
```

#### `GET /api/news/:id`

Single card. **Edge-cached** (TTL 5 min, SWR 1 h).

Response: `NewsCard` (same shape as feed item). `404` if not found.

#### `GET /api/news/:id/cluster`

All cards in the same cluster (the same story covered by multiple sources). **Edge-cached** (TTL 5 min).

Response:

```json
{
  "cluster_id": "cluster-xyz",
  "news": [/* NewsCard[] — original plus all duplicates across sources */]
}
```

#### `GET /api/locations/tree`

Hierarchy of locations (pais → provincia → departamento → ciudad). **Edge-cached** (TTL 1 h).

#### `GET /api/categories`

List of categories with icons. **Edge-cached** (TTL 1 h).

#### `GET /api/sources`

Active sources with bias score, reliability score, location.

#### `GET /api/img/:hash?w=&fmt=&fit=`

Image pipeline. **Edge-cached** (TTL 7 days, SWR 1 day).

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `w` | int | — | Width in px (50–2000) |
| `fmt` | enum | auto | `avif \| webp \| jpg` (Content Negotiation) |
| `fit` | enum | `cover` | `cover \| contain` |

Behavior:
1. `c.env.IMAGES.get(hash)` — R2 lookup
2. Hit → return Image Resizing transform of the R2 object via `fetch(r2Url, { cf: { image: … } })`
3. Miss → enqueue `fetch_and_store` message on `IMAGE_QUEUE`; return `404` with `{ error: "Image not yet available", hash }`

This is the only way Antena loads images: every `<img>` uses `https://api.antena.com.ar/api/img/<sha256(url)>` and Cloudflare Image Resizing handles the transform on the edge.

#### `GET /api/search?q=&limit=`

Hybrid search: D1 FTS5 keyword + Vectorize semantic. **Edge-cached** (TTL 60s, SWR 5 min).

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | — | 1–200 chars (required) |
| `limit` | int | 20 | 1–50 |

Response:

```json
{
  "q": "córdoba elecciones",
  "results": [/* FTS5 NewsCard[] */],
  "vectorResults": [/* Vectorize match[] */],
  "total": 18
}
```

#### `POST /api/track`

Analytics beacon. Writes to Analytics Engine. **Never cached.**

Body (`trackEventSchema`):

```ts
{
  type: "card_view" | "article_open" | "article_complete" | "bookmark" | "share",
  newsId?: string,         // up to 128 chars
  category?: string,       // up to 50 chars
  source?: string,         // up to 128 chars
  dwellTime?: number,      // seconds, 0–86400
  scrollDepth?: number     // 0–1
}
```

Response: `{ "ok": true }`.

Called from the client via `navigator.sendBeacon()` (no CORS preflight, no waiting on response). See `packages/antena/src/lib/analytics.ts`.

### Ingest (authenticated)

#### `POST /api/ingest`

Push a news card into the system. Requires `Authorization: Bearer <API_KEY>`. AKIRA uses this to feed D1.

Body (`IngestRequest`):

```ts
{
  id: string,                // required — SHA-256 of URL
  location_id: number,       // required
  title: string,
  summary: string,
  image_url?: string,
  image_data?: string,       // base64
  bias_score?: number,       // -1 to 1
  is_gacetilla?: boolean,
  cluster_id?: string,
  category?: string,
  source_ids?: string,       // CSV
  published_at?: string       // ISO 8601
}
```

Side effects:
1. D1 upsert
2. Enqueue `image_persist` message on `IMAGE_QUEUE` (if `image_url` provided)
3. Enqueue `vector_upsert` message (handled by cron, not on hot path)

#### `POST /api/ingest/pulso`

Pulso-partner ingest. Requires `Authorization: Bearer <PULSO_API_KEY>`. Same body as `/api/ingest`.

### Internal / admin

#### `GET /api/stats/health`

Pipeline stats: cards per category, sources online/offline, last 24h throughput, queue depth.

#### `GET /cluster/:id/synthesize`

Generate a neutral master article for a cluster. Requires `MINIMAX_API_KEY`. Heavy — should be called by AKIRA, not clients.

#### `GET /synthesis/master/:cluster_id`

Get the cached master article for a cluster. `404` if not synthesized.

#### `GET /health`, `GET /health/detailed`

Health probes (no auth, no PII).

#### `GET /metrics`

Prometheus-format metrics (request count, latency, cache hit rate, queue depth, D1 row count).

#### `GET /__cron/refresh`

Cron trigger handler. Rebuilds Vectorize index, drops stale news from D1, emits a health event. Also called by Cloudflare on the schedule in `wrangler.toml` (`[triggers] crons = ["0 */2 * * *"]`).

#### Queue: `image-pipeline`

Messages: `{ type: "fetch_and_store", hash: string, requestTime: number }`.

Consumer (`packages/api/src/queues/image-pipeline.ts`):
1. Fetches source image from the original URL
2. Uploads to `IMAGES` bucket with key `hash`
3. Emits `image_stored` Analytics event

## Cache Strategy

| Endpoint | TTL | SWR | Vary |
|----------|-----|-----|------|
| `/api/news/feed` | 60s | 300s | none (params in URL) |
| `/api/news/:id` | 300s | 3600s | none |
| `/api/news/:id/cluster` | 300s | 0 | none |
| `/api/locations/tree` | 3600s | 86400s | none |
| `/api/categories` | 3600s | 86400s | none |
| `/api/sources` | 3600s | 3600s | none |
| `/api/img/:hash` | 604800s (7d) | 86400s | `Accept` |
| `/api/search` | 60s | 300s | none |
| `/api/track` | never (POST) | — | — |
| `/api/ingest` | never (POST) | — | — |
| `/api/stats/health` | 30s | 60s | none |

Cache logic is centralized in `packages/api/src/lib/cache.ts`:

```ts
return withCache(async () => { /* handler */ }, { ttl: 60, swr: 300 })(c.req.raw);
```

## Zod Schemas

Source of truth: `packages/api/src/lib/schemas.ts`. Every route validates input before any DB or storage call.

| Schema | Used by |
|--------|---------|
| `feedParamsSchema` | `/api/news/feed` |
| `articleIdSchema` | `/api/news/:id`, `/api/news/:id/cluster` |
| `clusterIdSchema` | `/cluster/:id/synthesize` |
| `searchQuerySchema` | `/api/search` |
| `imageParamsSchema` | `/api/img/:hash` |
| `trackEventSchema` | `/api/track` |
| `locationNearSchema` | `/api/locations/near` |
| `locationIdParamSchema` | `/api/locations/:id` |
| `statsLimitSchema` | `/api/stats/...` |

Each schema is exported as both runtime validator and TS type:

```ts
export const feedParamsSchema = z.object({ /* … */ });
export type FeedParams = z.infer<typeof feedParamsSchema>;
```

## Error Responses

All error responses follow the same shape:

### 400 Bad Request (Zod validation)

```json
{
  "error": "Invalid request",
  "details": {
    "fieldErrors": { "limit": ["Number must be less than or equal to 100"] },
    "formErrors": []
  }
}
```

### 404 Not Found

```json
{ "error": "Not found" }
```

For `/api/img/:hash` miss, the body includes the hash:

```json
{ "error": "Image not yet available", "hash": "abc123…" }
```

### 500 Internal Server Error

```json
{ "error": "Internal error", "message": "<safe error summary>" }
```

The full error is logged via `c.executionCtx.waitUntil(logError(...))` and never returned to the client.

## CORS

Configured in `packages/api/src/index.ts`:

```ts
app.use("*", cors({
  origin: (origin) => {
    const allowed = [
      "http://localhost:4321",
      "http://localhost:4322",
      "http://localhost:4324",
      "https://akira.ar",
      "https://www.akira.ar",
      "https://akira.pages.dev"
    ];
    return allowed.includes(origin) ? origin : "*";
  },
  credentials: true,
}));
```

In production the allowlist becomes `https://antena.com.ar` and `https://www.antena.com.ar`.

## Rate Limiting

Per-IP limits (enforced via Cloudflare Workers Rate Limiting rules — configured in dashboard):

| Endpoint | Limit |
|----------|-------|
| `/api/track` | 60 req / min / IP |
| `/api/ingest` | 600 req / min / IP (with valid API key) |
| `/api/img/*` | 1000 req / min / IP |
| All other public | 6000 req / min / IP |

## Drizzle ORM

Schema in `packages/api/src/db/schema.ts`. Migrations in `packages/api/migrations/`. Apply with:

```bash
cd packages/api
pnpm drizzle-kit generate            # generate SQL from schema
wrangler d1 migrations apply DB --local      # local Miniflare
wrangler d1 migrations apply DB --remote     # production
```

Typed read helpers live in `packages/api/src/lib/d1.ts`:

```ts
getNewsFeed(db, params): Promise<{ news: NewsCard[]; total: number }>
getNewsById(db, id): Promise<NewsCard | null>
getNewsByCluster(db, clusterId): Promise<NewsCard[]>
getLocationsTree(db): Promise<LocationNode[]>
getCategories(db): Promise<Category[]>
getSources(db): Promise<Source[]>
```

## Local Development

```bash
cd packages/api
pnpm dev              # wrangler dev on :8787 with local Miniflare bindings
```

Test against local:

```bash
curl http://localhost:8787/api/news/feed?limit=5
curl -X POST -H "Content-Type: application/json" \
  -d '{"type":"smoke"}' http://localhost:8787/api/track
curl http://localhost:8787/__cron/refresh
```

## Related

- [docs/architecture.md](architecture.md) — Caching layers, data flow
- [docs/cloudflare-setup.md](cloudflare-setup.md) — One-time provisioning
- [docs/deploy.md](deploy.md) — Deploy + CI/CD
