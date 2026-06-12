# Antena v1 Closer — Design Spec

**Date:** 2026-06-11
**Status:** Approved
**Scope:** Close the design of Antena as a mobile-first, Cloudflare-native, Reddit/X.com-style news feed. Archive the WebLLM agent branch.

---

## Overview

Antena is a hyperlocal Argentine news aggregator. The backend (AKIRA) extracts and clusters news from 10 sources, scoring political bias. The frontend (Antena) is a mobile-first, edge-native feed that exposes the AKIRA pipeline as a Reddit/X.com-style experience.

**This spec closes the design.** It picks one direction (X/Reddit hybrid, mobile-first, Cloudflare 100%), removes the WebLLM agent attempt, and defines what is in scope for v1.0 and what is explicitly out.

**Guiding principles:**
- **Mobile-first.** Every decision is evaluated by thumb reach, single-handed use, and outdoor readability.
- **Cloudflare-native.** No origin server. Pages, Workers, D1, KV, R2, Image Resizing, Cache API, Vectorize, Analytics Engine, Queues, Cron Triggers, Pages Functions.
- **Beautiful by default.** Every animation, every pixel, every haptic must earn its place.
- **Closed, not open.** YAGNI. Community services, accounts, comments, voice agent: all out. Each one is a v2/v3 decision, not a v1 feature.

---

## Goals

1. Restore the previous Reddit/X.com feed (`App.tsx` 512-line version) as the canonical frontend.
2. Polish it for mobile excellence: top tabs + bottom nav, premium animations, 44pt touch targets, dark mode that is not just inverted.
3. Move the WebLLM agent to a separate branch (`feature/webllm-agent`) and out of the runtime.
4. Integrate 9 additional Cloudflare services that already exist on the platform but were not used: R2, Image Resizing, Cache API, Analytics Engine, Vectorize, Queues, Cron Triggers, Pages Functions, Turnstile.
5. Fix the 9 P0/P1 bugs and delete the 18 community-service stubs.
6. Define "cerrado" as an operational checklist (see Cerrado Definition section below).

---

## Non-Goals (v1 explicit out-of-scope)

| Feature | Reason | Where it lives |
|---------|--------|----------------|
| WebLLM agent | Not edge-native, not mobile-first | Branch `feature/webllm-agent` (archived) |
| Voice (STT/TTS in agent) | Same | Branch `feature/webllm-agent` |
| User accounts / auth | No auth = no comments/reactions real | v2 (Cloudflare Access) |
| Comments | No auth | v2 |
| Reactions persistence | No auth | v2 |
| Community services (Cortes, Farmacias, Transporte, Alertas) | No data sources | v3 (partners needed) |
| Push notifications | Permission friction on iOS | v2 (opt-in) |
| Modo Mate TTS (polished UI) | Not core | Keep simple, no special UI |
| i18n | Spanish only for v1 | v2 |
| RSS reader / saved searches | Not in scope | v2 |
| Newsletter digest | Email service | v3 (Cloudflare Email Workers) |

---

## Architecture

### System (unchanged + new)

```
                          Cloudflare Edge (300+ POPs)
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
   ┌────▼─────┐                ┌───────▼────────┐             ┌───────▼────────┐
   │  Pages   │                │ Pages Function │             │  API Worker   │
   │ (Astro)  │                │  (SSR Article) │             │   (Hono)      │
   │  static  │                │ /noticia/[id]  │             │  /api/*       │
   └────┬─────┘                └───────┬────────┘             └───────┬────────┘
        │                              │                              │
        │                              │     ┌────────────────────────┤
        │                              │     │                        │
        │                    ┌─────────▼─────▼───┐             ┌───────▼────────┐
        │                    │  Image Resizing  │             │  Cache API + KV│
        │                    │   /img/:hash     │             │   (edge cache) │
        │                    └─────────┬────────┘             └───────┬────────┘
        │                              │                              │
        │                              ▼                              ▼
        │                    ┌──────────────────┐            ┌──────────────────┐
        │                    │  R2 (imágenes)   │            │   D1 (SQLite)    │
        │                    │  antena-images   │            │  news_cards etc  │
        │                    └──────────────────┘            └──────────────────┘
        │                                                          ▲
        │                    ┌──────────────────┐                  │
        └────────────────────┤  Analytics Engine│──────────────────┘
                             │  (read events)   │
                             └──────────────────┘
                                       ▲
                             ┌─────────┴─────────┐
                             │  Cron Triggers    │
                             │  (cada 2h)         │
                             │  + Queues         │
                             │  (image pipeline) │
                             └───────────────────┘
```

### Data flow (feed)

```
App.tsx (orchestrator)
   ├─ Header (sticky, search inline, top tabs)
   │     └─ SearchBar (autocomplete, debounce 250ms)
   ├─ FeedTabs (Para vos / Siguiendo / Explorar)
   │     └─ changes activeTab signal → triggers resetFeed()
   ├─ Main column (scrollable, virtualized when > 50 items)
   │     ├─ FeaturedCluster (first item if cluster_id && sources_count >= 3)
   │     ├─ For each NewsCard
   │     └─ InfiniteScroll sentinel (IntersectionObserver, rootMargin: 200px)
   ├─ RightSidebar (lg+, bias del día, ruido filtrado, mis antenas)
   └─ BottomNav (md-, Inicio/Buscar/Guardados/Menú)
        └─ changes currentView
```

### State signals (App level)

- `currentView: 'feed' | 'article' | 'search' | 'bookmarks' | 'menu'`
- `activeTab: 'para-vos' | 'siguiendo' | 'explorar'`
- `activeCategory: string | null`
- `activeLocation: number | null`
- `sort: 'hot' | 'new' | 'top' | 'controversial'`
- `feed: { items, offset, hasMore, loading }` (resource pattern)
- `selectedNews: NewsItem | null` (for article view)
- `urlState` (synced with query params via `lib/urlState.ts`)

### Cache strategy

- Service Worker cache-first for assets + `/api/news/feed?*` with 5min TTL
- IndexedDB (`lib/db.ts`) for bookmarks + reading history + read state
- LocalStorage only for prefs (theme, sort, activeLocation)
- Cloudflare Cache API at the edge (see API section)

---

## Components

### What stays (with polish)

| Component | Change |
|-----------|--------|
| `NewsCard.tsx` | Refine touch targets (44pt), press state, haptic, long-press → action sheet |
| `BottomNav.tsx` | Refine to 4-tab (Inicio/Buscar/Guardados/Menú), blur backdrop, hairline border |
| `Header.tsx` | Refine for inline search + top tabs coordination |
| `ArticleDetail.tsx` | Refine with SSR, OG tags, share original |
| `ClusterView.tsx` | Keep, polish |
| `BookmarksView.tsx` | Keep, persist in IndexedDB |
| `LocationSelector.tsx` | Keep |
| `RightSidebar.tsx` | Refine: useful on desktop, hidden on mobile (already `hidden lg:flex`) |
| `FeedTabs.tsx` | Connect (was mock), add scroll-hide/reveal on scroll |
| `lib/db.ts` (IndexedDB) | Keep for offline |
| `lib/haptic.ts` | Keep, expand table of interactions |
| `lib/urlState.ts` | Keep |
| `lib/scroll.ts` | Keep |
| `lib/hooks.ts` (useInfiniteScroll) | **Fix observer not triggering** |
| `design-tokens.css` | Refine (see Visual section) |

### What dies

| Component | Reason | Action |
|-----------|--------|--------|
| `lib/local-llm.ts` (WebLLM) | Not edge-native, not mobile-first | Move to `feature/webllm-agent` branch |
| `lib/voice.ts` (STT/TTS agent) | Same | Branch |
| `components/agent/*` (EmptyState, AgentCanvas, BiasSpectrum, MessageBlock, VoiceButton) | Replaced by feed | Branch |
| `lib/agent.ts` | Same | Branch |
| `lib/memory.ts` (bias tracking) | No agent target | Replace with `lib/analytics.ts` (Analytics Engine) |
| `lib/antenas.ts` | No agent target | Branch |
| `components/categories/SintonizarView.tsx` | Replaced by top tabs | **Delete** |
| Community buttons (Cortes/Farmacias/Transporte/Alertas) | No data, no scope | **Delete** |
| ModoMate (TTS polished UI) | Not core | Keep simple, no special UI |
| Sintonizar grid view (UC 5.1) | No route needed | **Delete** |
| Use case tests (E2E Playwright, 72 UCs) | Some refer to dead features | Rewrite suite for v1 closed |

### New components / files

- `src/lib/cloudflare.ts` — typed bindings for Pages Functions + D1 + R2 + KV + Vectorize + Analytics Engine
- `src/lib/image.ts` — helper for `<img>` with srcset generated from `/img/:hash`
- `src/lib/cache.ts` — Cache API wrappers
- `src/lib/analytics.ts` — beacons to Analytics Engine
- `src/lib/search.ts` — Vectorize + FTS wrapper
- `src/components/common/Skeleton.tsx` — premium shimmer
- `src/components/common/BottomSheet.tsx` — bottom-up modal reusable
- `src/components/common/EmptyState.tsx` — improve illustrations + copy
- `src/functions/api/track.ts` — Analytics beacon endpoint
- `src/functions/api/search.ts` — Search SSR endpoint
- `packages/api/src/routes/image.ts` — Image resizing worker endpoint
- `packages/api/src/routes/search.ts` — Search endpoint
- `packages/api/src/crons/refresh.ts` — Cron trigger handler
- `packages/api/src/queues/image-pipeline.ts` — Queue consumer

---

## Mobile Excellence (Section 2 of design review)

### Card hierarchy

```
┌─────────────────────────────────────────┐
│ ● Política · La Voz · 2h · Trending 3  │  ← meta row, 13px
│                                         │
│  Título de la noticia en dos líneas     │  ← 19px bold, lh 1.25
│  con resumen debajo en una línea        │  ← 15px secondary, line-clamp 2
│                              ┌────────┐ │
│                              │  IMG   │ │  ← thumb 130x85, radius 12
│                              │  85px  │ │
│                              └────────┘ │
│                                         │
│  ⬆ 1.2k  ⬇   💬 47   🔁 12   ⭐  🔗  │  ← actions row, haptic on tap
└─────────────────────────────────────────┘
   ↑ hairline divider 0.5px entre cards
```

- Touch targets ≥ 44pt (Apple HIG)
- Press state: `active:scale-[0.98]` + subtle ripple
- Long-press 600ms → action sheet (share, bookmark, original, cluster)

### Top tabs (X/Instagram style)

- Sticky bajo el header
- Scroll-hide on scroll down, scroll-reveal on scroll up (200ms)
- Active: bold 600, `--text-primary`
- Inactive: regular 500, `--text-tertiary`
- Underline: 2px `--accent`, width = text width, scale-x from center
- "+" al final → bottom sheet "Manage feeds" (future, placeholder)

**Tab semantics (no auth, v1):**
- **Para vos** — feed predeterminado, mix de las fuentes suscriptas (todas en v1). En v2 usará Analytics Engine para personalizar.
- **Siguiendo** — feed filtrado a las fuentes marcadas como "siguiendo" (lista en localStorage, sin auth). Vacío en primer uso → empty state "Empezá siguiendo fuentes desde el sidebar o el detalle de cada nota".
- **Explorar** — feed sin filtros, todas las fuentes, todas las categorías. Para descubrir.

Sin auth, "Siguiendo" no es personalizado por usuario sino por device (la lista se guarda en localStorage con sync opcional a D1 anónimo en v2).

### Bottom nav (native)

- 56pt + safe area bottom inset
- Background: `--bg-elevated` con **backdrop-blur 20px** cuando hay contenido debajo
- Border top: 1px opacity 0.08 (hairline)
- Active tab: ícono con `FILL 1` + label en `--accent`
- Tap: `active:scale-90` 80ms + haptic light

### Pull-to-refresh (custom)

- Indicador Antena con el logo circular girando
- Threshold 80px, trigger a 100px
- Haptic medium al disparar
- Spinner mientras carga, success haptic al completar
- Background: `--bg-elevated` semi-transparente con blur

### Skeleton loading

- Shimmer animation (linear gradient moving left→right, 1.5s loop)
- Skeletons específicos por tipo de contenido (no genérico):
  - Card skeleton: meta + 2 líneas + thumb a la derecha
  - Cluster hero: bloque completo con imagen y badge
  - Empty category: ilustración SVG con copy cálido
- Sin spinners de "Cargando..." en zonas de scroll

### Transiciones entre vistas

- Feed → Article: View Transitions API donde esté disponible, fallback slide-from-right 250ms cubic-bezier
- Article → Cluster: bottom sheet (drag-to-dismiss con velocity)
- Tap en imagen: hero animation a fullscreen viewer con pinch-to-zoom
- Cambio de tab: cross-fade 150ms

### Haptic feedback (no abuse)

| Action | Haptic |
|--------|--------|
| Tap en card | `selection` (light) |
| Upvote / downvote | `impactLight` |
| Bookmark toggle | `notificationSuccess` |
| Pull-to-refresh trigger | `impactMedium` |
| Share success | `notificationSuccess` |
| Error genérico | `notificationError` |
| Cambio de tab | `selection` |

Respeto: no haptic en scroll, no en cada render.

### Tipografía

- Display: **Syne 700/800**, tracking ajustado
- Body: **DM Sans 400/500**, line-height 1.5
- Meta: **DM Sans 500**, 13px, `--text-secondary`
- Time: **DM Sans 400**, 13px, `--text-tertiary`
- Mono: **JetBrains Mono 500**, 12px
- Escala: 11 / 13 / 15 / 17 / 19 / 22 / 28 / 36 (modular 1.250)
- Letter-spacing: -0.01em en headings, 0 en body, 0.02em uppercase en labels

### Color refinado

**Light mode:**
- `bg-base: #F7F5F2` (mantener)
- `bg-elevated: #FFFFFF`
- `border: rgba(26, 26, 26, 0.08)` (más sutil que gris plano)
- `text-primary: #1A1A1A`
- `accent: #F5A623` (mantener)
- `accent-glow: rgba(245, 166, 35, 0.15)` (focus rings)

**Dark mode (paleta propia, no invertida):**
- `bg-base: #0B0D12` (más profundo que el actual)
- `bg-elevated: #161922`
- `border: rgba(232, 230, 227, 0.08)`
- `text-primary: #E8E6E3`
- `accent: #F5A623` (mantener)
- `bias-oficialist: #6B9BD1`
- `bias-neutral: #8A8D97`
- `bias-oposicion: #E8B547`

Cross-fade 250ms en toggle de theme.

### Performance

- FCP < 1.2s, LCP < 1.8s, CLS < 0.05, INP < 150ms (mobile, slow 4G)
- Imágenes: `loading="lazy"`, AVIF con fallback WebP, srcset responsive (Cloudflare Image Resizing), LQIP blur-up
- Virtualization en feed cuando > 50 items
- Service Worker pre-cache shell + runtime cache `/api/news/feed` (TTL 5min, SWR)
- Fonts: `font-display: swap`, subset latin, preload critical 4 weights
- Critical CSS inline en `<head>`, resto async
- JS shell < 80KB gzipped

### Accesibilidad

- `prefers-reduced-motion`: desactiva animaciones decorativas
- `prefers-color-scheme: dark` soportado
- Contraste mínimo AA (4.5:1 texto, 3:1 grande)
- `aria-current="page"` en nav activo
- Skip-to-content link (existe en Layout.astro)
- Voice over: `aria-label` en íconos sin texto
- Touch targets 44pt+

### Gestures

- Swipe left en card → abrir cluster
- Swipe right en card → guardar bookmark
- Pull-down → refresh
- Pull-up al final → "Cargar más" (accesibilidad)
- Edge swipe back → iOS-style back gesture

### Empty / error states (personalidad)

- "No hay noticias" → ilustración antena + *"Hoy elDial está mudo. Volvé más tarde, o cambiá la frecuencia."*
- Error de red → botón "Reintentar" + mensaje claro
- API timeout → estado "modo offline" con datos cacheados (PWA)

---

## Cloudflare Integration (Section 3 of design review)

### Bindings (wrangler.jsonc)

```jsonc
{
  "name": "antena",
  "compatibility_date": "2025-01-01",
  "pages_build_output_dir": "./dist",
  "d1_databases": [{ "binding": "DB", "database_name": "antena", "database_id": "..." }],
  "kv_namespaces": [{ "binding": "CACHE", "id": "..." }],
  "r2_buckets": [{ "binding": "IMAGES", "bucket_name": "antena-images" }],
  "vectorize_indexes": [{ "binding": "VECTORS", "index_name": "news_embeddings" }],
  "analytics_engine_datasets": [{ "binding": "ANALYTICS", "dataset": "feed_events" }],
  "queues": { "producers": [{ "binding": "IMAGE_QUEUE", "queue": "image-pipeline" }] },
  "triggers": { "crons": ["0 */2 * * *"] }
}
```

### Image pipeline (R2 + Image Resizing)

```
GET /img/:hash?w=400&fmt=avif&fit=cover
  1. Si existe en R2 → devuelve
  2. Si no, busca source_url en D1, descarga, sube a R2
  3. Image Resizing transforma on-the-fly: AVIF si soporta, sino WebP, sino jpg
  4. Cache 1 año (immutable) + stale-while-revalidate
```

### Feed cache strategy

```typescript
// API Worker /api/news/feed
const cache = caches.default;
const cacheKey = new Request(`https://antena.internal/feed?${params}`, { method: "GET" });
let response = await cache.match(cacheKey);

if (!response) {
  response = await fetchFromD1(...);
  response.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  await cache.put(cacheKey, response.clone());
}
return response;
```

**Cache key hierarchy:**
- `feed:public:${cat}:${loc}:${sort}:${page}` (60s TTL, SWR 5min)
- `article:public:${id}` (5min TTL, SWR 1h)
- `cluster:public:${id}` (5min TTL)
- `user:${userId}:bookmarks` (no cache, JWT-auth)
- `search:${query}` (no cache, Vectorize direct)

### Vectorize (semantic + bias)

```sql
-- D1: news_cards ya tiene bias_score, category
-- Vectorize: índice de embeddings
CREATE VECTOR INDEX news_embeddings ON news_cards (embedding)
  WITH DIMENSION 384, METRIC 'cosine';
```

Uso: "Para vos" usa vector similarity para diversificar. Search: FTS + vector.

### Pages Functions (SSR article)

```typescript
// /noticia/[id].ts
export const onRequest: PagesFunction = async (ctx) => {
  const news = await ctx.env.DB.prepare(
    "SELECT * FROM news_cards WHERE id = ?"
  ).bind(ctx.params.id).first();
  
  if (!news) return new Response("Not found", { status: 404 });
  
  return ctx.render({ news });
};
```

Beneficio: Google ve la nota completa + OG tags, WhatsApp/Telegram previews hermosos.

### Analytics Engine (privacy-first)

```typescript
ctx.env.ANALYTICS.writeDataPoint({
  blobs: [news.id, category, source, userSegment],
  doubles: [dwellTime, scrollDepth],
  indexes: [userId || 'anon']
});
```

Sin cookies, sin PII, edge-processed. Alimenta:
- "Para vos" (lectura de usuarios similares)
- Hot ranking (engagement real)
- Sesgo del día (distribución agregada)

---

## Testing Strategy

### Pyramyd

```
                  ┌──────────┐
                  │   E2E    │   Playwright + mobilerun (12-15 tests)
                  └────┬─────┘
                  ┌────┴─────┐
                  │  API     │   wrangler + vitest-pool-workers (20-30)
                  └────┬─────┘
              ┌────────┴────────┐
              │  Componentes    │   @solidjs/testing-library (30-40)
              └────────┬────────┘
       ┌────────────────┴────────────────┐
       │         Unit (lib/)             │   vitest (50-70)
       └─────────────────────────────────┘
```

### Unit (lib/)

- `mappers.ts`, `urlState.ts`, `bias.ts`, `image.ts`, `cache.ts`, `scroll.ts`, `haptic.ts`

### Componentes

- `NewsCard`, `BottomNav`, `FeedTabs`, `ArticleDetail`, `BookmarksView`, `EmptyState`, `Skeleton`, `BottomSheet`

### API (vitest-pool-workers)

- `/api/news/feed`, `/api/news/:id`, `/api/news/:id/cluster`
- `/api/locations/tree`, `/api/categories`
- `/api/search`, `/api/track`
- `/img/:hash` (R2 hit/miss, Image Resizing params)
- Cron trigger handler
- Queue consumer

### E2E (Playwright + mobilerun)

- Smoke: home loads, article opens, bookmark saves, dark mode toggle
- Feed: infinite scroll, category filter, location filter, sort change
- Article: share original, open source, cluster view, TTS play/stop
- Bookmarks: add, remove, clear
- Search: typing, debounce, results
- PWA: install prompt, offline fallback, manifest
- Mobile-specific (mobilerun): pull-to-refresh, swipe gestures, bottom nav thumb reach, safe areas, haptic

### Lighthouse CI

- Performance > 90 (mobile, slow 4G)
- Accessibility > 95
- Best Practices > 95
- SEO > 95
- Block PR si baja

---

## Performance Budget

| Metric | Target | Hard limit |
|--------|--------|-----------|
| LCP | < 1.8s | < 2.5s |
| CLS | < 0.05 | < 0.1 |
| TBT | < 150ms | < 300ms |
| FCP | < 1.2s | < 1.8s |
| INP | < 150ms | < 250ms |
| TTFB | < 200ms (edge) | < 600ms |
| JS shell gzipped | < 60KB | < 80KB |
| CSS gzipped | < 20KB | < 30KB |
| Font payload | < 50KB | < 80KB |
| Card image | < 100KB (AVIF) | < 200KB |
| Total initial page weight | < 250KB | < 400KB |

---

## Deploy Strategy

### Environments

```
Local    → wrangler pages dev + wrangler dev
Preview  → PR abierto → <hash>.antena.pages.dev
Staging  → branch develop → antena-staging.pages.dev
Prod     → main → antena.com.ar
```

### CI/CD (`.github/workflows/ci.yml`)

```yaml
on: [pull_request, push]
jobs:
  test:
    - pnpm install
    - pnpm typecheck
    - pnpm lint
    - pnpm test
    - pnpm test:e2e
    - pnpm lighthouse --preset=mobile
  deploy-preview:
    if: pull_request
    - cloudflare/pages-action deploy --project=antena
  deploy-prod:
    if: push to main AND all checks pass
    - cloudflare/pages-action deploy --project=antena --branch=main
    - wrangler d1 migrations apply DB --env=production
    - wrangler vectorize create news_embeddings --env=production (idempotente)
    - wrangler r2 bucket create antena-images --env=production (idempotente)
```

### D1 migrations

```bash
wrangler d1 migrations apply DB --env=production --remote
```

Versionadas en `packages/api/migrations/`.

### Wrangler configs por env

- `wrangler.toml` (default dev)
- `wrangler.staging.toml`
- `wrangler.production.toml`

---

## Monitoring

| Capa | Herramienta | Métricas |
|------|-------------|----------|
| RUM | Cloudflare Web Analytics | Core Web Vitals, navegación, device |
| Server logs | Workers Logs (Tail) | Errores, latency, cache hit ratio |
| Custom events | Analytics Engine | Read events, dwell time, scroll depth |
| Errors | Workers Tail + Sentry (opcional) | Stack traces |
| Uptime | Cloudflare Health Checks | Endpoint health cada 30s |
| Alerts | Cloudflare Notifications | PagerDuty/Slack si error rate > 1% |

---

## "Cerrado" Definition (operational checklist)

### Funcionalidad core
- [ ] Feed carga con cache hit > 85%
- [ ] Infinite scroll funciona (5+ páginas)
- [ ] Top tabs Para vos/Siguiendo/Explorar cambian feed
- [ ] Filtros categoría/ubicación/sort funcionan
- [ ] Cards renderizan imagen (R2 + Image Resizing)
- [ ] Multi-source cluster pill "N fuentes" visible
- [ ] Acciones: bookmark, share, vote (visual, sin persist)
- [ ] Article detail SSR con OG tags
- [ ] Article cluster view muestra otras fuentes
- [ ] TTS play/stop en article
- [ ] Share abre Web Share API
- [ ] Bookmarks persisten (IndexedDB)
- [ ] Search funcional (FTS + Vectorize)
- [ ] Theme dark/light/auto con cross-fade
- [ ] PWA installable, offline fallback

### Mobile excellence
- [ ] Touch targets ≥ 44pt verificados
- [ ] Safe areas respetadas (notch, home indicator)
- [ ] Haptic en interacciones críticas
- [ ] Pull-to-refresh custom
- [ ] Swipe gestures (left=cluster, right=bookmark)
- [ ] Bottom nav con blur backdrop
- [ ] Skeletons con shimmer
- [ ] Empty states con personalidad
- [ ] prefers-reduced-motion respetado

### Cloudflare-native
- [ ] D1 migrations aplicadas
- [ ] R2 bucket configurado + image pipeline funcionando
- [ ] KV namespaces configurados
- [ ] Cache API en todos los endpoints
- [ ] Analytics Engine escribiendo
- [ ] Vectorize index creado
- [ ] Cron triggers scheduleados
- [ ] Pages Functions SSR para article
- [ ] Wrangler configs por env
- [ ] Web Analytics beacon activo

### Calidad
- [ ] Lighthouse mobile > 90 en perf/a11y/best/SEO
- [ ] TypeScript strict sin errores
- [ ] ESLint sin warnings
- [ ] 70%+ coverage en lib/ y componentes
- [ ] E2E suite verde (12-15 tests)
- [ ] 0 P0/P1 bugs abiertos (los 9 resueltos)
- [ ] Branch `feature/webllm-agent` archivado

### Documentación
- [ ] `docs/architecture.md` actualizado
- [ ] `docs/api.md` (endpoints + bindings)
- [ ] `docs/deploy.md` (paso a paso)
- [ ] `AGENTS.md` actualizado
- [ ] `README.md` con quickstart
- [ ] Changelog con v1.0

---

## Risk & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| WebLLM branch rot | Loss of experimental work | Tag commit before moving, document in `docs/archived/` |
| D1 read latency at edge | Slow first byte | Use Cache API aggressively, replicas when available |
| R2 egress costs | Operational | Image Resizing + AVIF reduces bandwidth by 70% |
| Vectorize cold start | Slow first search | Cron pre-warms index cada 2h |
| TTS browser support | Inconsistent | Fallback a solo TTS sin UI especial |
| PWA iOS quirks | Limited install | Test in mobilerun, document known limitations |
| Cron trigger limits | Free tier 5M/month | Use sparingly, batch operations |

---

## Out of Scope (recap)

Closed in v1: WebLLM agent, voice, accounts/auth, comments, persistent reactions, community services, push notifications, polished ModoMate UI, i18n, RSS reader, newsletter.

Each is a documented v2/v3 decision, not a v1 feature.

---

## References

- Previous design: `docs/superpowers/specs/2026-04-29-antena-cosmos-design.md` (superseded)
- Use case report: `docs/antena-use-cases/reporte-final.md`
- AKIRA config: `packages/akira/config.py`
- API routes: `packages/api/src/routes/*.ts`
- Design tokens: `packages/antena/src/lib/design-tokens.css`
- Layout: `packages/antena/src/layouts/Layout.astro`
