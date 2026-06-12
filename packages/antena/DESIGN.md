---
version: alpha
name: Antenna
description: Argentine news aggregator PWA — editorial warmth meets political clarity

## Overview

Antenna is a SolidJS-powered news aggregator for Argentine readers. It surfaces multi-source coverage of national events, exposes political bias transparently, and works offline in the field. The UI is editorial and warm — like a well-designed print broadsheet rebuilt for mobile-first readers. The experience is serious but inviting: cream paper tones, confident typography, and a bias visualization system that treats readers as informed citizens, not targets to manipulate.

The brand mark is a radio antenna — the app "tunes in" to the Argentine information landscape and brings clarity to signal vs. noise.

## Colors

The palette is warm editorial — cream paper backgrounds, deep espresso text, and a terracotta primary that evokes Argentine clay and the warmth of print media. A political bias spectrum runs alongside the functional palette so readers always know the lean of what they're reading.

### Semantic Palette

- **Primary (#e25336):** Terracotta red — Argentine clay, newspaper mastheads, the single accent that drives all interaction (CTAs, active states, logo).
- **Primary Hover (#ff6b4a):** Lighter terracotta for hover states.
- **Background (#F9F6F0):** Warm cream — aged newsprint, the foundation of every screen.
- **Background Warm (#fbf9f8):** Slightly warmer surface for nested contexts.
- **Surface (#FFFFFF):** Pure white for cards and elevated content.
- **Foreground/Text (#3A332C):** Deep espresso — warm near-black for maximum legibility on cream.
- **Muted (#968C83):** Warm gray for metadata, timestamps, secondary labels.
- **Accent (#E8A37C):** Soft amber for highlight accents.
- **Border (#F0EAE1):** Warm cream border — subtle on the cream background.
- **Border Warm (#f3eae8):** Tinted border for hover/dividers.

### Political Bias Spectrum

Antenna's signature feature: a continuous bias gradient that maps any source's political leaning at a glance.

| Token | Color | Hex | Role |
|---|---|---|---|
| `bias.strong-officialist` | Dark blue | `#1A3A6B` | Kirchnerismo / hard Peronismo |
| `bias.mild-officialist` | Light blue | `#75AADB` | Peronismo / Kirchnerismo |
| `bias.neutral` | Warm gray | `#968C83` | Center / unclassified |
| `bias.mild-opposition` | Amber | `#E8A37C` | Moderate opposition |
| `bias.strong-opposition` | Yellow | `#F5C542` | PRO / JxC hard opposition |

The gradient is continuous — a score of +0.31 renders differently than +0.89 even within the same bucket, preserving the precision of the underlying score.

### Category Colors

News categories carry their own color for fast visual scanning:

| Category | Color | Hex |
|---|---|---|
| Política | Terracotta | `#e25336` |
| Economía | Amber | `#d97706` |
| Deportes | Green | `#16a34a` |
| Policiales | Red | `#dc2626` |
| Cultura | Purple | `#7c3aed` |
| Tecnología | Blue | `#2563eb` |
| Sociedad | Cyan | `#0891b2` |
| Internacional | Indigo | `#4f46e5` |
| Generales | Gray | `#6b7280` |

## Typography

**Manrope** (Google Fonts) — a single variable font for all text. Chosen for its warm geometric construction: confident without being cold. The geometric "e" and open apertures give it an editorial authority that Inter lacks.

### Type Scale

```yaml
typography:
  display-lg:
    fontFamily: Manrope
    fontSize: 1.75rem
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: -0.02em
  display-md:
    fontFamily: Manrope
    fontSize: 1.25rem
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.01em
  headline:
    fontFamily: Manrope
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.3
  body-lg:
    fontFamily: Manrope
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
  body-md:
    fontFamily: Manrope
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Manrope
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: Manrope
    fontSize: 0.75rem
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 0.05em
  label-upper:
    fontFamily: Manrope
    fontSize: 0.6875rem
    fontWeight: 700
    lineHeight: 1
    letterSpacing: 0.1em
  meta:
    fontFamily: Manrope
    fontSize: 0.6875rem
    fontWeight: 500
    lineHeight: 1.2
```

### Icon Font

**Material Symbols Rounded** (Google Fonts) — filled variant for primary actions, regular for secondary. Used for navigation icons, category icons, and interactive indicators. Size: 16px for inline, 20px for standalone.

## Layout

The layout is mobile-first single-column with a right panel on desktop. The hierarchy is: feed → article. No distractions between the reader and the news.

### Grid & Breakpoints

- **Mobile (< 640px):** Single column, full-width cards, bottom navigation.
- **Tablet (640–1024px):** Same single-column, wider max-width (640px).
- **Desktop (> 1024px):** Three-column: left sidebar (240px) + feed (flex-1, max 740px) + right panel (320px).

### Feed Structure

- **Max feed width:** 740px — optimal reading line length (~65 chars).
- **Sidebar width:** 320px — sources panel, filters, bias breakdown.
- **Desktop max:** 1200px — outer container constraint.
- **Card padding:** 16px horizontal, 12px vertical (comfortable density).
- **Section spacing:** 24px between major sections.

### Spacing Scale

```yaml
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  card-padding-x: 16px
  card-padding-y: 12px
  section-gap: 24px
```

## Elevation & Depth

Antenna uses **warm soft shadows** — never harsh or cold. Shadows express elevation but keep the warm paper tone of the background. Cards float slightly above the cream ground.

```yaml
shadow:
  card: "0 2px 8px rgba(58, 51, 44, 0.06)"
  soft: "0 8px 24px rgba(58, 51, 44, 0.08)"
  dial: "0 12px 36px rgba(58, 51, 44, 0.12)"
```

No harsh black shadows. The shadow color always tints toward espresso (#3A332C) rather than pure black, maintaining warmth.

### Backdrop

- **Header:** `bg-bg-cream/95` with `backdrop-blur-md` — frosted glass effect on scroll, cream with slight transparency.
- **Modals/panels:** White surface with soft shadow.

## Shapes

The shape language is **warmly rounded** — corners are generous but not bubbly. A 1rem (16px) radius for cards strikes the balance between approachable and editorial. Too sharp feels cold; too round feels casual.

```yaml
rounded:
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  full: 9999px
  card: 16px
  pill: 9999px
```

### Cards

News cards use `rounded-lg` (16px). Category chips and filter pills use `rounded-full` (pill). Action buttons use `rounded-md` (8px).

## Components

### NewsCard

The primary content unit. Two density modes:

**Comfortable (default):**
- Category color stripe (3px wide, left edge, full card height) + bias gradient stripe (2px, adjacent).
- Title in `font-semibold text-sm`, 3-line clamp.
- Source name + timestamp in `text-muted text-[11px]`.
- Bookmark/share actions on hover or long-press.

**Compact:**
- Inline row layout (no image), 48px height.
- Dual color stripe (3px + 2px, 20px total height, rounded).
- Title in `text-sm font-medium`, single line with ellipsis.
- No image, no excerpt.

### FeaturedCluster

A prominent card for trending multi-source stories. Rounded `bg-surface border border-border`, contains:
- Bias dot (6px, left).
- "Tendencia" label in `label-upper text-primary`.
- Source count badge.
- Headline in `body-sm font-medium`.
- Arrow icon right-aligned.

### BiasBreakdownBar

A horizontal stacked bar showing the political spectrum distribution of visible sources:
- 5 segments colored by bias spectrum.
- Labels below: "Oficialista" → "Neutral" → "Opositor".
- Animated fill on load.

### Header

- Sticky, `backdrop-blur-md` on cream.
- Logo: Antenna icon (radio symbol) + "antena." wordmark in Manrope 800.
- Category tabs: Reddit-style horizontal scroll with active border-bottom indicator.
- Search bar: Expandable on mobile, persistent on desktop.

### CategoryChip

Pill-shaped filter. States:
- Default: `bg-surface border border-border text-muted`.
- Active: `bg-primary/10 border-primary/30 text-primary`.
- Hover: `bg-surface/80`.

### Toast

Portal-based notification system. 4 variants:
- `info`: Blue tint, info icon.
- `success`: Green tint, check icon.
- `warning`: Amber tint, warning icon.
- `error`: Red tint, error icon.
- Auto-dismiss after 4s, manual dismiss via X button.

### PullToRefresh

Touch-pull gesture on mobile. Shows animated arrow indicator. Triggers haptic feedback on release.

## Do's and Don'ts

- **Do** use the primary terracotta exclusively for the single most important action per screen.
- **Do** maintain WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text).
- **Do** use the bias spectrum colors only for bias visualization — never decoratively.
- **Do** keep card density to two modes (compact/comfortable) — no middle ground that creates inconsistency.
- **Don't** mix sharp corners and rounded corners in the same view.
- **Don't** use more than two font weights on a single screen (weight 400 body + weight 600 headings is the sweet spot).
- **Don't** use the bias colors for non-bias UI elements (they carry political meaning).
- **Don't** show bias information for stories with fewer than 2 sources — insufficient data.
- **Don't** use dark backgrounds — Antenna is a daylight reading experience.
- **Don't** truncate headlines in the feed — the title is the primary decision signal for readers.
