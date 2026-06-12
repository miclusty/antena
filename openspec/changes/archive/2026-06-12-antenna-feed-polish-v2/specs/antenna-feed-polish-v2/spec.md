# Spec: antenna-feed-polish-v2

## Purpose

Complete the Reddit/X.com visual redesign of Antena by adding the 7 high-impact features identified by qwen3.5-4b vision review of the v1.0 closer + the Reddit/X-style redesign. These features give the visual chrome real substance behind it: a featured story anchor, real stats, a city selector, a trending section, source logos for credibility, an "En Vivo" breaking-news surface, and a Reddit-style left drawer for mobile.

## ADDED Requirements

### Requirement: Featured Story Hero

The system SHALL display a hero card at the top of the "Para vos" feed showing the day's most multi-source cluster.

#### Scenario: Multi-source story is available
- GIVEN the user is on the "Para vos" tab
- AND there are 2+ news cards with the same `cluster_id`
- AND the cluster has `sources_count >= 3`
- THEN the system SHALL render a `<FeaturedStory>` card at the top of the feed
- AND the card SHALL show the cluster's headline (24-28px), summary, and thumbnail
- AND the card SHALL display a "N medios cubren esto" label with a marquee of source names
- AND the card SHALL be tappable to open the first source in the cluster

#### Scenario: No multi-source stories
- GIVEN the user is on the "Para vos" tab
- AND no cluster has `sources_count >= 3`
- THEN the system SHALL NOT render the FeaturedStory card (silent skip)

### Requirement: Stats Endpoint

The system SHALL provide a real `/api/stats/health` endpoint that returns aggregated metrics from D1.

#### Scenario: API request to stats endpoint
- GIVEN the API worker is running
- WHEN a GET request is made to `/api/stats/health`
- THEN the response SHALL return `{ total_news, active_sources, news_today, news_week, total_locations, total_clusters }`
- AND all counts SHALL be computed from D1 in real time (not hardcoded)
- AND the response SHALL pass Zod validation

#### Scenario: Left sidebar displays real stats
- GIVEN the user is on the desktop (xl+) layout
- WHEN the LeftSidebar renders
- AND the API has returned stats
- THEN the "Tu Antena" card SHALL show "Hoy: N notas" and "Medios: N activos" with the real numbers
- WHEN the stats API is still loading
- THEN show "..." placeholders (not 0/0)

### Requirement: City Selector

The system SHALL replace the vague "Todas las ubicaciones" dropdown with a city selector showing the top 12 Argentine cities.

#### Scenario: City selector renders cities
- GIVEN the antenna app is loaded
- WHEN the user scrolls to the location/category section
- THEN the system SHALL render a horizontal scrollable list of city chips
- AND each chip SHALL show the city name + count of available news
- AND the first chip "Todas" SHALL be active by default

#### Scenario: User selects a city
- GIVEN the city selector is visible
- WHEN the user taps a city chip (e.g., "Córdoba 4")
- THEN the active chip SHALL switch to that city
- AND the feed SHALL filter to news from that location_id
- AND the URL SHALL update with `?loc=<id>`

### Requirement: Trending Feed Section

The system SHALL display a "Lo más visto hoy" section in the feed with the top 10 trending stories.

#### Scenario: Trending section renders
- GIVEN the antenna app is loaded
- AND `fetchTrending(10)` returns news
- THEN the system SHALL render a section between the featured story and the main feed
- AND the section header SHALL show "🔥 Lo más visto hoy" + a "Ver todo" link
- AND the section SHALL be a horizontal scrollable list of compact cards (title only, 2-line clamp, category dot)

#### Scenario: Trending is loading
- GIVEN the app is loading
- WHEN the trending fetch is in flight
- THEN the section SHALL show 3-5 skeleton placeholders (no spinner)

#### Scenario: No trending data
- GIVEN `fetchTrending` returns empty
- THEN the section SHALL be hidden entirely

### Requirement: Source Logos (Programmatic)

The system SHALL display a source logo (programmatic, no licensing) on every NewsCard and in the LeftSidebar "Medios" list.

#### Scenario: NewsCard displays source logo
- GIVEN a news card with a source name
- WHEN the card renders
- THEN a 32x32 circular logo SHALL appear (top-left or as avatar)
- AND the logo SHALL have a deterministic color background (hash of source name → HSL hue)
- AND the logo SHALL show 1-2 uppercase letters of the source name
- AND an optional small bias-color dot SHALL be at the bottom-right

#### Scenario: LeftSidebar "Medios" list
- GIVEN the user is on the desktop (xl+) layout
- AND a list of top 5 sources is rendered in the "Medios" section
- THEN each source row SHALL show: source logo (24x24) + name + count + bias dot
- AND the logo color SHALL match the card's source logo for the same source

### Requirement: "En Vivo" Breaking News Tab

The system SHALL add a 5th bottom nav tab "En Vivo" that displays breaking news from the last 2 hours.

#### Scenario: Bottom nav has 5 tabs
- GIVEN the antenna app is loaded on mobile
- WHEN the BottomNav renders
- THEN it SHALL show 5 tabs: Inicio / En Vivo / Buscar / Guardados / Menú
- AND the "En Vivo" tab SHALL have a `bolt` or `flash_on` Material Symbol icon
- AND the active state SHALL be visually distinct (pulsing red dot OR accent dot)

#### Scenario: En Vivo view shows breaking news
- GIVEN the user taps the "En Vivo" tab
- THEN the main view SHALL switch to a "BreakingView" component
- AND the view SHALL show a "🔴 EN VIVO AHORA" indicator at top with pulsing red dot
- AND the view SHALL display a list of news from the last 2 hours, sorted by recency
- AND each item SHALL show: HH:MM timestamp, source logo, headline, tap to open

#### Scenario: En Vivo has no breaking news
- GIVEN `fetchBreaking` returns empty
- THEN the view SHALL show an empty state: "Sin novedades en las últimas 2 horas. Volvé más tarde."

### Requirement: Reddit-style Mobile Drawer

The system SHALL replace the bottom nav "Menú" tab with a Reddit-style left drawer overlay.

#### Scenario: Drawer opens via Menú tab
- GIVEN the user taps the "Menú" tab in the bottom nav
- THEN the system SHALL slide in a left drawer from the left edge (85% width, full height)
- AND the rest of the screen SHALL show a semi-transparent backdrop
- AND the drawer SHALL contain: avatar + "Tu Antena" header, "Mi actividad" (5 items w/ counts), "Explorar" (categories w/ dots), "Medios" (top sources w/ logos + counts), "Configuración" link

#### Scenario: Drawer closes
- GIVEN the drawer is open
- WHEN the user taps the backdrop, swipes left, or presses Escape (desktop)
- THEN the drawer SHALL slide out to the left
- AND the backdrop SHALL fade out

#### Scenario: Drawer menu items
- GIVEN the drawer is open
- WHEN the user taps "Inicio", "Siguiendo", "Guardados", or "Historial"
- THEN the drawer SHALL close
- AND the main view SHALL switch accordingly

#### Scenario: Drawer sections
- GIVEN the drawer is open
- AND the user taps a section header (e.g., "MI ACTIVIDAD", "EXPLORAR")
- THEN the section SHALL collapse/expand (accordion behavior)
- AND collapsed sections SHALL show only the header

### Requirement: Source Logos Generation (No Licensing)

The system SHALL programmatically generate source logos (no real logos to avoid licensing issues).

#### Scenario: Logo color generation
- GIVEN a source name (e.g., "La Voz", "Clarín")
- THEN the system SHALL hash the name to a hue (0-360)
- AND use a fixed saturation/lightness (e.g., 65% sat, 50% light)
- AND display the first 1-2 letters in bold white text

#### Scenario: Bias dot
- GIVEN a source has a known bias_score
- THEN a small dot SHALL appear on the logo's bottom-right
- AND the color SHALL be one of: `var(--bias-officialist)` (positive), `var(--bias-neutral)` (near 0), `var(--bias-opposition)` (negative)

### Requirement: Stats Endpoint Caching

The system SHALL cache the stats response at the edge for 60 seconds.

#### Scenario: Stats cached at edge
- GIVEN the first request to `/api/stats/health`
- WHEN the response is generated
- THEN the response SHALL be stored in `caches.default` with `Cache-Control: public, max-age=60, stale-while-revalidate=300`
- AND subsequent requests within 60s SHALL return the cached response

## Out of Scope (v1.1.0)

These are explicitly NOT in this change:

- Real source logos (would require licensing agreements)
- Auth / user accounts (deferred to v2)
- Real-time WebSocket for breaking news (uses polling in v1.1)
- Comments on news cards (deferred to v2)
- Personalization ("Para vos" smart feed) (deferred to v2)
- Server-side rendering of breaking view (still CSR)
