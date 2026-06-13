# Contributing to Antena

Welcome! This guide covers everything you need to get a local dev environment running, run tests, and submit changes. For architecture, schema, and Cloudflare setup see the linked docs at the bottom.

---

## Prerequisites

- **Node.js 20+** (we use 22 in CI)
- **pnpm 11+** (we use 11.5.0 in CI)
- **Python 3.11+** with `venv` (only needed for AKIRA, the Python extraction engine)
- **wrangler** (the Cloudflare CLI; install with `pnpm dlx wrangler --version` to verify)
- A Cloudflare account with Workers + Pages + D1 + R2 (only if you want to deploy; local dev runs in mock mode)

## First-time setup

```bash
# 1. Install JS deps
pnpm install
# pnpm 11 may prompt to approve build scripts (esbuild, workerd,
# better-sqlite3, sharp). On macOS / Linux, accept with 'y' (or
# pre-approve with `pnpm approve-builds`). On CI this is handled
# via pnpm-workspace.yaml (allowedBuildScripts: ['*']).

# 2. Copy env templates
cp .env.example .env
cp packages/api/.dev.vars.example packages/api/.dev.vars  # if it exists; otherwise see below

# 3. (Optional) Create a Python venv for AKIRA
cd packages/akira
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ../..
```

If `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`, run:

```bash
pnpm approve-builds
pnpm install
```

…then commit the resulting `pnpm-lock.yaml` change. (CI has this in `pnpm-workspace.yaml` so it doesn't need the interactive step.)

## Local dev (3 terminals)

```bash
# Terminal 1: AKIRA — Python extraction engine (port 5000)
cd packages/akira
source .venv/bin/activate
python -m uvicorn main:app --port 5000

# Terminal 2: API — Cloudflare Worker dev server (port 8787)
cd packages/api
pnpm dev

# Terminal 3: Antena — Astro frontend (port 4321)
cd packages/antena
pnpm dev
```

Then open http://localhost:4321. The frontend talks to the API at `http://localhost:8787` (configured via `PUBLIC_API_BASE` in `packages/antena/.env.development`).

**If you don't need AKIRA**: just run the API + Antena terminals. The API uses `getAkiraBaseUrl()` which returns `null` in prod and `http://localhost:5000` in dev — endpoints that need AKIRA (synthesis, Python extractor) will gracefully 503.

### One-shot dev (if you have AKIRA + deps)

```bash
pnpm dev
```

This runs `api` + `antena` in parallel via `pnpm --filter`. AKIRA still needs to be started manually in its own terminal.

## Running tests

```bash
# Typecheck (api + antena)
pnpm typecheck

# Lint
pnpm lint

# Unit tests (vitest, 247 tests in antena + api)
pnpm test

# E2E tests (Playwright, requires dev servers running)
pnpm test:e2e

# Lighthouse CI (requires `pnpm --filter antena build` + preview server)
pnpm lighthouse
```

**One-liner for CI parity**: `pnpm typecheck && pnpm lint && pnpm test`

## Project structure

```
packages/
├── akira/    # Python/FastAPI extraction engine (10 extractors, synthesis, clustering)
├── api/      # Cloudflare Worker (Hono) — D1, KV, R2, Vectorize, Queues, Cron
└── antena/   # Astro 5 + Solid.js frontend — static + SSR via Pages Functions
```

Each package has its own `package.json` and tests. Root `package.json` orchestrates the workspace with `pnpm --filter`.

## Key conventions

- **Python venv**: always `source .venv/bin/activate` before running Python in `packages/akira/`
- **pnpm workspace**: run `pnpm install` from root, never `npm install`
- **AKIRA env prefix**: all akira settings use `AKIRA_` prefix (pydantic-settings)
- **Zod validation**: every API route validates input with Zod schemas in `packages/api/src/lib/schemas.ts`
- **Cache strategy**: `withCache()` wrapper uses `caches.default` with TTL + SWR
- **R2 image hash**: `sha256(url)` is the canonical key
- **Tailwind 4**: CSS-first `@theme` in `src/lib/design-tokens.css` (no `tailwind.config.js`)
- **Solid signals + TanStack Query**: signals for local UI state, TanStack Query for server cache

## Workflow

1. Create a feature branch: `git checkout -b feat/your-feature`
2. Make changes, run `pnpm typecheck && pnpm test` locally
3. Commit with conventional commits: `feat(api): add cluster filter`, `fix(antena): dedupe locations`, etc.
4. Push and open a PR — CI runs typecheck + lint + test on every push
5. After merge to `main`, Deploy Production runs automatically (requires GH secrets; see [docs/deploy.md](docs/deploy.md))

## Troubleshooting

### `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`

Run `pnpm approve-builds`, then `pnpm install` again. Persist by adding to `pnpm-workspace.yaml`:
```yaml
allowedBuildScripts:
  - "*"
verifyDepsBeforeRun: false
```

### API returns 500 with "no AKIRA_URL configured"

This is normal in prod. The endpoints that need AKIRA (synthesis, Python extractor) are dev-only. The frontend shouldn't call them in production.

### `CORS: Origin not allowed` in browser console

Check `packages/api/src/index.ts` — the `cors({ origin: [...] })` allowlist. The currently allowed origins are:
- `http://localhost:4321`, `:4322`, `:4324`, `:4400`
- `^http://192\.168\.\d+\.\d+:(4321|4400)$` (LAN dev)
- `https://akira.ar`, `https://www.akira.ar`, `https://akira.pages.dev`
- `https://antena.com.ar`, `https://www.antena.com.ar` (production)

### `getaddrinfo ENOTFOUND api.antena.com.ar` in console

The custom domain `api.antena.com.ar` is not yet wired up. The frontend should be using `https://akira-api.miclusty.workers.dev` (the Worker URL). Check `.github/workflows/deploy-production.yml` — the `Build Antena` step writes the `PUBLIC_API_BASE` into `packages/antena/.env.production`.

### Wrangler says "Could not find account ID"

Set `CLOUDFLARE_ACCOUNT_ID` in `.env` and `packages/api/.dev.vars`. Get it from the Cloudflare dashboard URL.

### Playwright e2e tests fail with `ECONNREFUSED`

Start the dev servers in separate terminals first (see "Local dev" above). Playwright's `webServer` config tries to auto-start, but only when `CI=true`.

## Documentation

- [docs/architecture.md](docs/architecture.md) — System diagram, data flow, caching layers
- [docs/api.md](docs/api.md) — API endpoints, bindings, schemas
- [docs/deploy.md](docs/deploy.md) — Deploy guide, CI/CD, rollback
- [docs/cloudflare-setup.md](docs/cloudflare-setup.md) — One-time Cloudflare provisioning
- [docs/schema.md](docs/schema.md) — Database schema reference
- [AGENTS.md](AGENTS.md) — Developer reference (AI-oriented, but useful for humans too)
- [TECHNICAL_DEBT.md](TECHNICAL_DEBT.md) — Current tech debt + roadmap
