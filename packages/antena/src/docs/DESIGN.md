# Antena Design System v2.0

## Concept

Antena is a social news aggregator for Argentina. Think X.com meets Reddit — a dense, scannable timeline where news items are social objects: you can upvote, discuss, and share them. The interface is information-dense but never cluttered, optimized for power users who scroll fast and scan headlines.

The personality is **sharp, Argentine, and confident** — not another generic tech product.

---

## Design Principles

1. **Density over whitespace.** Every pixel earns its place. No decorative breathing room.
2. **Content hierarchy.** Title > metadata > actions. Never reverse that.
3. **Dark by default, light available.** The dark palette is the primary experience.
4. **Speed as aesthetics.** Fast, snappy interactions make the product feel alive.
5. **Bias is visible, not hidden.** Political spectrum colors are first-class citizens.

---

## Color Palette

### Dark Mode (primary)

```
--bg-base:       #0F1117   // Deep charcoal — the canvas
--bg-elevated:   #1A1D27   // Cards and surfaces
--bg-hover:      #242836    // Hover states
--border:        #2A2E3C   // Subtle dividers
--text-primary:  #E8E6E3   // Main text — warm white
--text-secondary:#8A8D97   // Muted text
--text-tertiary: #5C5F6A   // Disabled/timestamp
```

### Light Mode

```
--bg-base:       #F7F5F2   // Warm off-white
--bg-elevated:   #FFFFFF   // Pure white cards
--bg-hover:      #F0EDEA   // Hover state
--border:        #E5E0D8   // Dividers
--text-primary:  #1A1A1A   // Near-black
--text-secondary:#6B6760   // Muted
--text-tertiary: #9C9890   // Timestamps
```

### Accent — Coral Red (primary action color)

```
--accent:         #FF4D5A   // Primary brand color
--accent-hover:   #FF6B72   // Hover
--accent-muted:   #FF4D5A1A // 10% opacity for backgrounds
```

### Bias Colors (political spectrum)

```
--bias-officialist:   #75AADB  // Light blue — Peronismo/K
--bias-officialist-dk: #1A3A6B  // Dark blue — Hard Kirchnerismo
--bias-neutral:       #8A8D97   // Gray — Center
--bias-opposition:    #F5C542  // Yellow — PRO/JxC
--bias-opposition-dk: #E8A37C  // Amber — Moderate opposition
```

### Category Colors

```
--cat-politica:    #FF4D5A  // Accent coral
--cat-economia:    #F59E0B  // Amber
--cat-deportes:    #10B981  // Emerald
--cat-policiales:  #EF4444  // Red
--cat-cultura:     #8B5CF6  // Violet
--cat-tecnologia:  #3B82F6  // Blue
--cat-sociedad:    #06B6D4  // Cyan
--cat-internacional: #6366F1 // Indigo
```

---

## Typography

### Type Scale

```
--text-xs:    11px / 1.4   // Timestamps, badges
--text-sm:    13px / 1.5   // Metadata, secondary
--text-base:  15px / 1.5   // Body text, card content
--text-lg:    17px / 1.3   // Card titles (medium weight)
--text-xl:    20px / 1.2   // Section headers
--text-2xl:   24px / 1.1   // Featured/h1
```

### Font Stack

```
Display/Headings: "Syne", system-ui, sans-serif
  — Bold, geometric, personality. Used for titles and emphasis.

Body: "DM Sans", system-ui, sans-serif
  — Clean, legible, modern. Used for body text and UI.

Mono: "JetBrains Mono", monospace
  — For timestamps, URLs, and technical metadata.
```

**Why Syne?** It's a geometric sans with quirky details — not generic. It has character without being decorative.

**Why DM Sans?** Optimized for screen reading, neutral but warm. Better than Inter/Roboto.

**Why JetBrains Mono?** Clear timestamps and code. Distinct from body.

---

## Spacing System

```
--space-1:  4px
--space-2:  8px
--space-3:  12px
--space-4:  16px
--space-5:  20px
--space-6:  24px
--space-8:  32px
```

---

## Component: NewsCard (Timeline Row)

### Layout

```
┌─────────────────────────────────────────────────────┐
│ [Avatar] [Name] @handle · 2h · [Cat]    [•••]      │
│ Title of the news item goes here and can be two    │
│ lines max before truncation                        │
│ Summary text is here, one line, muted color        │
│                                                    │
│ [↑ 142] [💬 23] [↻ 8] [★] [📤]                    │
└─────────────────────────────────────────────────────┘
```

### Visual Rules

- **Height**: 80-100px (dense, not massive card)
- **Avatar**: 40x40px rounded-full, left-aligned
- **No image by default** (only show if `imageUrl` exists)
- **No dual-color stripe** — bias indicated by avatar ring or dot
- **Social actions row at bottom**: upvotes, comments, reposts, bookmark, share
- **Overflow menu** (•••) on right: contains "Leer en fuente", "Reportar", "No mostrar"

### States

- **Default**: bg-elevated, full opacity
- **Read**: 60% opacity on title
- **Hover**: bg-hover background
- **Active**: accent border on left

### Variants

- `default`: Full card with social actions
- `compact`: No avatar, no actions — just title + meta row (for search results, trending)
- `article`: Expanded view inside ArticleDetail

---

## Component: BottomNav (Mobile)

模仿 X/Twitter/Telegram bottom bar:

```
[Home] [Search] [Discover] [Bookmarks] [Profile]
```

- 5 tabs, icon + label below
- Active tab: accent color, filled icon
- Inactive: text-tertiary, outlined icon
- Safe area padding at bottom (env(safe-area-inset-bottom))

---

## Component: FeedTabs

At top of content area, horizontal scroll:

```
[Para vos] [Explorar] [Político] [Deportes] [+]
```

- Active: accent underline + bold text
- Inactive: text-secondary
- Horizontal scroll with fade edges
- "+" tab opens category picker modal

---

## Component: Header (Mobile)

```
┌────────────────────────────────────────┐
│ ← Back    Antena         [Search] [•••]│
└────────────────────────────────────────┘
```

Or when at top-level:
```
┌────────────────────────────────────────┐
│      antena.            [Search] [•••] │
└────────────────────────────────────────┘
```

- Logo centered or left
- Search icon opens full search overlay
- ••• opens settings/menu sheet

---

## Component: SocialActions

```
[▲ upvote] [▼ downvote] · [💬 reply] · [↻ repost] · [★ save] · [📤 share]
```

- Upvote/downvote: toggle on click, count updates
- Neutral state: both gray outline
- Upvoted: accent red fill
- Downvoted: blue-gray fill
- Counts animate when changing (scale bounce)

---

## Component: ArticleDetail

```
┌─────────────────────────────────────────────────────┐
│ [←] [Avatar] [Name] @handle · source.com · 2h       │
│                                                    │
│ TITLE IN LARGE TEXT                                │
│                                                    │
│ [Category] [Bias indicator] [Sources: 5]           │
│                                                    │
│ Body text goes here, full article content.         │
│ Multiple paragraphs allowed. Links are styled.     │
│                                                    │
│ [Media: image or video if present]                │
│                                                    │
│ [▲ 142] [💬 23] [↻ 8] [★] [📤]                   │
│                                                    │
│ ─── Voices in this cluster ───                     │
│ [████████████░░░] 68% Oficialista (3 fuentes)      │
│ [████░░░░░░░░░░░] 22% Neutral (1 fuente)           │
│ [█░░░░░░░░░░░░░░] 10% Opositor (1 fuente)         │
│                                                    │
│ ─── Also in this cluster ───                       │
│ • La Nación: Otra versión del mismo evento         │
│ • Infobae: terce versión con otro ángulo           │
└─────────────────────────────────────────────────────┘
```

---

## Responsive Strategy

### Mobile (< 768px)
- Single column feed
- Bottom nav (5 tabs)
- Cards are full-width rows
- Header: logo + actions right

### Tablet (768-1024px)
- Single column + no sidebar (sidebar becomes horizontal sections above feed)
- Bottom nav persists
- Cards slightly wider padding

### Desktop (> 1024px)
- **3-column layout**: left sidebar (nav + trending) | center feed | right sidebar (trending sources, categories, stats)
- Top nav replaces bottom nav
- Feed max-width: 600px centered in center column
- Cards can show images inline

---

## Motion & Interactions

- **Card press**: scale(0.98) + bg-hover transition, 100ms
- **Upvote**: heart bounce animation (scale 1 → 1.3 → 1), 200ms spring
- **Tab switch**: underline slides, 200ms ease
- **Pull to refresh**: arrow rotates + translate down, classic iOS pattern
- **Toast**: slide up from bottom, auto-dismiss 3s
- **Bottom nav**: icons scale on press, 80ms

### Reduced motion
All animations respect `prefers-reduced-motion: reduce` — replace with instant state changes.

---

## Icon Strategy

Use **Material Symbols Rounded** (not Outlined) at weight 300 for secondary, 400 for active.
Consistent 20px size for UI icons, 24px for nav icons.

---

## CSS Variable Architecture

All tokens defined on `:root` for light mode, `[data-theme="dark"]` for dark mode.
No class-based dark mode (media query only as fallback).

```css
:root {
  --bg-base: #F7F5F2;
  --bg-elevated: #FFFFFF;
  /* ... */
}

[data-theme="dark"] {
  --bg-base: #0F1117;
  --bg-elevated: #1A1D27;
  /* ... */
}
```

---

## Migration Priority

1. **CSS variables + tailwind config** — foundation
2. **NewsCard redesign** — the core component
3. **Social actions** — upvote/downvote on cards
4. **BottomNav** — mobile navigation
5. **FeedTabs** — Para vos / Explorar / etc
6. **Header redesign** — cleaner, logo-centric
7. **ArticleDetail redesign** — cleaner article view
8. **Sidebar redesign** — trending, sources, stats
9. **Search overlay** — full screen search with trending
10. **Theme toggle** — light/dark switch

---

## File Structure

After migration, key files:

```
src/
├── lib/
│   ├── design-tokens.css   # CSS variables only
│   ├── types.ts            # NewsItem, etc
│   └── ...
├── components/
│   ├── common/
│   │   ├── NewsCard.tsx    # Main timeline card
│   │   ├── BottomNav.tsx
│   │   ├── FeedTabs.tsx
│   │   └── ...
│   ├── layout/
│   │   ├── Header.tsx
│   │   └── Sidebar.tsx
│   └── article/
│       └── ArticleDetail.tsx
└── App.tsx
```