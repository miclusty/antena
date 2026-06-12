# Design: antenna-feed-polish-v2

## Context

After the v1 closer + Reddit/X-style redesign, qwen3.5-4b vision review (validated on /tmp/antena-final-2xl.png) identified 7 high-impact gaps. This change adds the substance behind the visual chrome. All changes are additive — the v1-closer spec and its existing requirements stay unchanged.

The user has been very direct about wanting on-page improvements that drive usage, not new architectural work. This change delivers exactly that: 7 concrete user-facing features, all built on top of the existing Cloudflare stack (D1, Workers, Pages) using the established patterns (TanStack Query for client cache, Zod for validation, Solid signals for state).

## Decisions

### Decision 1: Use Drizzle queries for all new endpoints

The schema is already in `packages/api/src/db/schema.ts` (from v1-closer Phase 2). All new queries use Drizzle's `db.select()` builder for type-safety. No raw SQL except the Drizzle-generated one.

### Decision 2: Skip real source logos

Source logos (La Voz, Clarín, etc.) require licensing. Instead, generate them programmatically: hash the source name to a hue, render the first 1-2 letters in a circle. This is what GitHub does for default avatars and what most news apps do for unknown sources.

### Decision 3: Polling for breaking news, not WebSocket

Real-time WebSocket would require Durable Objects (a new binding, more cost, more code). Polling with TanStack Query at 30s intervals gives the same UX for v1.1. WebSocket can be added in v2.

### Decision 4: Bottom nav goes 4 → 5 tabs (breaking change)

User explicitly approved: "En Vivo" becomes a new tab. To stay within thumb-reach (5 × 60pt = 300pt, fits 360-414pt screens with 30pt padding each side), the tab icons stay 24px and labels shrink to 10px from 12px. The "Menú" tab stops being a view — it opens the drawer.

### Decision 5: Mobile drawer uses the same content as desktop LeftSidebar

Avoid duplicating the menu structure. The drawer is the mobile equivalent of LeftSidebar. Both show: avatar, "Tu Antena" stats, "Mi actividad", "Explorar" categories, "Medios" top sources, "Configuración". The drawer just adds mobile affordances (touch targets 48pt, swipe-to-close, accordion sections).

### Decision 6: City selector stays horizontal scrollable

X.com, Reddit, and most modern mobile apps use horizontal scrollable chips for city/category selection. It's thumb-friendly and doesn't take up vertical space. The 12 cities fit in ~720dp horizontal scroll.

## Architecture

```
┌─ Antena Frontend (Astro 5 + Solid 1.9) ─────────────────────────────┐
│                                                                       │
│  BottomNav (5 tabs)                                                   │
│  ┌─Inicio─┐┌─En Vivo─┐┌─Buscar─┐┌─Guardados─┐┌─Menú─┐              │
│                                                                       │
│  If activeView === "feed":                                           │
│    ┌─FeaturedStory (NEW) ──────────────────────────┐               │
│    │  cluster hero with marquee source count        │               │
│    └───────────────────────────────────────────────┘               │
│    ┌─TrendingSection (NEW) ────────────────────────┐               │
│    │  🔥 Lo más visto hoy                          │               │
│    │  [card] [card] [card] →                      │               │
│    └───────────────────────────────────────────────┘               │
│    ┌─CitySelector (NEW) ──────────────────────────┐               │
│    │  [Todas] [Córdoba 4] [Buenos Aires 5] →      │               │
│    └───────────────────────────────────────────────┘               │
│    ┌─Categories chips (existing) ────────────────┐               │
│    └───────────────────────────────────────────────┘               │
│    ┌─NewsCard (refactored) ──────────────────────┐               │
│    │  [SourceLogo] politca · La Voz · 13h          │               │
│    │  Córdoba aprueba el presupuesto 2026...        │               │
│    │  [thumb]                                       │               │
│    │  ● 3 fuentes                                  │               │
│    │  [40] [↻8] [↑149] [↓] [🔖] [• Compartir]    │               │
│    └───────────────────────────────────────────────┘               │
│                                                                       │
│  If activeView === "breaking" (NEW):                                │
│    ┌─BreakingView (NEW) ──────────────────────────┐               │
│    │  🔴 EN VIVO AHORA                             │               │
│    │  [12:34] [logo] Title of breaking story       │               │
│    │  [12:28] [logo] Another breaking story        │               │
│    └───────────────────────────────────────────────┘               │
│                                                                       │
│  MobileDrawer (NEW) — slides from left when Menú tab tapped         │
│  ┌─Avatar "A"─Hola, José                          ┐               │
│  │  Hoy: 6 notas · 3 medios activos                │               │
│  ├─MI ACTIVIDAD ───────────────────────────────────┤               │
│  │  Inicio 6 · Para vos 6 · Siguiendo 0 · ...     │               │
│  ├─EXPLORAR ───────────────────────────────────────┤               │
│  │  ● Todas · ● Política · ● Economía · ...        │               │
│  ├─MEDIOS ─────────────────────────────────────────┤               │
│  │  [A] La Voz 3 · [C] Clarín 2 · ...             │               │
│  └─Configuración                                  ┘               │
│                                                                       │
│  SourceLogo (NEW component)                                          │
│  [A] = programmatic, hash(source) → hue, 1-2 letters                 │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓ fetch
┌─ API Worker (Hono on Cloudflare Workers) ────────────────────────────┐
│                                                                       │
│  /api/stats/health  → getStats(db)           (NEW, real numbers)      │
│  /api/news/breaking → getBreaking(db, 20)    (NEW)                   │
│  /api/news/trending → getTrending(db, 10)    (NEW)                   │
│  /api/locations/cities → getCities(db)        (NEW)                   │
│  /api/news/feed (existing)                                            │
│  /api/news/:id (existing)                                            │
│  /api/locations/tree (existing)                                      │
│  /api/categories (existing)                                          │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓ Drizzle ORM
┌─ Cloudflare D1 (SQLite) ─────────────────────────────────────────────┐
│  news_cards · clusters · master_articles · sources · locations ·     │
│  categories (schema from v1-closer Phase 2)                          │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Model (additions)

No new tables. All new queries use existing schema:

```ts
// packages/api/src/db/queries.ts (new file)
import { db } from './d1';

export async function getStats(db: D1Database) {
  const [totalNews] = await db.prepare('SELECT COUNT(*) as c FROM news_cards').all();
  const [activeSources] = await db.prepare('SELECT COUNT(*) as c FROM sources WHERE is_active = 1').all();
  const [todayNews] = await db.prepare(`
    SELECT COUNT(*) as c FROM news_cards 
    WHERE created_at >= datetime('now', '-1 day')
  `).all();
  const [weekNews] = await db.prepare(`
    SELECT COUNT(*) as c FROM news_cards 
    WHERE created_at >= datetime('now', '-7 days')
  `).all();
  const [totalLocations] = await db.prepare('SELECT COUNT(*) as c FROM locations').all();
  const [totalClusters] = await db.prepare('SELECT COUNT(*) as c FROM clusters').all();
  return {
    total_news: totalNews.c,
    active_sources: activeSources.c,
    news_today: todayNews.c,
    news_week: weekNews.c,
    total_locations: totalLocations.c,
    total_clusters: totalClusters.c,
  };
}

export async function getBreaking(db: D1Database, limit = 20) {
  return await db.prepare(`
    SELECT * FROM news_cards 
    WHERE created_at >= datetime('now', '-2 hours')
    ORDER BY sources_count DESC, created_at DESC
    LIMIT ?
  `).bind(limit).all();
}

export async function getTrending(db: D1Database, limit = 10, hours = 24) {
  return await db.prepare(`
    SELECT * FROM news_cards 
    WHERE created_at >= datetime('now', '-' || ? || ' hours')
    ORDER BY sources_count DESC, created_at DESC
    LIMIT ?
  `).bind(hours, limit).all();
}

export async function getCities(db: D1Database) {
  return await db.prepare(`
    SELECT l.id, l.name, l.province, COUNT(nc.id) as count
    FROM locations l
    LEFT JOIN news_cards nc ON nc.location_id = l.id
    WHERE l.type = 'city' AND l.parent_id IS NULL
    GROUP BY l.id
    HAVING count > 0
    ORDER BY count DESC
    LIMIT 12
  `).all();
}
```

## Component Architecture (additions)

### SourceLogo (new)
```tsx
// packages/antena/src/components/common/SourceLogo.tsx
interface SourceLogoProps {
  source: string;
  biasColor?: string;
  size?: number;
  showBiasDot?: boolean;
}

// Deterministic color: hash(source) → hue, 65% sat, 50% light
// Initials: first 1-2 uppercase letters
// Optional bias dot: 6px circle bottom-right
```

### FeaturedStory (new)
```tsx
// packages/antena/src/components/feed/FeaturedStory.tsx
interface FeaturedStoryProps {
  clusterId: string;
  primary: NewsItem;
  sources: Array<{ name: string; biasColor: string }>;
  sourceCount: number;
  onClick: () => void;
}

// Full-width hero card
// Left: title (24-28px), summary, source marquee
// Right: thumbnail (200x140)
// Subtle accent gradient at top
```

### TrendingSection (new)
```tsx
// packages/antena/src/components/feed/TrendingSection.tsx
interface TrendingSectionProps {
  items: TrendingItem[];
  loading: boolean;
  onItemClick: (item: TrendingItem) => void;
}

// Section header: "🔥 Lo más visto hoy" + "Ver todo"
// Horizontal scroll of compact cards (title only, 2-line clamp)
// Skeleton loaders while loading
```

### CitySelector (new)
```tsx
// packages/antena/src/components/common/CitySelector.tsx
interface CitySelectorProps {
  cities: City[];
  activeCityId: number | null;
  onSelect: (cityId: number | null) => void;
}

// Horizontal scroll of chips: [Todas] [Córdoba 4] [Buenos Aires 5] ...
// Active: bg-accent, white text
// Inactive: bg-bg-elevated, text-text-secondary
```

### BreakingView (new)
```tsx
// packages/antena/src/components/feed/BreakingView.tsx
interface BreakingViewProps {
  items: BreakingItem[];
  onItemClick: (item: BreakingItem) => void;
}

// "🔴 EN VIVO AHORA" pulsing indicator at top
// Dense list: [HH:MM] [logo] title, click to open
// 60s polling via TanStack Query
```

### MobileDrawer (new)
```tsx
// packages/antena/src/components/menu/MobileDrawer.tsx
interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  stats: { total_news: number; active_sources: number } | null;
  onNavigate: (view: ViewType) => void;
}

// Slide-in from left, 85% width, full height
// Backdrop overlay with tap-to-close
// Accordion sections (Mi actividad, Explorar, Medios)
// Touch targets 48pt
// Swipe-left to close (touch handler)
```

## State Management (additions)

App.tsx additions:
```tsx
const [activeView, setActiveView] = createSignal<ViewType>('feed');  // 'feed' | 'breaking' | 'search' | 'bookmarks'
const [drawerOpen, setDrawerOpen] = createSignal(false);
const [activeCity, setActiveCity] = createSignal<number | null>(null);
const [featuredCluster, setFeaturedCluster] = createSignal<{clusterId, primary, sources, count} | null>(null);

// TanStack Query (existing, just add queries)
const stats = createQuery(() => ({
  queryKey: ['stats'],
  queryFn: fetchStats,
  staleTime: 60_000,
}));
const trending = createQuery(() => ({
  queryKey: ['trending'],
  queryFn: () => fetchTrending(10),
  staleTime: 5 * 60_000,
}));
const cities = createQuery(() => ({
  queryKey: ['cities'],
  queryFn: fetchCities,
  staleTime: 10 * 60_000,
}));
const breaking = createQuery(() => ({
  queryKey: ['breaking'],
  queryFn: () => fetchBreaking(50),
  refetchInterval: 30_000,  // poll every 30s
}));
```

## Routes (API)

### GET /api/stats/health
- Zod: `void` (no params)
- Returns: `{ total_news, active_sources, news_today, news_week, total_locations, total_clusters }`
- Cache: 60s TTL, 5min SWR

### GET /api/news/breaking
- Zod: `{ limit?: number (1-50, default 20) }`
- Returns: `{ news: ApiNewsCard[], total: number }`
- Cache: 30s TTL (live data)

### GET /api/news/trending
- Zod: `{ limit?: number (1-50, default 10), hours?: number (1-168, default 24) }`
- Returns: `{ news: ApiNewsCard[], total: number }`
- Cache: 5min TTL

### GET /api/locations/cities
- Zod: void
- Returns: `{ cities: Array<{ id, name, province, count }> }`
- Cache: 10min TTL

## Risks & Tradeoffs

- **[Risk] 5 tabs are tight on small screens** — Mitigation: shrink labels to 10px, keep icons 24px, use `min-w-[56px]` per tab. 5 × 60pt = 300pt fits any modern phone.
- **[Risk] SourceLogo color collisions** — Hash collisions on short names. Mitigation: salt the hash with the category name and year.
- **[Risk] Polling breaking-news eats quota** — Mitigation: 30s interval, conditional fetch (only when En Vivo tab is active).
- **[Risk] Mobile drawer z-index conflicts with bottom nav** — Drawer z-index 100, bottom nav z-index 50. Drawer covers everything.

## Migration Path

No data migration needed. No breaking schema changes. New API endpoints are additive. Frontend changes are isolated to new components + App.tsx wiring.

## Out of Scope (v1.1)

- Real source logos (licensing)
- WebSocket for breaking news (use polling)
- User accounts (v2)
- Comments on news cards (v2)
- "Para vos" personalization via Analytics Engine (v2)
