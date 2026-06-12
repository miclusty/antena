## Why

After the v1 closer shipped and the Reddit/X-style visual redesign, qwen3.5-4b vision review (validated on /tmp/antena-final-2xl.png and /tmp/antena-final-mobile.png) identified 7 high-impact gaps between the current Antena and what a real Reddit/X.com user expects. These gaps are the difference between "looks like Reddit" and "behaves like Reddit":

- "Fuentes: 3 activos / Hoy: 6 notas" widgets show numbers but the feed has no **featured story** to anchor the user
- `/api/news/feed?limit=20` returns 6 items but `fetchStats()` shows 0/0 because `/api/stats/health` doesn't exist in the new API
- Location is "Todas las ubicaciones" (vague dropdown) instead of a city selector
- The right rail has "Lo más visto" widget but the feed has no actual trending section
- Sources show as text strings, not as logos (La Voz, Clarín, etc. need credibility logos)
- No breaking-news surface — X has it (En Vivo), Reddit has it (/r/all), Antena doesn't
- The mobile bottom nav "Menú" opens a stale MenuView, not a Reddit-style left drawer overlay

These are all **on-page** improvements that the user has been asking for ("necesito acciones SOBRE LA PAGINA"), and they complete the Reddit/X visual redesign by giving it real substance behind the chrome.

## What Changes

- Add **Featured story** as a hero card at the top of the "Para vos" feed, showing the most multi-source cluster of the day with a marquee source count
- Add **`/api/stats/health` endpoint** to the API worker that returns real totals (`total_news`, `active_sources`, `news_today`, `news_week`, `total_locations`, `total_clusters`)
- Replace the LocationSelector dropdown with a **city selector** (horizontal scrollable chips of major Argentine cities: Buenos Aires, Córdoba, Mendoza, Rosario, Tucumán, etc., with counts)
- Add **"Lo más visto hoy"** section in the feed as a horizontal scrollable list of ranked stories (above the main feed), with "Ver todo" link to a dedicated page
- Add **source logo** to NewsCard, generated programmatically (SVG initials with brand color, or first letter with bias color) — since real logos require licensing
- Add **`/api/news/breaking` endpoint** + "**En vivo**" tab in the bottom nav (4 tabs → 5 tabs: Inicio / En Vivo / Buscar / Guardados / Menú)
- Replace the bottom nav "Menú" with a **Reddit-style left drawer overlay** that slides in from the left, with avatar, Mi actividad, Explorar, Medios, Configuración — same content as the desktop LeftSidebar but mobile-optimized (collapsible sections, swipe-to-close)

**BREAKING**: Bottom nav goes from 4 to 5 tabs (Inicio / En Vivo / Buscar / Guardados / Menú). The current MenuView tab gets removed in favor of the drawer.

## Capabilities

### New Capabilities
- `featured-story`: Hero card at top of feed showing the most multi-source cluster
- `stats-endpoint`: Real `/api/stats/health` returning total_news, active_sources, etc.
- `city-selector`: City picker replacing the vague "Todas las ubicaciones" dropdown
- `trending-feed-section`: "Lo más visto hoy" section in the feed
- `source-logos`: Programmatic source logo generator (no licensing needed)
- `breaking-news`: "En Vivo" tab with real-time breaking news endpoint
- `mobile-drawer`: Reddit-style left drawer overlay replacing the Menú tab

### Modified Capabilities
None — `antena-v1-closer` spec is unchanged. This is additive only.

## Impact

- **Antena frontend** (`packages/antena/src/`):
  - `components/common/NewsCard.tsx` — add source logo slot, breaking-news variant
  - `components/feed/FeaturedStory.tsx` (new) — hero card component
  - `components/feed/TrendingSection.tsx` (new) — horizontal scrollable trending
  - `components/common/CitySelector.tsx` (new) — replace LocationSelector
  - `components/common/SourceLogo.tsx` (new) — programmatic logo
  - `components/menu/MobileDrawer.tsx` (new) — sliding left drawer
  - `components/common/BottomNav.tsx` — add 5th tab (En Vivo), replace Menú behavior
  - `App.tsx` — wire new components
  - `lib/api.ts` — add `fetchStats()`, `fetchBreaking()`, `fetchTrending()`, `fetchCities()`
  - `lib/api.ts` — `NewsItem` and `NewsCard` props get `sourceLogoUrl` field
  - `pages/index.astro` — add city selector to initial state if needed

- **API worker** (`packages/api/src/`):
  - `routes/stats.ts` — new endpoint `/api/stats/health` (or expand existing)
  - `routes/news.ts` — add `/api/news/breaking` and `/api/news/trending` endpoints
  - `routes/locations.ts` — add `/api/locations/cities` (major cities with news counts)
  - `db/queries.ts` (new) — Drizzle queries for stats, trending, breaking, cities
  - Drizzle schema unchanged

- **Documentation**:
  - `CHANGELOG.md` — v1.1.0 entry
  - `openspec/specs/antenna-feed-polish-v2/spec.md` — new spec with requirements

- **Dependencies**:
  - No new runtime deps
  - May add `@csstools/postcss-color-function` if we need P3 color for source logos (skip for now)
