# Spec: antena-v1-closer

## Purpose

Define the v1.0 closed state of Antena: a mobile-first, Cloudflare-native, Reddit/X.com-style news feed. The WebLLM agent experiment is archived. The feed is restored, polished for mobile excellence, and integrated with the full Cloudflare platform.

## ADDED Requirements

### Requirement: Mobile-First Feed

The system SHALL provide a mobile-first Reddit/X.com-style feed optimized for single-handed thumb reach, outdoor readability, and native feel.

#### Scenario: User opens the home page
- GIVEN a user opens `/` on a mobile device (≤ 768px)
- WHEN the page loads
- THEN the user sees:
  - A sticky header with search and brand
  - Top tabs: "Para vos", "Siguiendo", "Explorar" (sticky below header)
  - A vertical feed of news cards
  - A bottom nav with 4 tabs: Inicio, Buscar, Guardados, Menú
  - Safe area insets respected (notch, home indicator)
- AND First Contentful Paint < 1.2s
- AND Largest Contentful Paint < 1.8s

#### Scenario: User taps a news card
- GIVEN a feed is visible
- WHEN the user taps a card
- THEN:
  - Haptic feedback fires (`selection` light)
  - The article detail view opens (slide-from-right 250ms)
  - URL updates to `?view=article&id=...`
  - Card is marked as read (in IndexedDB)

#### Scenario: User scrolls down
- GIVEN the feed is visible
- WHEN the user scrolls down past the visible cards
- THEN:
  - Top tabs hide (scroll down)
  - More cards load automatically via infinite scroll (IntersectionObserver, rootMargin 200px)
  - Loading skeleton appears briefly before real content

#### Scenario: User scrolls up
- GIVEN top tabs are hidden
- WHEN the user scrolls up
- THEN top tabs reveal (smooth 200ms transition)

#### Scenario: User pulls down to refresh
- GIVEN the feed is at the top
- WHEN the user pulls down past threshold (80px, trigger at 100px)
- THEN:
  - Antena logo spinner appears
  - Haptic medium fires
  - Feed refetches
  - Success haptic on completion

### Requirement: Card Hierarchy

The system SHALL render news cards with the following visual hierarchy optimized for scannability on small screens.

#### Scenario: Card visual structure
- GIVEN a news card is rendered
- THEN the card shows:
  - **Meta row** (top, 13px): category dot + name, source name, time ago, "Trending" badge if `sources_count >= 5`
  - **Title** (19px bold, line-height 1.25, line-clamp 2)
  - **Summary** (15px, line-clamp 2, `--text-secondary`)
  - **Thumbnail** (130x85px, radius 12, lazy-loaded, AVIF preferred)
  - **Multi-source pill** (only if `sources_count > 1`): "N fuentes" with accent dot
  - **Actions row** (44pt touch targets): upvote, downvote, comments, repost, bookmark, share
  - **Hairline divider** (0.5px, `--border`) between cards

#### Scenario: Tap target compliance
- GIVEN any interactive element on a card
- THEN the touch target SHALL be ≥ 44x44pt (Apple HIG)

#### Scenario: Long-press on card
- GIVEN a card is visible
- WHEN the user long-presses for 600ms
- THEN a bottom sheet appears with actions: Compartir, Guardar, Abrir en fuente, Ver cluster

### Requirement: Bottom Nav

The system SHALL provide a 4-tab bottom navigation: Inicio, Buscar, Guardados, Menú.

#### Scenario: Bottom nav structure
- GIVEN the bottom nav is visible (mobile, non-article view)
- THEN:
  - Height: 56pt + safe area bottom inset
  - Background: `--bg-elevated` with `backdrop-blur 20px` over content
  - Border top: 1px opacity 0.08 (hairline)
  - Active tab: filled icon + label in `--accent`
  - Inactive: outlined icon + label in `--text-tertiary`
  - Tap: `active:scale-90` 80ms + haptic light (`selection`)

#### Scenario: Tab change
- GIVEN bottom nav is visible
- WHEN the user taps a tab
- THEN the active state updates, URL syncs, content cross-fades (150ms)

### Requirement: Top Tabs (Para vos / Siguiendo / Explorar)

The system SHALL provide 3 top tabs above the feed.

#### Scenario: Top tab semantics (no auth in v1)
- **Para vos**: default feed, mix of all subscribed sources
- **Siguiendo**: filtered to sources in localStorage "followed" list. Empty on first use → empty state.
- **Explorar**: unfiltered, all sources, all categories

#### Scenario: Tab visual
- Sticky below header
- Scroll-hide on scroll down, scroll-reveal on scroll up (200ms)
- Active: bold 600, `--text-primary`
- Inactive: regular 500, `--text-tertiary`
- Underline: 2px `--accent`, width = text width, scale-x from center animation

### Requirement: Article Detail with SSR

The system SHALL serve article pages via Pages Functions SSR for SEO and share previews.

#### Scenario: Article SSR
- GIVEN a user navigates to `/noticia/:id`
- WHEN the page is requested
- THEN a Pages Function:
  - Fetches the article from D1
  - Renders the HTML with full OG meta tags (title, image, description, twitter:card)
  - Returns cached HTML (5min TTL, 1h SWR)

#### Scenario: Article UI
- GIVEN an article is open
- THEN the user sees:
  - Back button (returns to feed, restores scroll)
  - Title (large display font)
  - Image (hero, with caption)
  - Source name + bias indicator
  - Body text (reading mode friendly)
  - "Leer en fuente original" button (opens source URL in new tab)
  - Cluster view: list of other sources covering the same story
  - TTS play/stop button (uses Web Speech API)
  - Share button (uses Web Share API, falls back to clipboard)
  - Bias breakdown bar

### Requirement: Bookmarks

The system SHALL persist user bookmarks in IndexedDB for offline access.

#### Scenario: Bookmark toggle
- GIVEN a news card is visible
- WHEN the user taps the bookmark button
- THEN:
  - Haptic `notificationSuccess`
  - Bookmark is added/removed in IndexedDB
  - Icon updates immediately (optimistic update)
  - Toast confirmation

#### Scenario: Bookmarks view
- GIVEN the user navigates to `/bookmarks`
- THEN the user sees their saved articles, sorted by save date desc
- AND can remove individual bookmarks
- AND can clear all bookmarks (with confirm)
- AND sees an empty state with copy "No tenés notas guardadas. Tocá ⭐ en cualquier nota para guardarla."

### Requirement: Search

The system SHALL provide full-text + semantic search via Cloudflare Vectorize + D1 FTS5.

#### Scenario: Search input
- GIVEN the user is on any page
- WHEN the user taps the search icon
- THEN an inline search bar appears (debounce 250ms)
- AND as the user types, suggestions appear

#### Scenario: Search results
- GIVEN the user submits a query
- THEN:
  - The query is sent to `/api/search?q=...`
  - FTS5 (lexical) + Vectorize (semantic) results are merged and ranked
  - Results render in the same card format as the feed
  - Empty state: "No encontramos nada. Probá con otras palabras."

### Requirement: Theme (Dark / Light / Auto)

The system SHALL support three theme modes: dark, light, auto (system preference).

#### Scenario: Theme toggle
- GIVEN the user is in the Menu view
- WHEN the user selects a theme
- THEN:
  - `data-theme` attribute updates on `<html>`
  - Cross-fade transition 250ms
  - Preference saved to localStorage

#### Scenario: Auto theme
- GIVEN the user selected "auto"
- THEN the theme follows `prefers-color-scheme: dark/light` system preference
- AND changes dynamically if the user toggles their OS theme

### Requirement: PWA Install & Offline

The system SHALL be installable as a PWA and provide offline fallback.

#### Scenario: PWA install
- GIVEN a user visits the site on a supported browser
- THEN a manifest.webmanifest is available with name, icons, theme color
- AND a service worker is registered

#### Scenario: Offline mode
- GIVEN the user is offline
- WHEN they open the app
- THEN:
  - The shell loads from service worker cache
  - The feed shows cached articles (stale, with "offline" badge)
  - The user can browse bookmarks (already in IndexedDB)
  - API calls fail gracefully (toast: "Sin conexión. Reintentando...")

### Requirement: Image Pipeline (R2 + Image Resizing)

The system SHALL serve all news images through a Cloudflare R2 + Image Resizing pipeline.

#### Scenario: Image request
- GIVEN a news card needs an image
- THEN the `<img>` uses `srcset` generated by `lib/image.ts`:
  - `/img/:hash?w=400 400w`
  - `/img/:hash?w=800 800w`
  - `/img/:hash?w=1200 1200w`
- AND Image Resizing serves AVIF if supported, else WebP, else jpg
- AND cache headers: `Cache-Control: public, max-age=31536000, immutable`

#### Scenario: First-time image fetch
- GIVEN an image hash is requested but not in R2
- THEN the worker:
  - Fetches the source URL from D1
  - Downloads the image
  - Uploads to R2 (async via Queue for non-blocking)
  - Returns the original (or transformed) image
  - Caches at edge

### Requirement: Edge Cache

The system SHALL cache all public API endpoints at the Cloudflare edge.

#### Scenario: Feed cache
- GIVEN a request to `/api/news/feed?category=politica&page=1`
- THEN:
  - Cache key: `feed:public:politica:null:hot:1`
  - On hit: return immediately
  - On miss: query D1, return with `Cache-Control: public, max-age=60, stale-while-revalidate=300`
  - Cache.put for next request

#### Scenario: Article cache
- Cache key: `article:public:${id}`
- TTL: 5min
- SWR: 1h

#### Scenario: User-specific data
- Bookmarks, search, tracked events: NO cache

### Requirement: Analytics (Privacy-First)

The system SHALL track read events via Cloudflare Analytics Engine (no cookies, no PII).

#### Scenario: Card view
- GIVEN a user views a card in the feed (visible for > 1s)
- THEN a beacon is sent to `/api/track` with:
  - `newsId`, `category`, `source`, `userSegment` (blobs)
  - `dwellTime`, `scrollDepth` (doubles)
  - Anonymous index (no userId without auth)

#### Scenario: Read full article
- GIVEN a user opens an article and scrolls to the bottom
- THEN a more detailed event is sent (full read, completion time)

### Requirement: Cron Triggers

The system SHALL refresh the Vectorize index every 2 hours.

#### Scenario: Cron handler
- GIVEN the cron `0 */2 * * *` triggers
- THEN the worker:
  - Queries D1 for news updated since last sync
  - Generates embeddings (via Vectorize's built-in or external model)
  - Upserts to `news_embeddings` index
  - Emits health metric to Analytics Engine
  - Cleans stale cache entries

### Requirement: TypeScript Strict

The system SHALL compile with TypeScript strict mode and zero errors.

#### Scenario: Build
- GIVEN `pnpm typecheck` is run
- THEN no errors in `packages/antena` or `packages/api`
- AND `pnpm build` succeeds for both

### Requirement: Performance Budget

The system SHALL meet the following performance metrics on mobile (slow 4G, mid-tier Android).

| Metric | Target | Hard limit |
|--------|--------|-----------|
| LCP | < 1.8s | < 2.5s |
| CLS | < 0.05 | < 0.1 |
| TBT | < 150ms | < 300ms |
| FCP | < 1.2s | < 1.8s |
| INP | < 150ms | < 250ms |
| JS shell gzipped | < 60KB | < 80KB |
| CSS gzipped | < 20KB | < 30KB |

#### Scenario: Lighthouse CI
- GIVEN a PR is opened
- THEN Lighthouse CI runs with mobile preset
- AND fails the build if any metric is below hard limit

### Requirement: Accessibility

The system SHALL meet WCAG 2.1 AA standards.

#### Scenario: Contraste
- All text SHALL have contrast ratio ≥ 4.5:1 (normal) or 3:1 (large)
- Focus rings SHALL be visible (`--accent-glow`)

#### Scenario: Touch targets
- All interactive elements SHALL be ≥ 44x44pt

#### Scenario: Reduced motion
- GIVEN `prefers-reduced-motion: reduce` is set
- THEN decorative animations are disabled
- Functional animations (loading, transitions) remain but are faster (100ms)

#### Scenario: Screen reader
- All icon-only buttons SHALL have `aria-label`
- Nav active state SHALL have `aria-current="page"`
- Live regions for dynamic content (toasts, loading states)

### Requirement: Test Coverage

The system SHALL have ≥ 70% coverage in lib/ and components, plus 12-15 E2E tests.

#### Scenario: Test pyramid
- Unit (vitest, lib/): 50-70 tests
- Components (@solidjs/testing-library): 30-40 tests
- API (vitest-pool-workers): 20-30 tests
- E2E (Playwright + mobilerun): 12-15 tests

### Requirement: Out of Scope (v1)

The system SHALL NOT include (these are v2/v3 features):

- WebLLM agent (in branch `feature/webllm-agent`, archived)
- Voice (STT/TTS in agent) (same branch)
- User accounts / auth (v2: Cloudflare Access)
- Comments (v2)
- Persistent reactions (v2)
- Community services (Cortes, Farmacias, Transporte, Alertas) (v3)
- Push notifications (v2)
- Polished ModoMate TTS UI (keep simple)
- i18n (Spanish only)
- RSS reader / saved searches (v2)
- Newsletter digest (v3: Email Workers)

#### Scenario: v1 release does not include these features
- GIVEN the v1.0 release is shipped
- THEN none of the above features are part of the runtime
- AND the WebLLM agent code lives in branch `feature/webllm-agent` only
- AND no "coming soon" placeholders for these features are exposed to users (instead, references are removed cleanly)
