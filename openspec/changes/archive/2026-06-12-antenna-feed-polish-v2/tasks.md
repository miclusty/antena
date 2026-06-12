## 1. API: Stats endpoint

- [ ] 1.1 Add `getStats(db)` query in `packages/api/src/db/queries.ts` (new file) returning `{ total_news, active_sources, news_today, news_week, total_locations, total_clusters }`
- [ ] 1.2 Wire up `/api/stats/health` route in `packages/api/src/routes/stats.ts` (already mounted in index.ts) to call the new query and add Zod validation
- [ ] 1.3 Verify with `curl http://localhost:8800/api/stats/health` — should return real numbers (not 0/0)
- [ ] 1.4 Update `packages/api/src/lib/schemas.ts` with `statsResponseSchema` if not already present

## 2. API: Breaking news + Trending + Cities endpoints

- [ ] 2.1 Add `getBreaking(db, limit)` query — news cards from last 2 hours with bias_score != null, sorted by `sources_count DESC, published_at DESC`
- [ ] 2.2 Add `getTrending(db, limit)` query — top news from last 24 hours by `views_count` or fallback `sources_count` if no views column
- [ ] 2.3 Add `getCities(db)` query — distinct locations with news count, returning top 12 (Buenos Aires, Córdoba, Mendoza, Rosario, Tucumán, La Plata, Mar del Plata, Salta, Santa Fe, San Juan, Resistencia, Neuquén)
- [ ] 2.4 Add `/api/news/breaking` route with Zod `breakingQuerySchema` (`{ limit?: number }`)
- [ ] 2.5 Add `/api/news/trending` route with Zod `trendingQuerySchema` (`{ limit?: number, hours?: number }`)
- [ ] 2.6 Add `/api/locations/cities` route with Zod `citiesQuerySchema` (no params, just `limit` for safety)
- [ ] 2.7 Wire all three routes into `packages/api/src/index.ts` (mount under `/api/news/breaking`, `/api/news/trending`, `/api/locations/cities`)

## 3. Antena: API client extensions

- [ ] 3.1 Add `fetchStats()` to `packages/antena/src/lib/api.ts` returning real numbers
- [ ] 3.2 Add `fetchBreaking(limit?)` to api.ts
- [ ] 3.3 Add `fetchTrending(limit?, hours?)` to api.ts
- [ ] 3.4 Add `fetchCities()` to api.ts returning `Array<{ id: number; name: string; count: number }>`
- [ ] 3.5 Update `packages/antena/src/lib/types.ts` to add `BreakingItem` and `TrendingItem` and `City` types

## 4. Antena: Featured story hero card

- [ ] 4.1 Create `packages/antena/src/components/feed/FeaturedStory.tsx` with `FeaturedStory` component
- [ ] 4.2 Component props: `{ clusterId: string, news: NewsItem[], sourceCount: number, allSources: { name: string; biasColor: string }[] }`
- [ ] 4.3 Layout: full-width hero card with large title (24-28px), large thumbnail (right side, 200x140), summary below, "N medios cubren esto" with marquee of source names
- [ ] 4.4 Use `var(--accent)` for the marquee text, `var(--bg-elevated)` for card
- [ ] 4.5 Add subtle gradient overlay on the thumbnail for text contrast
- [ ] 4.6 In `App.tsx`, render `<FeaturedStory>` at the top of "Para vos" tab (only when there are multi-source items)
- [ ] 4.7 On tap, navigate to the first news item in the cluster

## 5. Antena: "Lo más visto hoy" section

- [ ] 5.1 Create `packages/antena/src/components/feed/TrendingSection.tsx`
- [ ] 5.2 Component fetches trending data via `fetchTrending(10)` using TanStack Query (cache 5min)
- [ ] 5.3 Render horizontal scrollable list of compact cards (title only, 2-line clamp, category dot)
- [ ] 5.4 "Ver todo" link at right of section header → scrolls to main feed
- [ ] 5.5 Place above main feed in `App.tsx` (between featured and main feed, hidden when trending is empty)
- [ ] 5.6 Skeleton loaders while loading

## 6. Antena: City selector

- [ ] 6.1 Create `packages/antena/src/components/common/CitySelector.tsx`
- [ ] 6.2 Fetch cities via `fetchCities()` (TanStack Query, cache 10min)
- [ ] 6.3 Render as horizontal scrollable list of chips: each city = name + count, active state = bg-accent
- [ ] 6.4 Replace the existing `LocationSelector` in `App.tsx` (which has only "Todas" + dropdown)
- [ ] 6.5 On city tap, filter feed by that location_id and update URL
- [ ] 6.6 On "Todas" tap, clear location filter
- [ ] 6.7 In BottomNav mobile flow, this is in the top section above category chips

## 7. Antena: Source logos (programmatic, no licensing)

- [ ] 7.1 Create `packages/antena/src/components/common/SourceLogo.tsx`
- [ ] 7.2 Component props: `{ source: string, biasColor?: string, size?: number }`
- [ ] 7.3 Use a deterministic color palette: pick a hue based on hash(source) for backgrounds, white text
- [ ] 7.4 Show first letter (or two) of source name, uppercase, bold
- [ ] 7.5 Optional bias dot bottom-right (small circle in bias color)
- [ ] 7.6 Replaces the `avatarColor(name)` function currently in `NewsCard.tsx`
- [ ] 7.7 Use in LeftSidebar "Medios" section (replacing the colored dot prefix with the actual logo)

## 8. Antena: "En Vivo" tab (breaking news surface)

- [ ] 8.1 Update `BottomNav.tsx` to have 5 tabs: Inicio / En Vivo / Buscar / Guardados / Menú
- [ ] 8.2 Add `bolt` or `flash_on` Material Symbol for En Vivo tab
- [ ] 8.3 Active state: pulsing red dot OR accent dot, more attention-grabbing than Inicio
- [ ] 8.4 When En Vivo tab is active, the main view changes to a "breaking news" surface: list of last-2-hour stories, sorted by recency
- [ ] 8.5 Add a `BreakingView` component (`packages/antena/src/components/feed/BreakingView.tsx`) that fetches `fetchBreaking(50)` and renders a dense timeline list (similar to X's live timeline)
- [ ] 8.6 Each breaking item shows: timestamp (HH:MM), source logo, headline, click to open
- [ ] 8.7 Add a "Live" indicator at top of the breaking view (pulsing red dot + "EN VIVO AHORA")
- [ ] 8.8 Update App.tsx `handleViewChange` to switch to breaking view when En Vivo tab is active

## 9. Antena: Reddit-style mobile drawer

- [ ] 9.1 Create `packages/antena/src/components/menu/MobileDrawer.tsx`
- [ ] 9.2 Slide-in from left, full-screen height, 85% width, with backdrop overlay
- [ ] 9.3 Same content as the desktop LeftSidebar but mobile-optimized (touch targets 48pt, collapsible sections)
- [ ] 9.4 Swipe-from-left edge or tap Menú tab to open; backdrop tap or swipe-left to close
- [ ] 9.5 Remove the old `MenuView` and `MenuView.tsx` (replaced by the drawer)
- [ ] 9.6 Update `BottomNav.tsx` Menú tab to open the drawer instead of navigating to a view
- [ ] 9.7 Update `App.tsx` to remove the `menu` view type from `ViewType` enum
- [ ] 9.8 Use `<Show>` to render the drawer (Solid way) — `open` signal controls visibility

## 10. Documentation

- [ ] 10.1 Update `CHANGELOG.md` with v1.1.0 release notes (7 features listed)
- [ ] 10.2 Add `docs/api.md` updates for new endpoints (`/api/stats/health`, `/api/news/breaking`, `/api/news/trending`, `/api/locations/cities`)
- [ ] 10.3 Add `openspec/specs/antenna-feed-polish-v2/spec.md` with detailed requirements (referenced from proposal)
- [ ] 10.4 Mark all tasks complete in this file
- [ ] 10.5 Run `openspec validate antenna-feed-polish-v2 --type change`

## Verification

- [ ] All 112 pre-existing typecheck errors must still be 112 (no new)
- [ ] All tests pass (`pnpm test`)
- [ ] `curl http://localhost:8800/api/stats/health` returns `{ total_news: 6, ... }` (real numbers)
- [ ] `curl http://localhost:8800/api/news/breaking` returns last-2-hour news
- [ ] `curl http://localhost:8800/api/news/trending` returns top-24-hour news
- [ ] `curl http://localhost:8800/api/locations/cities` returns 12+ cities
- [ ] Visual: bottom nav has 5 tabs, En Vivo tab shows breaking view, Menú tab opens drawer
- [ ] qwen3.5-4b vision review of /tmp/antena-final-2xl.png shows the new features working
- [ ] Commits on branch `feature/antenna-feed-polish-v2`, then merged to main via no-ff merge
