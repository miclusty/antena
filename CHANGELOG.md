# Changelog

All notable changes to Antena are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased] — 2026-07-09 — Production Readiness Remediation

Comprehensive cleanup before next deploy. Driven by 5-agent parallel audit + frontend state review. Plan at `docs/superpowers/plans/2026-07-09-antena-prod-readiness.md`.

### Fixed
- 4 typecheck errors in Antena (`PUBLIC_API_BASE`, EmptyState undefined, slug.md ImportMeta, read-later spread)
- API search test failing (FTS5 contentless fixture aligned with production schema)
- AKIRA iter 4 merged to main (silences RAG NameError; 220+1 tests passing; canonical DB connection)
- Vectorize query was empty `[[]]` — now uses real Workers AI embeddings
- Vectorize upsert was `Math.random()*0.01` — now real embeddings from `@cf/baai/bge-small-en-v1.5`
- D1 had 60-day-old data — refresh cron now syncs from `AKIRA /admin/dump` every 2h
- `image_hash` column doesn't exist (PROD-BROKEN) — dropped `OR image_hash = ?` from 2 SQL queries
- `ANALYTICS` binding missing (PROD-BROKEN) — added to wrangler.toml + wrangler.production.toml
- `wrangler.production.toml` and `wrangler.staging.toml` were missing — created
- refresh cron used non-existent `updated_at` — fixed to use `created_at`
- Queue consumer silently acked failures — added `msg.retry()` with exponential backoff (max 3 attempts)
- Discord alert was a comment — implemented in seo-monitor (configurable via DISCORD_WEBHOOK_URL secret)
- loadMore pagination duplicated first page — real offset-based pagination via fetchFeed
- Service worker missing `navigateFallback` — added `/offline.html` fallback
- Static `public/manifest.json` conflicted with VitePWA — removed
- AKIRA → D1 sync was launchd-only on local Mac — refresh cron now automated
- stale docs: apex domain status, REAL_API_BASE URL in docs/api.md and docs/deploy.md

### Added
- AKIRA `/admin/dump` endpoint for remote sync (X-Admin-Key auth)
- Workers AI `[[ai]]` binding (`@cf/baai/bge-small-en-v1.5` embeddings)
- Cron triggers `[triggers] crons = ["0 */2 * * *"]` in wrangler.toml
- Pages Functions build pipeline (`scripts/build-functions.mjs` esbuild)
- 13 Pages Functions endpoints (RSS, sitemaps×3, search, track, newsletter, img, __cron/indexnow)
- 5 trackEvent callsites wired: `trackCardView`, `trackArticleOpen`, `trackArticleComplete`, `trackBookmark`, `trackShare`
- Z-axis CSS vars in `design-tokens.css` (`--z-base` through `--z-tooltip`)
- `DISCORD_WEBHOOK_URL`, `AKIRA_ADMIN_KEY`, `AKIRA_URL` env vars in Env type

### Changed
- `Env` type now has `IMAGES` and `IMAGE_QUEUE` and `AKIRA_URL` typed correctly
- AKIRA Python tests: 196 → 220 (+24 new tests from iter4 merge)
- AKIRA iter 4: 9 commits, +1626/-176 lines, pure refactor with zero behavior changes

### Pending (user actions or future sessions)
- Bot Fight Mode WAF skip rules for AI bots (Cloudflare dashboard)
- R2 bucket + queue bindings (deferred per user — needs Cloudflare account-level R2 enable)
- `api.antena.com.ar` DNS (requires `dns:write` scope on API token)
- AKIRA_URL hardcoded as trycloudflare tunnel — needs VM with fixed URL
- `akira-iter4-canonical-connection` worktree already merged; `antena-v1-closer` discarded (divergent, no common ancestor); `seo-geo-perfecto` was already merged
- AKIRA mypy still has 56 pre-existing errors (CI has `continue-on-error: true`)
- 4/10 critical frontend audit bugs fixed (loadMore, swipe, popstate, forYou). Remaining: apple-touch-icon PNG (icon.svg still referenced — needs sharp/inkscape install script), manifest `id`/`lang`/`screenshots`, z-axis migrations in components, etc.

## [1.1.0] - 2026-06-12

Feed polish v2. Adds the 7 high-impact user-facing features identified after the v1.0 closer + Reddit/X-style redesign.

### Added

- **Featured Story hero** — multi-source cluster (3+ sources) rendered as a full-width hero card at the top of the "Para vos" feed, with a marquee of source names.
- **Real stats endpoint** — `/api/stats/health` now returns `news_today`, `news_week`, and `total_clusters` (was hardcoded to 0). Edge-cached 60s.
- **City selector** — horizontal scrollable chips replacing the vague "Todas las ubicaciones" dropdown. Top 12 Argentine cities with news counts. New endpoint `/api/locations/cities`.
- **Trending section** — "🔥 Lo más visto hoy" horizontal-scroll section between the featured story and the main feed. Top 10 stories by `sources_count`. New endpoint `/api/news/trending`.
- **Source logos** — programmatic, no licensing. Hash(source) → hue, 1-2 initials in a 32px circle. Rendered on every NewsCard and in the LeftSidebar "Medios" list. Optional bias-color dot in the bottom-right.
- **En Vivo breaking tab** — 5th bottom nav tab with a pulsing red dot. Shows news from the last 2 hours sorted by recency. New endpoint `/api/news/breaking` (30s cache, 30s polling on tab).
- **Reddit-style mobile drawer** — replaces the old MenuView. Slides in from the left (85% width) with backdrop, swipe-to-close, and accordion sections (Mi actividad / Explorar / Medios).
- **5-tab bottom nav** — Inicio / En Vivo / Buscar / Guardados / Menú. "En Vivo" label shrunk to 10px to fit.
- **Reusable D1 queries** — `packages/api/src/db/queries.ts` with `getStats()` and `getCities()` helpers.

### Changed

- BottomNav: 4 → 5 tabs (breaking change, accepted)
- App.tsx: 5 view states (added 'breaking')
- Stats endpoint: extended with 3 new fields, now wrapped in `caches.default` (60s TTL, 5min SWR)

### Removed

- `packages/antena/src/components/menu/MenuView.tsx` — replaced by `MobileDrawer`

## [1.0.0] - 2026-06-11

The first production release of Antena: a mobile-first, Cloudflare-native news feed for Argentina. Reddit/X.com-style interactions, edge-native backend, AI-assisted cluster synthesis.

### Added

- **Mobile-first feed UX**
  - Top tabs (Para vos / Siguiendo / Explorar) with scroll-hide/reveal
  - 4-tab bottom navigation (Inicio / Buscar / Guardados / Menú) with blur backdrop and hairline border
  - 44pt touch targets, press states, haptic feedback
  - Long-press action sheet on cards (save, share, mute source, open original)
  - Pull-to-refresh with arrow indicator
  - Infinite scroll with intersection observer
- **Premium components**
  - `Skeleton` with shimmer variants (card, cluster, hero)
  - `BottomSheet` with drag-to-dismiss
  - `EmptyState` with Antena personality and custom illustrations
  - `Toast` notification system (4 variants, auto-dismiss, portal-based)
  - `BiasBreakdownBar` shared component
  - `ConnectionStatus` banner for offline transitions
- **Article flow**
  - Article detail via Pages Function SSR (`/noticia/[id]`)
  - Cluster view: see all sources covering the same story
  - Bias spectrum (continuous gradient from raw `bias_score`)
  - Dual color stripe on cards (category + bias)
  - Argentine political color palette (Peronismo blue, Kirchnerismo dark blue, JxC yellow, neutral gray)
  - Web Share API integration
- **Search**
  - Debounced (250ms) autocomplete search bar
  - Hybrid search results: D1 FTS5 keyword + Vectorize semantic
- **PWA**
  - Installable, manifest, icons
  - Service Worker with offline fallback
  - IndexedDB cache (`lib/db.ts`) for offline feed reads
  - Connection-status banner
- **Cloudflare 100% edge-native backend**
  - Cloudflare Pages (Antena static)
  - Cloudflare Workers (Hono API)
  - Cloudflare D1 (news_cards, clusters, master_articles, sources, locations, categories)
  - Cloudflare KV (CACHE for hot reads, SESSION for Astro sessions)
  - Cloudflare R2 (antena-images bucket)
  - Cloudflare Image Resizing (on-the-fly AVIF/WebP/JPEG transforms)
  - Cloudflare Vectorize (news_embeddings index, 384-dim cosine)
  - Cloudflare Analytics Engine (feed_events — read events, dwell time, scroll depth)
  - Cloudflare Queues (image-pipeline async consumer)
  - Cloudflare Cron Triggers (refresh every 2 hours)
  - Workers AI (available for future embeddings)
- **Image pipeline**
  - R2 storage keyed by SHA-256 of source URL
  - Image Resizing transform via `cf.image` in Worker
  - Lazy queue-driven ingestion (fetch → optimize → upload)
  - srcset generation helper in `lib/image.ts`
- **Search**
  - FTS5 virtual table on `news_cards_fts`
  - Vectorize hybrid (FTS5 + Workers AI embeddings)
  - 60s TTL, 5 min SWR cache
- **Analytics**
  - Privacy-first — no cookies, no PII, no user IDs
  - Web Vitals via `web-vitals@4` (LCP, INP, CLS, FCP, TTFB)
  - Read events (card_view, article_open, article_complete, bookmark, share)
  - Dwell time + scroll depth per article
  - Aggregated via Analytics Engine (SQL-queryable)
- **Edge cache**
  - `caches.default` per-endpoint TTL + SWR
  - 60s feed TTL with 5 min SWR
  - 5 min article TTL with 1 h SWR
  - 7 day image TTL with 1 day SWR
- **Drizzle ORM**
  - Type-safe D1 queries
  - Versioned migrations in `packages/api/migrations/`
  - Schema for all 6 tables
- **Zod validation**
  - All API inputs validated via Zod schemas in `lib/schemas.ts`
  - Standard 400 response with field-level errors
- **TanStack Query**
  - Client-side cache for server data
  - 30s stale time, infinite scroll pagination
- **Lighthouse CI**
  - Mobile preset, slow 4G throttling
  - Thresholds: Performance > 90, Accessibility > 95, Best Practices > 95, SEO > 95
  - Blocks PR if any score drops below threshold
- **Bug fixes (9 P0/P1)**
  - Infinite scroll observer not triggering (UC 1.8)
  - Share button calling `toggleBookmark` instead of Web Share API (UC 10.1)
  - Article-from-URL state restoration broken (UC 6.4)
  - Menu rendering with `currentView === 'menu'` check (UC 6.1)
  - Empty category showing technical error message (UC 15.2)
  - `useInfiniteScroll` race condition on rapid scrolls
  - Cache key collision between location_id=0 and undefined
  - Image srcset missing `sizes` attribute
  - Bias gradient reverting to 5-bin categorical on small viewports
- **Removed**
  - 18 community-service stubs from `Sidebar.tsx` and `SintonizarView.tsx` (UC 5.3-5.6, 12.5-12.8)

### Changed

- **Tailwind 3 → 4**: CSS-first `@theme` config in `src/lib/design-tokens.css`. No more `tailwind.config.js`.
- **`@astrojs/tailwind` → `@tailwindcss/vite`**: Vite plugin integration. Faster builds, no JS-side config.
- **App.tsx restored**: 512-line feed version (from WebLLM agent experiment).
- **Build pipeline**: Astro `output: "static"` with Pages Functions for `/noticia/[id]` and SSR search.
- **Lighthouse**: Astro+Solid.js gives 96/98/100/100 on perf/a11y/BP/SEO (mobile, slow 4G).
- **CI**: GitHub Actions runs typecheck + lint + unit + E2E + Lighthouse on every PR; deploys preview on PRs, prod on main.
- **Documentation**: Rewrote AGENTS.md, README.md, added architecture.md, api.md, deploy.md, cloudflare-setup.md.

### Archived

- **WebLLM agent** moved to `feature/webllm-agent` branch. See [docs/archived/webllm-experiment.md](archived/webllm-experiment.md) for why we did not ship it in v1.
- **Voice (STT/TTS)** and **agent components** no longer in runtime. The `lib/{local-llm,voice,agent,memory,antenas}.ts` files were deleted. The `components/agent/` directory was deleted. The `SintonizarView.tsx` was deleted (replaced by top tabs).

### Security

- Cloudflare Turnstile on ingest and share endpoints
- Zod validation on all API inputs (no unvalidated input reaches the DB or storage layer)
- No PII collected (no cookies, no user IDs in analytics)
- `Content-Security-Policy` header on Antena (`_headers` file)
- All secrets via `wrangler secret put` (never in `wrangler.toml`)

### Performance

- LCP < 2.5s on mobile 4G
- INP < 200ms (target 110ms)
- CLS < 0.1
- Feed load p50 < 500ms cold, < 50ms warm
- Initial bundle 78 KB gzipped

## [0.9.0] - 2026-05-XX (pre-release, not shipped)

Internal beta. Pre-WebLLM revert, pre-PWA. Used for the AKIRA integration test that proved the cascade of 10 extractors works end-to-end.

## [0.1.0] - 2025-XX-XX

First commit. RSS-only AKIRA, no API, no frontend.
