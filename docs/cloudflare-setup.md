# Cloudflare Setup — Antena

> Referencia operativa para configurar credenciales Cloudflare en dev/staging/production.
> **NUNCA** commitear tokens ni secret keys a este archivo. Usar `wrangler secret put` o password manager.

## Account

| Variable | Valor |
|----------|-------|
| `CLOUDFLARE_ACCOUNT_ID` | `aec9ebbec62970f96aa639feaabdc9f5` |

## Servicios usados por Antena

| Servicio | Binding | Proyecto |
|----------|---------|----------|
| Pages | `antena` | Frontend estático (Astro) |
| Pages | `antena-staging` | Staging |
| Workers | `akira-api` | API backend (Hono) |
| D1 | `antena` | DB (news_cards, sources, locations, master_articles, clusters) |
| R2 | `antena-images` | Imágenes de noticias |
| KV | `CACHE` | Edge cache + redirects legacy map |
| Vectorize | `news_embeddings` | Embeddings semánticos |
| Analytics Engine | `feed_events` | Telemetría de feed + SEO health |
| Queues | `image-pipeline` | Ingesta async de imágenes a R2 |

## Variables de entorno requeridas

### Backend (API worker)

```bash
# Token de API con permisos: D1, Workers, R2, KV, Vectorize, Analytics Engine, Queues
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put CLOUDFLARE_ACCOUNT_ID
```

### R2 (image upload, S3-compatible)

```bash
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

### AKIRA (Python extractor)

```bash
# .env en packages/akira/.env (gitignored)
AKIRA_API=https://akira-api.miclusty.workers.dev
AKIRA_DB=packages/akira/data/akira.db
MINIMAX_API_KEY=<ask user>
```

### SEO Monitor (cron alerts)

Currently logs to console + Analytics Engine dataset `seo_health`. No external alerting.
To re-enable Discord/Slack/email alerting, add back `DISCORD_WEBHOOK_URL` secret and restore the alert block in `packages/api/src/lib/seo-monitor.ts`.

## Cómo rotar credenciales

1. Crear nuevo token en https://dash.cloudflare.com/profile/api-tokens
2. Aplicar: `echo "<new_token>" | wrangler secret put CLOUDFLARE_API_TOKEN`
3. Verificar: `wrangler secret list`
4. Borrar token viejo desde el dashboard

## Comandos de referencia

```bash
# Listar secrets actuales (no muestra valores)
wrangler secret list

# Aplicar migration D1 a prod
wrangler d1 migrations apply DB --env=production --remote

# Backfill SQL (genera script local, corre contra prod D1)
cd packages/akira && source .venv/bin/activate
python -c "..." > /tmp/backfill.sql
split -l 1000 /tmp/backfill.sql /tmp/batch_
for f in /tmp/batch_*; do wrangler d1 execute DB --env=production --remote --file="$f"; done

# Deploy Pages
cd packages/antena && pnpm build
wrangler pages deploy ./dist --project-name=antena --branch=main

# Deploy worker
cd packages/api && wrangler deploy --env=production

# Restart AKIRA
pm2 restart akira
```

## Account ID es público

El Account ID (`aec9ebbec62970f96aa639feaabdc9f5`) no es secreto — es un identificador visible en URLs de la API Cloudflare, en zonas DNS, etc. Se puede commitear.

**Lo que SÍ es secreto y nunca va en este archivo:**
- API tokens
- R2 access keys (Access Key ID + Secret Access Key)
- Discord webhook URLs
- API keys de terceros (MiniMax, etc.)
