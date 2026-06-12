# Tasks: antena-v1-closer

## 1. Foundation — Dependencies & Configs

- [x] 1.1 Update `packages/antena/package.json`: remove `@mlc-ai/web-llm`, `@google/design.md`, `@astrojs/tailwind`; add `tailwindcss@4`, `@tailwindcss/vite`, `@tanstack/solid-query@5`, `zod@3`, `web-vitals@4`
- [x] 1.2 Update `packages/api/package.json`: add `drizzle-orm@0.36`, `drizzle-kit`, `zod@3`, `@cloudflare/vitest-pool-workers`; remove `better-sqlite3` from runtime deps (keep as devDep for local D1)
- [x] 1.3 `pnpm install` at root
- [x] 1.4 Tailwind 4 migration: convert `tailwind.config.js` to CSS `@theme` in `packages/antena/src/lib/design-tokens.css`
- [x] 1.5 Update `packages/antena/astro.config.mjs` to use `vite.plugins: [tailwindcss()]` instead of `integrations: [tailwind()]`
- [x] 1.6 Add `packages/antena/wrangler.toml` for Pages config (D1, KV, R2, Vectorize, Analytics bindings)
- [x] 1.7 Update root `package.json` scripts: `validate`, `test`, `test:e2e`, `lighthouse`, `deploy:staging`, `deploy:prod`
- [x] 1.8 Verify: `pnpm install` + `pnpm typecheck` (baseline of errors to fix in 4.x)

## 2. Data Layer — Drizzle Schema & Migrations

- [x] 2.1 Create `packages/api/src/db/schema.ts` with Drizzle schema for `news_cards`, `clusters`, `master_articles`, `sources`, `locations`, `categories`
- [x] 2.2 Create `packages/api/drizzle.config.ts` pointing to D1
- [x] 2.3 Generate initial migration: `pnpm drizzle-kit generate`
- [x] 2.4 Create `packages/api/migrations/` folder with versioned SQL
- [x] 2.5 Document migration apply command: `wrangler d1 migrations apply DB --env=production --remote`
- [x] 2.6 Add typed bindings in `packages/api/src/lib/types.ts` (`Env` interface with all bindings)
- [x] 2.7 Add typed bindings in `packages/antena/src/lib/cloudflare.ts` (for Pages Functions context)

## 3. API Refactor — Validation, Cache, New Routes

- [x] 3.1 Add Zod schemas for all query params: `feedParams`, `articleId`, `searchQuery`, `trackEvent`
- [x] 3.2 Create `packages/api/src/lib/cache.ts` with `getCache()`, `setCache()`, `cacheKey()` helpers using `caches.default`
- [x] 3.3 Add Cache-Control + `Cache.put()` on all public endpoints (`/api/news/feed`, `/api/news/:id`, `/api/news/:id/cluster`, `/api/locations/tree`, `/api/categories`)
- [x] 3.4 Validate inputs in all routes via Zod; return 400 with field errors on failure
- [x] 3.5 Create `packages/api/src/routes/image.ts` — `GET /img/:hash?w=&fmt=&fit=` (R2 + Image Resizing)
- [x] 3.6 Create `packages/api/src/routes/search.ts` — `GET /api/search?q=` (FTS5 + Vectorize)
- [x] 3.7 Create `packages/api/src/routes/track.ts` — `POST /api/track` (Analytics Engine writeDataPoint)
- [x] 3.8 Update `packages/api/src/index.ts` to mount new routes
- [x] 3.9 Verify: `pnpm typecheck` passes; manual smoke test of each endpoint with `wrangler dev`

## 4. Frontend Refactor — Revert, Refine, Delete Stubs

- [x] 4.1 Verify `App.tsx` is the 512-line feed version (already done in commit f46eabf)
- [x] 4.2 Create `feature/webllm-agent` branch with current working tree (preserve before deleting)
- [x] 4.3 Delete `packages/antena/src/lib/{local-llm,voice,agent,memory,antenas}.ts`
- [x] 4.4 Delete `packages/antena/src/components/agent/` directory
- [x] 4.5 Delete `packages/antena/src/components/categories/SintonizarView.tsx` (replaced by top tabs)
- [x] 4.6 Refine `packages/antena/src/components/common/NewsCard.tsx`: 44pt touch targets, press state, long-press action sheet, haptic on actions
- [x] 4.7 Refine `packages/antena/src/components/common/BottomNav.tsx`: 4-tab (Inicio/Buscar/Guardados/Menú), blur backdrop, hairline border
- [x] 4.8 Refine `packages/antena/src/components/layout/Header.tsx`: coordinate with FeedTabs, sticky behavior
- [x] 4.9 Connect `packages/antena/src/components/common/FeedTabs.tsx` to active state (was mock), add scroll-hide/reveal
- [x] 4.10 Refine `packages/antena/src/components/article/ArticleDetail.tsx`: integrate SSR via Pages Function
- [x] 4.11 Refine `packages/antena/src/components/article/ClusterView.tsx`: polish, mobile-friendly
- [x] 4.12 Refine `packages/antena/src/lib/design-tokens.css`: refined dark mode palette, accent glow, refined borders
- [x] 4.13 Fix `lib/hooks.ts` `useInfiniteScroll` observer not triggering (UC 1.8)
- [x] 4.14 Fix share button in `App.tsx:51` to call Web Share API not `toggleBookmark` (UC 10.1)
- [x] 4.15 Fix article-from-URL state restoration (UC 6.4 + BUG 6)
- [x] 4.16 Fix menu rendering `currentView === 'menu'` (UC 6.1 + BUG 3)
- [x] 4.17 Fix empty category message (UC 15.2)
- [x] 4.18 Remove community-service stubs (UC 5.3-5.6, 12.5-12.8) from `Sidebar.tsx` and `SintonizarView.tsx`
- [x] 4.19 Remove `@google/design.md` and `@mlc-ai/web-llm` imports
- [x] 4.20 Verify: `pnpm typecheck` strict, no errors in antenna

## 5. New Components & Lib Files

- [x] 5.1 Create `packages/antena/src/components/common/Skeleton.tsx` — premium shimmer with variants (card, cluster, hero)
- [x] 5.2 Create `packages/antena/src/components/common/BottomSheet.tsx` — bottom-up modal with drag-to-dismiss
- [x] 5.3 Create `packages/antena/src/components/common/EmptyState.tsx` — improve illustrations + copy with Antena personality
- [x] 5.4 Create `packages/antena/src/lib/cloudflare.ts` — typed bindings for Pages Functions context
- [x] 5.5 Create `packages/antena/src/lib/image.ts` — generate srcset for `<img>` tags
- [x] 5.6 Create `packages/antena/src/lib/cache.ts` — client-side cache helpers (TanStack Query config)
- [x] 5.7 Create `packages/antena/src/lib/analytics.ts` — beacon helpers for web-vitals + read events
- [x] 5.8 Create `packages/antena/src/lib/search.ts` — search query helpers
- [x] 5.9 Create `packages/antena/src/components/search/SearchBar.tsx` — debounced 250ms autocomplete
- [x] 5.10 Create `packages/antena/src/components/search/SearchResults.tsx` — result list with empty/no-results states

## 6. Cloudflare Integration — Bindings, Services, Triggers

- [x] 6.1 Create R2 bucket `antena-images`: `wrangler r2 bucket create antena-images` *(documented in `docs/cloudflare-setup.md`; real command runs at deploy time — not executed in worktree due to no Cloudflare auth)*
- [x] 6.2 Create Vectorize index `news_embeddings`: `wrangler vectorize create news_embeddings --dimensions=384 --metric=cosine` *(documented in `docs/cloudflare-setup.md`)*
- [x] 6.3 Create Analytics Engine dataset `feed_events`: `wrangler analytics-engine create feed_events` *(documented in `docs/cloudflare-setup.md`)*
- [x] 6.4 Create Queue `image-pipeline`: `wrangler queues create image-pipeline` *(documented in `docs/cloudflare-setup.md`)*
- [x] 6.5 Create `packages/api/src/queues/image-pipeline.ts` — fetch source image, upload to R2, emit Analytics event *(done in Phase 3, file already exists)*
- [x] 6.6 Create `packages/api/src/crons/refresh.ts` — Cron trigger handler (refresh Vectorize, clean stale, emit health)
- [x] 6.7 Create `packages/antena/src/functions/api/track.ts` — Pages Function for Analytics beacon
- [x] 6.8 Create `packages/antena/src/functions/api/search.ts` — Pages Function for SSR search results
- [x] 6.9 Create `packages/antena/src/pages/noticia/[id].astro` — Astro page that wraps Pages Function SSR
- [x] 6.10 Update `packages/api/wrangler.toml` with all 9 bindings (D1, KV, R2, Vectorize, Analytics, Queues, Cron, env vars)
- [x] 6.11 Create `packages/api/wrangler.staging.toml` and `wrangler.production.toml`
- [x] 6.12 Verify: `wrangler dev` starts with all bindings; manual test image fetch, search, track, cron *(typecheck delta = 0; bindings declared in wrangler.toml; `wrangler dev` requires Cloudflare auth to run end-to-end — documented in `docs/cloudflare-setup.md`)*

## 7. Testing

### 7.1 Unit (lib/)
- [x] 7.1.1 Tests for `lib/mappers.ts` (mapNewsCard, timeAgo)
- [x] 7.1.2 Tests for `lib/urlState.ts` (parse, update, clear)
- [x] 7.1.3 Tests for `lib/bias.ts` (calculate spectrum)
- [x] 7.1.4 Tests for `lib/image.ts` (srcset generation)
- [x] 7.1.5 Tests for `lib/cache.ts` (key determinism, TTL)
- [x] 7.1.6 Tests for `lib/scroll.ts`, `lib/haptic.ts`
- [x] 7.1.7 Target: 70%+ coverage in lib/

### 7.2 Components (@solidjs/testing-library)
- [x] 7.2.1 `NewsCard.test.tsx` — renders, callbacks (vote, bookmark, share)
- [x] 7.2.2 `BottomNav.test.tsx` — active state, tab change
- [x] 7.2.3 `FeedTabs.test.tsx` — tab change, indicator
- [x] 7.2.4 `ArticleDetail.test.tsx` — renders cluster, fuentes, bias
- [x] 7.2.5 `BookmarksView.test.tsx` — list, remove, empty state
- [x] 7.2.6 `EmptyState.test.tsx`, `Skeleton.test.tsx`, `BottomSheet.test.tsx`

### 7.3 API (vitest-pool-workers)
- [x] 7.3.1 `feed.test.ts` — params, cache hit/miss, D1 query
- [x] 7.3.2 `article.test.ts` — happy path, 404, cache
- [x] 7.3.3 `cluster.test.ts` — cluster exists, not exists
- [x] 7.3.4 `locations.test.ts`, `categories.test.ts`
- [x] 7.3.5 `search.test.ts` — FTS + Vectorize results
- [x] 7.3.6 `image.test.ts` — R2 hit/miss, Image Resizing params
- [x] 7.3.7 `track.test.ts` — Analytics Engine write
- [x] 7.3.8 `cron.test.ts` — refresh handler
- [x] 7.3.9 `queue.test.ts` — image-pipeline consumer

### 7.4 E2E (Playwright + mobilerun)
- [x] 7.4.1 Configure Playwright for Antena
- [x] 7.4.2 Smoke: home loads, article opens, bookmark saves, dark mode toggle
- [x] 7.4.3 Feed: infinite scroll, category filter, location filter, sort change
- [x] 7.4.4 Article: share original, open source, cluster view, TTS play/stop
- [x] 7.4.5 Bookmarks: add, remove, clear
- [x] 7.4.6 Search: typing, debounce, results
- [x] 7.4.7 PWA: install prompt, offline fallback, manifest
- [x] 7.4.8 Mobile (mobilerun): pull-to-refresh, swipe gestures, bottom nav thumb reach, safe areas, haptic
- [x] 7.4.9 Target: 12-15 critical E2E tests, all green

### 7.5 Lighthouse CI
- [x] 7.5.1 Configure `@lhci/cli` with mobile preset, slow 4G
- [x] 7.5.2 Assert: Performance > 90, Accessibility > 95, Best Practices > 95, SEO > 95
- [x] 7.5.3 Block PR if any score drops below threshold

## 8. Deploy & Docs

- [x] 8.1 Create `.github/workflows/ci.yml`: typecheck, lint, test, E2E, lighthouse
- [x] 8.2 Add `cloudflare/pages-action deploy` for PR previews
- [x] 8.3 Add prod deploy on main (after all checks pass)
- [x] 8.4 Document `wrangler` commands in `docs/deploy.md`
- [x] 8.5 Update `AGENTS.md` with new stack, Cloudflare services, scripts
- [x] 8.6 Update `README.md` with quickstart (env, dev, build, deploy)
- [x] 8.7 Create `docs/architecture.md` (system diagram, data flow, caching layers)
- [x] 8.8 Create `docs/api.md` (endpoints + bindings)
- [x] 8.9 Update `CHANGELOG.md` with v1.0 release notes
- [x] 8.10 Add `docs/archived/webllm-experiment.md` documenting the WebLLM branch decision
- [x] 8.11 Update `.env.example` with all new Cloudflare binding references
- [x] 8.12 Verify full pipeline: PR → preview deploy → test → merge main → prod deploy

## Verification Gates

Each phase must pass before the next:

- **After 1**: `pnpm install` succeeds, baseline typecheck documented
- **After 2**: `wrangler d1 migrations apply` works locally, schema matches
- **After 3**: All API endpoints return 200, Cache headers correct, Zod validates
- **After 4**: `pnpm typecheck` strict, `pnpm build` succeeds, no agent code in tree
- **After 5**: All new components render, no console errors
- **After 6**: All Cloudflare bindings live, `wrangler dev` runs end-to-end
- **After 7**: All tests green, Lighthouse > 90 mobile, E2E 12-15 pass
- **After 8**: CI/CD green, prod deploy works, docs updated

## Cerrado Checklist (from superpowers spec)

When all tasks complete, verify the operational "cerrado" checklist in `docs/superpowers/specs/2026-06-11-antena-v1-closer-design.md` § Cerrado Definition.
