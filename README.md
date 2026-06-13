# Antena — Mobile-First News for Argentina

Cloudflare-native news feed. Reddit/X.com-style mobile UI built on Astro 5 + Solid.js, served from Pages and backed by Hono Workers on D1, KV, R2, Vectorize, and Analytics Engine.

## Quick Start

```bash
# 1. Install (pnpm 11+; if it prompts to approve build scripts,
#    accept with 'y' or pre-approve with `pnpm approve-builds`)
pnpm install
cp .env.example .env

# 2. Local dev (3 terminals)
cd packages/akira && source .venv/bin/activate && python -m uvicorn main:app --port 5000  # extraction engine
cd packages/api && pnpm dev                                                            # API Worker (8787)
cd packages/antena && pnpm dev                                                        # Astro frontend (4321)

# 3. Production build
pnpm build

# 4. Deploy
pnpm deploy:staging    # Cloudflare Pages preview branch
pnpm deploy:prod       # Cloudflare Pages main branch
cd packages/api && wrangler deploy --env=production   # API Worker
```

> New to the project? Read [CONTRIBUTING.md](CONTRIBUTING.md) for the full setup, scripts, and troubleshooting guide.

## Architecture

```
AKIRA (Python)  →  API (Cloudflare Worker)  →  Antena (Cloudflare Pages)
   10 extractors       Hono + D1 + KV + R2          Astro 5 + Solid.js
   synthesis           Vectorize + Analytics        Static + SSR Functions
```

Full system diagram and data flow: [docs/architecture.md](docs/architecture.md)

## Documentation

- [docs/architecture.md](docs/architecture.md) — System diagram, data flow, caching layers, security model
- [docs/api.md](docs/api.md) — API endpoints, Cloudflare bindings, Zod schemas, error responses
- [docs/deploy.md](docs/deploy.md) — Deploy guide, environments, CI/CD, rollback, monitoring
- [docs/cloudflare-setup.md](docs/cloudflare-setup.md) — One-time provisioning of D1, KV, R2, Vectorize, etc.
- [docs/schema.md](docs/schema.md) — Database schema
- [AGENTS.md](AGENTS.md) — Developer reference for AI agents

## Stack at a Glance

| Layer | Tech |
|-------|------|
| Frontend | Astro 5, Solid.js, Tailwind 4, TanStack Query, VitePWA |
| API | Hono on Cloudflare Workers, Drizzle ORM, Zod |
| Database | Cloudflare D1 (SQLite) |
| Cache | Cloudflare KV + `caches.default` (edge) + TanStack Query (client) + Service Worker (PWA) |
| Images | Cloudflare R2 + Image Resizing (AVIF/WebP/JPEG) |
| Search | D1 FTS5 + Vectorize hybrid |
| Analytics | Analytics Engine (`feed_events`) |
| Async | Cloudflare Queues (`image-pipeline`) |
| Scheduler | Cron Triggers (refresh + GC) |
| AI | MiniMax M2.7 (synthesis), Workers AI (embeddings) |
