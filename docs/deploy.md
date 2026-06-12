# Deploy Guide

How to ship Antena to production. Covers Cloudflare setup, environment config, CI/CD, manual deploys, and rollback.

## Prerequisites

1. **Cloudflare account** on the Workers Paid plan
2. **Custom domain** (e.g. `antena.com.ar`) added to Cloudflare
3. **GitHub repo** with branch protection on `main` (require CI green)
4. **Local tools**:
   ```bash
   pnpm install -g wrangler
   wrangler login
   wrangler --version  # 4.x
   ```
5. **GitHub repository secrets** (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN` — API token with `Pages: Edit`, `Workers: Edit`, `D1: Edit`, `KV: Edit`, `R2: Edit`, `Queues: Edit`, `Vectorize: Edit`, `Analytics Engine: Edit`
   - `CLOUDFLARE_ACCOUNT_ID` — Account ID from Cloudflare dashboard
   - Optional `LHCI_GITHUB_APP_TOKEN` — for Lighthouse CI result comments on PRs

## One-Time Setup

Run the provisioning sequence in [docs/cloudflare-setup.md](cloudflare-setup.md) for **each environment** (staging, production). The commands create:

- D1 database `antena` (and `antena-staging`)
- KV namespace `CACHE`
- R2 bucket `antena-images` (and `-staging`)
- Vectorize index `news_embeddings` (and `_staging`)
- Analytics Engine dataset `feed_events` (and `_staging`)
- Queue `image-pipeline` (and `-staging`)

After each command, **copy the printed ID** into the matching `wrangler*.toml` file:

| File | `database_id` | `kv id` | `bucket_name` | `index_name` | `dataset` | `queue` |
|------|---------------|---------|---------------|--------------|-----------|---------|
| `packages/api/wrangler.toml` | `antena` | `CACHE` | `antena-images` | `news_embeddings` | `feed_events` | `image-pipeline` |
| `packages/api/wrangler.staging.toml` | `antena-staging` | `CACHE` | `antena-images-staging` | `news_embeddings_staging` | `feed_events_staging` | `image-pipeline-staging` |
| `packages/api/wrangler.production.toml` | `antena-prod` (alias) | `CACHE` (alias) | `antena-images` (shared) | `news_embeddings` (shared) | `feed_events` (shared) | `image-pipeline` (shared) |

Production and staging share R2/Vectorize/Analytics/Queue (the workers bind to the same instance); D1 and KV are isolated per environment for safety.

### Set secrets

Secrets are not in `wrangler.toml` — they live in the Cloudflare dashboard or via CLI:

```bash
# Production
wrangler secret put API_KEY --env=production
wrangler secret put PULSO_API_KEY --env=production
wrangler secret put MINIMAX_API_KEY --env=production

# Staging
wrangler secret put API_KEY --env=staging
wrangler secret put PULSO_API_KEY --env=staging
wrangler secret put MINIMAX_API_KEY --env=staging
```

### Configure custom domain in Pages

```bash
# After first deploy, set the custom domain in the Pages dashboard
# antena.com.ar → production
# staging.antena.com.ar → preview/staging branch
```

### Add AKIRA → Worker URL

Set `AKIRA_URL` to the URL of the Python extraction engine (e.g. `https://akira.antena.com.ar`):

```bash
wrangler secret put AKIRA_URL --env=production
```

## Environments

| Env | Branch | Pages URL | API URL | D1 | R2 bucket |
|-----|--------|-----------|---------|----|-----------|
| **dev** | (local) | `http://localhost:4321` | `http://localhost:8787` | local Miniflare | local |
| **staging** | `develop` | `https://staging.antena.com.ar` | `https://akira-api-staging.<account>.workers.dev` | `antena-staging` | `antena-images-staging` |
| **production** | `main` | `https://antena.com.ar` | `https://akira-api.<account>.workers.dev` | `antena` | `antena-images` |

The Antena frontend uses different `PUBLIC_API_BASE` per environment:

| Env | `PUBLIC_API_BASE` |
|-----|-------------------|
| dev | `http://localhost:8787` |
| staging | `https://akira-api-staging.<account>.workers.dev` |
| production | `https://api.antena.com.ar` |

## CI/CD Flow

`.github/workflows/ci.yml` runs on every PR and on every push to `main`:

```
PR opened / updated
  ├─ test              (typecheck + lint + vitest + Playwright)
  ├─ lighthouse        (perf/a11y/BP/SEO thresholds)
  ├─ deploy-preview    → Cloudflare Pages preview URL
  └─ (no prod deploy)

push to main
  ├─ test
  ├─ lighthouse
  ├─ deploy-prod       → Pages production + D1 migrations + API Worker
  └─ (no preview)
```

### Required checks on `main`

Branch protection on `main` should require:

- ✅ `Test` (typecheck + lint + unit + E2E)
- ✅ `Lighthouse CI` (perf > 90, a11y > 95, BP > 95, SEO > 95)

If either fails, the merge button is disabled.

### Required checks on PRs

- ✅ `Test`
- ✅ `Lighthouse CI`
- ✅ `Deploy Preview` (must succeed)

## Manual Deploys

### Antena (Pages)

```bash
# Build
cd packages/antena
pnpm build

# Deploy to a preview branch
wrangler pages deploy dist --project-name=antena --branch=feature/foo

# Deploy to production
wrangler pages deploy dist --project-name=antena --branch=main
```

The root `package.json` exposes:

```bash
pnpm deploy:staging    # wrangler pages deploy ./packages/antena/dist --project-name=antena --branch=develop
pnpm deploy:prod       # wrangler pages deploy ./packages/antena/dist --project-name=antena --branch=main
```

### API Worker

```bash
cd packages/api

# Dev (Miniflare + local D1)
pnpm dev

# Staging
wrangler deploy --env=staging

# Production
wrangler deploy --env=production
```

### D1 migrations

```bash
cd packages/api

# Local
wrangler d1 migrations apply DB --local

# Production
wrangler d1 migrations apply DB --env=production --remote
```

### AKIRA Python service

AKIRA runs on a VM (not Cloudflare). Update via your usual VM deployment:

```bash
# On the AKIRA VM
cd /srv/akira
git pull
source .venv/bin/activate
pip install -r requirements.txt
pm2 restart akira
```

## Rollback

### Pages (Antena)

Cloudflare Pages keeps the last 50 deployments. To roll back:

```bash
# List recent deployments
wrangler pages deployments list --project-name=antena

# Roll back to a specific deployment
wrangler pages deployments rollback <deployment-id> --project-name=antena
```

Or via the Cloudflare dashboard: Workers & Pages → `antena` → Deployments → click ⋯ on the previous good deployment → "Rollback to this deploy".

### Worker (API)

```bash
# List recent versions
wrangler deployments list --name=akira-api

# Roll back to a specific version (by ID or "100%" for the previous one)
wrangler rollback --name=akira-api
```

### D1

D1 does not have a "rollback" — instead, restore from a backup:

```bash
# List backups
wrangler d1 backups list DB --env=production

# Restore (this drops current data and replaces with the backup)
wrangler d1 backups restore DB <backup-id> --env=production
```

**Migrations are forward-only.** If a migration has gone bad, write a new migration that undoes the schema change rather than rolling back D1.

### R2

R2 versioning is **not enabled by default** — once an object is overwritten, it's gone. For news images we treat R2 as ephemeral cache (re-derivable from the source URL) and accept the loss.

## Monitoring

### Cloudflare Web Analytics (free, privacy-first)

Already enabled on the production Pages project — no code required. View at: `https://antena.com.ar` → Cloudflare dashboard → Analytics.

### Workers Logs

Real-time tail:

```bash
wrangler tail --name=akira-api --env=production
```

Logs are also visible in the Cloudflare dashboard: Workers & Pages → `akira-api` → Logs.

### Analytics Engine

`feed_events` dataset is queryable in the Cloudflare dashboard:

```sql
SELECT blob1 AS event_type, COUNT(*) AS n
FROM feed_events
WHERE timestamp > NOW() - INTERVAL '1' DAY
GROUP BY blob1
ORDER BY n DESC
```

### Alerts (recommended)

Set up Cloudflare Notifications for:

- Worker error rate > 1% in 5 min → email/Slack
- Worker CPU time p95 > 50ms → Slack
- D1 row count sudden drop > 10% → email
- Queue `image-pipeline` depth > 1000 → Slack
- R2 storage > 80% of free tier → email

### Uptime monitoring

UptimeRobot or Cloudflare's synthetic monitoring (Workers Observability). Point at:

- `https://antena.com.ar` (Pages)
- `https://api.antena.com.ar/api/news/feed?limit=1` (Worker — should return 200 within 500ms)

## Cost Ceiling

| Resource | Free tier | Comfortable to |
|----------|-----------|----------------|
| D1 | 5 GB storage, 5 B rows read/day | ~100k MAU |
| KV | 100k reads/day, 1k writes/day | ~50k MAU |
| R2 | 10 GB-month, 10 M Class A ops/month | ~200k MAU |
| Vectorize | 30 M queried vector dimensions/month | ~100k MAU |
| Analytics Engine | 100k events/day | ~50k MAU |
| Queues | 1 M operations/month | ~500k MAU |
| Workers | 100k requests/day on Paid plan | baseline |

Beyond that, costs scale linearly and stay under a managed Postgres + Redis + S3 + Elasticsearch + GA setup.

## Disaster Recovery

| Failure | Recovery |
|---------|----------|
| Pages deploy breaks | Rollback via dashboard (instant) |
| Worker breaks | `wrangler rollback` (instant) |
| D1 corruption | Restore from backup (5 min) |
| R2 loss | Re-derive from source URLs (queue re-runs) |
| Vectorize corruption | Cron handler re-embeds all news (5-10 min) |
| AKIRA Python down | Workers still serve cached data; cron reschedules; no user impact until cache TTL (5 min) |
| Region-wide Cloudflare outage | Status page: [cloudflarestatus.com](https://cloudflarestatus.com) — wait, then verify with smoke test |

## Related

- [docs/architecture.md](architecture.md)
- [docs/api.md](api.md)
- [docs/cloudflare-setup.md](cloudflare-setup.md)
