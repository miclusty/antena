# Antenna Dark Theme — Expert Review Findings

**Date:** 2026-05-05
**Status:** BLOCKED — incompatible with brand identity
**Task:** t_89264d2b
**Expert panel:** UX/Design, Frontend-SolidJS, CSS/Styling

## Verdict

**DO NOT PROCEED** with the Spotify/Linear/X dark theme proposal.

The proposed dark theme ("#171717 surface, #262626 border, #FF4500 orange accent, white text on black") is fundamentally incompatible with Antenna's brand identity: **editorial warmth meets political clarity**.

---

## Findings by Expert

### UX/Design Review
- Antenna's brand pillars are **cream backgrounds, terracotta accents, espresso text** — warm, editorial, ink-on-paper feeling
- The Spotify/Linear/X proposal replaces this with **cold black surfaces and harsh Reddit-orange** (#FF4500)
- The resulting aesthetic is "dashboard SaaS" not "Latin American digital magazine"
- **Risk:** Complete brand estrangement for existing readers

### Frontend-SolidJS Review
- Antenna uses CSS variables: `--bg-base`, `--bg-surface`, `--text-primary`, `--text-secondary`, `--border-base`
- The dark theme props would require: new variable system, inverted meaning of all existing tokens
- Breaking change for ALL components that currently use `bg-hover`/`text-muted`/`border` tokens
- Estimated scope: 40+ components touched, significant regression risk

### CSS/Styling Review
- Linear/X use `#FFFFFF` on `#000000` — pure contrast
- Antenna's editorial warmth uses cream (`#FAF7F2`) on white — softer, readable, respectful
- Replacing terracotta (`#C84B31`) with Reddit-orange (`#FF4500`) doubles the saturation — aggressive, not authoritative
- The proposed color system has **no grounding in the current design language**

---

## Recommended Direction

If a dark mode is desired for low-light reading:

1. **Preserve brand warmth** — Don't invert to pure black. Use `#1C1917` (warm charcoal) instead of `#171717`
2. **Keep terracotta** — It's Antenna's signature. Consider `#E07A5F` (muted terracotta) for dark mode
3. **Cream accent preservation** — `#FAF7F2` becomes a muted warm gray in dark mode: `#D4CFC7`
4. **Test before implementing** — Run the new tokens against the existing NewsCard, BiasBreakdownBar, and FeaturedCluster components before full rewrite

---

## Actions Required

1. **Archive** the 6 dark theme child tasks (t_97d9871a, t_c3452cc9, t_83d315da, t_496a79b9, t_1ca188a8, t_70698ee4)
2. **Mark parent** t_89264d2b as blocked with reference to this doc
3. **Create new task** for "Dark mode — warm variant" with brand-safe colors (do not use Linear/X as reference)
4. **Reference:** Antenna's existing CSS tokens in `packages/antena/src/App.tsx` and component library

---

*Expert review completed per kanban-orchestrator skill Phase 1b — 2026-05-05*
