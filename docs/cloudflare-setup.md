# Cloudflare Setup

One-time commands to provision all the Cloudflare services Antena/AKIRA depend on. Run **once per environment** (staging, production) after authenticating with `wrangler login`.

## 1. D1 (news_cards, sources, locations, …)

```bash
wrangler d1 create antena
wrangler d1 create antena-staging  # for staging
# Copy the database_id from the output into wrangler.toml (or wrangler.staging.toml)
```

Apply migrations:

```bash
wrangler d1 migrations apply DB --remote
wrangler d1 migrations apply DB --remote --env=staging
```

## 2. KV (edge cache for hot reads)

```bash
wrangler kv namespace create CACHE
wrangler kv namespace create CACHE --env=staging
# Copy the id from the output into wrangler.toml
```

## 3. R2 (image storage)

```bash
wrangler r2 bucket create antena-images
wrangler r2 bucket create antena-images-staging
```

## 4. Vectorize (semantic search)

```bash
wrangler vectorize create news_embeddings --dimensions=384 --metric=cosine
wrangler vectorize create news_embeddings_staging --dimensions=384 --metric=cosine
```

## 5. Analytics Engine (read events, dwell time, scroll depth)

```bash
wrangler analytics-engine create feed_events
wrangler analytics-engine create feed_events_staging
# No ID needed; just the name (goes into wrangler.toml [[analytics_engine_datasets]])
```

## 6. Queues (async image pipeline)

```bash
wrangler queues create image-pipeline
wrangler queues create image-pipeline-staging
```

## 7. Workers AI (embeddings, future)

Already available on every Worker — no setup needed. Reference in code:

```ts
const model = env.AI.run("@cf/baai/bge-small-en-v1.5", { text: ["…"] });
```

## 8. Cron Triggers

Configured in `wrangler.toml` under `[triggers]`. No separate provisioning — deploys the schedule with the Worker.

```toml
[triggers]
crons = ["0 */2 * * *"]  # every 2 hours
```

## Full sequence (copy-paste, fill in IDs afterwards)

```bash
# Authenticate
wrangler login

# D1
wrangler d1 create antena
wrangler d1 create antena-staging

# KV
wrangler kv namespace create CACHE
wrangler kv namespace create CACHE --env=staging

# R2
wrangler r2 bucket create antena-images
wrangler r2 bucket create antena-images-staging

# Vectorize
wrangler vectorize create news_embeddings --dimensions=384 --metric=cosine
wrangler vectorize create news_embeddings_staging --dimensions=384 --metric=cosine

# Analytics Engine
wrangler analytics-engine create feed_events
wrangler analytics-engine create feed_events_staging

# Queues
wrangler queues create image-pipeline
wrangler queues create image-pipeline-staging

# Apply migrations (after pasting the database_id into wrangler.toml)
wrangler d1 migrations apply DB --remote
wrangler d1 migrations apply DB --remote --env=staging
```

After provisioning, replace every `REPLACE_WITH_REAL_ID` placeholder in `wrangler.toml`, `wrangler.staging.toml`, and `wrangler.production.toml` with the IDs printed by the commands above.

## Verifying bindings

```bash
wrangler dev
```

The dev server should start with all 9 bindings visible in the startup banner. Test each:

- `curl http://localhost:8787/api/news/feed` → reads from D1
- `curl http://localhost:8787/api/search?q=foo` → hits Vectorize (empty index is fine)
- `curl -X POST -H "Content-Type: application/json" -d '{"type":"smoke"}' http://localhost:8787/api/track` → fires Analytics Engine
- `curl http://localhost:8787/__cron/refresh` → runs the cron handler synchronously

## Costs

Everything in this list is on the **Workers Paid plan free tier** for low traffic. As of 2026:

- D1: 5 GB storage, 5 billion rows read/day included
- KV: 100k reads/day, 1k writes/day included
- R2: 10 GB-month storage, 10 million Class A ops/month included
- Vectorize: 30 million queried vector dimensions/month included
- Analytics Engine: 100k events/day included
- Queues: 1 million operations/month included
- Workers: 100k requests/day included on the Paid plan

Total free tier is comfortable up to ~100k MAU. Beyond that, costs scale linearly and stay well under a managed Postgres + Redis setup.
