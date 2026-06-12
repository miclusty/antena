# Change: antena-v1-closer

## Why

The Antena frontend is currently in a half-finished state. The previous working app was a Reddit/X.com-style feed (committed in `feature/antena-top-tier` and in HEAD's `App.tsx` 512-line version), but a WebLLM agent experiment replaced it in the working tree, losing the feed. The user wants to:

1. **Close the design** — stop iterating, finalize the v1 scope, and ship.
2. **Mobile-first** — Reddit/X.com pattern, native-feeling, single-handed thumb reach.
3. **Cloudflare 100%** — use every Cloudflare service that already exists on the platform but isn't being used: R2, Image Resizing, Cache API, Vectorize, Analytics Engine, Queues, Cron Triggers, Pages Functions SSR, Turnstile.
4. **Best tech for the job** — Tailwind 4 (not 3), Drizzle ORM (not raw SQL), Solid Query (not hand-rolled fetch), Zod (not manual validation).

The full design rationale lives in `docs/superpowers/specs/2026-06-11-antena-v1-closer-design.md`. This proposal summarizes it for OpenSpec.

## What Changes

### Frontend (packages/antena)

- **Revert** `App.tsx` from working tree back to HEAD's 512-line feed version (already done in commit `f46eabf`)
- **Delete** the WebLLM agent code: `lib/{local-llm,voice,agent,memory,antenas}.ts` and `components/agent/*` — move to `feature/webllm-agent` branch
- **Delete** `components/categories/SintonizarView.tsx` and community-service stubs (Cortes, Farmacias, Transporte, Alertas)
- **Migrate** Tailwind 3 → Tailwind 4 via `@tailwindcss/vite` (drop `@astrojs/tailwind`)
- **Remove** `@google/design.md` and `@mlc-ai/web-llm` from runtime deps
- **Add** `@tanstack/solid-query@5`, `zod@3`, `@cloudflare/vitest-pool-workers`, `web-vitals@4`
- **Refine** `NewsCard.tsx`, `BottomNav.tsx`, `Header.tsx`, `ArticleDetail.tsx` for mobile excellence (44pt touch targets, haptic, press state, long-press action sheet, scroll-hide top tabs)
- **Connect** `FeedTabs.tsx` to active state (was a mock)
- **Fix** 9 P0/P1 bugs (share button, infinite scroll, article from URL, menu, agregar ubicación, empty category)
- **Add** new components: `Skeleton.tsx`, `BottomSheet.tsx`, `EmptyState.tsx` (improved)
- **Refine** `design-tokens.css` — dark mode palette not just inverted, refined borders, accent glow
- **Add** new lib files: `cloudflare.ts` (typed bindings), `image.ts` (srcset), `cache.ts` (Cache API), `analytics.ts` (Analytics Engine), `search.ts` (Vectorize + FTS)
- **Add** Pages Functions: `functions/api/track.ts`, `functions/api/search.ts`

### API (packages/api)

- **Add** `drizzle-orm@0.36` + `drizzle-kit` for type-safe D1 queries
- **Add** Zod for request validation
- **Remove** `better-sqlite3` from runtime (dev only or remove entirely — D1 is the prod DB)
- **Add** routes: `image.ts` (R2 + Image Resizing), `search.ts` (FTS + Vectorize), `track.ts` (Analytics Engine write)
- **Add** `crons/refresh.ts` (Cron trigger handler: reindex Vectorize, refresh clusters, clean stale)
- **Add** `queues/image-pipeline.ts` (R2 image fetch + transform consumer)
- **Update** all routes to use Cache API edge cache
- **Add** `wrangler.jsonc` with all 9 Cloudflare bindings

### AKIRA (packages/akira)

- **No changes for v1.** Extraction pipeline is the source of truth, untouched.

### Infrastructure

- **Add** Cloudflare services: R2 bucket `antena-images`, Vectorize index `news_embeddings`, Analytics Engine dataset `feed_events`, Queue `image-pipeline`, Cron trigger `0 */2 * * *`, Pages Function SSR for `/noticia/[id]`
- **Add** `wrangler.toml` per env: dev, staging, production
- **Add** GitHub Actions CI/CD: typecheck, lint, test, E2E, Lighthouse CI, deploy preview on PR, deploy prod on main
- **Add** D1 migrations via Drizzle Kit
- **Update** AGENTS.md, README.md, docs/architecture.md, docs/api.md, docs/deploy.md

## Capabilities

### New Capabilities

- **`antena-v1-closer`**: Mobile-first Cloudflare-native feed replacing the WebLLM agent experiment
  - Replaces capability: `webllm-agent` (archived in branch, not in runtime)

### Modified Capabilities

- None (this is a frontend/backend re-platform, not a spec change to existing features)

## Impact

### Affected files

**Antena (modified):**
- `packages/antena/src/App.tsx` (reverted to feed version)
- `packages/antena/src/components/common/{NewsCard,BottomNav,Header,FeedTabs,EmptyState,ErrorBoundary}.tsx`
- `packages/antena/src/components/article/{ArticleDetail,ClusterView}.tsx`
- `packages/antena/src/components/layout/{Header,RightSidebar}.tsx`
- `packages/antena/src/components/bookmarks/BookmarksView.tsx`
- `packages/antena/src/lib/{api,db,scroll,hooks,urlState,bookmarks,haptic}.ts`
- `packages/antena/src/lib/design-tokens.css`
- `packages/antena/astro.config.mjs`
- `packages/antena/package.json`
- `packages/antena/vite.config.ts` (Tailwind 4 + PWA config)
- `packages/antena/wrangler.toml` (Pages config)
- `packages/antena/src/pages/{index,bookmarks,search}.astro`
- New: `packages/antena/src/lib/{cloudflare,image,cache,analytics,search}.ts`
- New: `packages/antena/src/components/common/{Skeleton,BottomSheet}.tsx`
- New: `packages/antena/src/functions/api/{track,search}.ts`

**Antena (deleted, moved to branch):**
- `packages/antena/src/lib/{local-llm,voice,agent,memory,antenas}.ts`
- `packages/antena/src/components/agent/*`
- `packages/antena/src/components/categories/SintonizarView.tsx`

**API (modified):**
- `packages/api/src/index.ts` (mount new routes)
- `packages/api/src/routes/{news,locations,categories,stats}.ts` (Cache API, Zod validation)
- `packages/api/src/lib/types.ts` (Cloudflare bindings typed)
- `packages/api/package.json` (add Drizzle, Zod; remove better-sqlite3)
- `packages/api/wrangler.toml` (add bindings)

**API (new):**
- `packages/api/src/routes/{image,search,track}.ts`
- `packages/api/src/crons/refresh.ts`
- `packages/api/src/queues/image-pipeline.ts`
- `packages/api/src/db/schema.ts` (Drizzle schema)
- `packages/api/migrations/*` (Drizzle-generated)
- `packages/api/drizzle.config.ts`

**Root (modified):**
- `package.json` (new scripts: `validate`, `test`, `test:e2e`, `lighthouse`, `deploy:staging`, `deploy:prod`)
- `pnpm-workspace.yaml` (no changes, already correct)
- `.github/workflows/ci.yml` (new)
- `AGENTS.md` (update for new stack and Cloudflare services)
- `README.md` (update quickstart)
- `.env.example` (add new Cloudflare binding refs)

**Root (new):**
- `docs/architecture.md`
- `docs/api.md`
- `docs/deploy.md`
- `CHANGELOG.md`

**Out of scope (kept as is):**
- `packages/akira/*` — Python extraction pipeline, untouched
- `docs/archived/*` — historical docs, kept

## Out of Scope (explicit)

These are NOT in this change. Each is a v2/v3 decision.

- WebLLM agent (moved to `feature/webllm-agent` branch)
- Voice (STT/TTS in agent) (same branch)
- User accounts / auth via Cloudflare Access (v2)
- Comments (no auth, deferred to v2)
- Persistent reactions (no auth, deferred to v2)
- Community services: Cortes, Farmacias, Transporte, Alertas (no data sources, v3)
- Push notifications (v2, opt-in)
- Polished ModoMate TTS UI (keep simple, no special UI)
- i18n (Spanish only v1)
- RSS reader / saved searches (v2)
- Newsletter digest via Email Workers (v3)
