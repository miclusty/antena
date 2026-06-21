# Mobile Article Reading Polish — Design Spec

**Date**: 2026-06-20
**Status**: Approved (user said "go" after proposal)
**Scope**: SSR article page at `/[year]/[month]/[day]/[slug]` (the static HTML route)

## Goal

Make reading a news article on a phone feel as polished as NYT mobile, Substack, or Medium — without sacrificing the mobile-first feed-first ethos of Antena. Close the gap between "the article loads and renders" (today) and "the article is a pleasure to read" (target).

## Background & Current State

The article page (`packages/antena/src/pages/[year]/[month]/[day]/[slug].astro`) is rendered at build time from the AKIRA API. It ships a JSON-LD blob, OG tags, breadcrumbs, a hero image, a lead summary, and the body in a `prose` div. It works, but:

| Gap | Symptom |
|---|---|
| Body too small on phones | text-base (16px) feels cramped on iOS Safari at default zoom |
| Measure too narrow on small phones | container 680px max + px-4 leaves ~55ch on a 375px viewport (Substack-style ~65ch feels better) |
| No safe-area-inset | Notched phones (iPhone 12+, Pixel 6+) lose top/bottom space under status bar / home indicator |
| Empty `.prose` class | The class is applied but no CSS exists for `prose h2/h3/blockquote/code/ul/ol` — body text gets no rich formatting even though AKIRA includes headings |
| No reading time | User has no idea how long the article is before committing |
| No TOC | The body contains 2-5 h2/h3 sections. On a long article, navigation is impossible |
| No progress indicator | Once you're 3 paragraphs in you can't tell where you are |
| Cluster hidden | "3 fuentes cubren esto" data is in `cluster_id` and `sources_count` but never rendered |
| Bias hidden | `bias_score` is computed in the mapper but never shown on the SSR page |
| Engagement minimal | No share button on the SSR page, no vote count, no bookmark |
| No reading-mode toggle | Mobile readers often want larger text / sepia / dark |
| No back-to-top | On long articles users get lost at the bottom |

The cluster nav buttons (A11y P0 #4) and image gallery (Readability P0-3) from prior commits only show on the SPA `ArticleDetail.tsx` view, **not** on the SSR page that 95%+ of mobile readers hit. This design fixes the SSR page.

## Approach

Four pillars, in dependency order. Each pillar is independently shippable.

### Pillar 1: Typography & spacing (foundation)

**Goal**: Make the body text feel right on any phone. Every other pillar depends on this.

Changes in `[slug].astro`:

- Replace `max-w-[680px]` with `max-w-[68ch]` (a measure-based constraint, not pixel). `68ch` ≈ 65-72 chars at 16-18px font, which is the mobile-readable sweet spot.
- Body `text-base` → `text-[17px] sm:text-base` (17px on mobile, 16px on sm+ viewports).
- Summary `text-lg` → `text-[19px] sm:text-lg`.
- Body line-height `leading-relaxed` (1.625) → `leading-[1.7]`.
- Add `pt-[max(env(safe-area-inset-top),1rem)]` and `pb-[max(env(safe-area-inset-bottom),1rem)]` to `<main>` for notched phones.
- H1 `text-[28px]` → `text-[30px] sm:text-[32px]` with `leading-[1.2]` for tighter display headline.

Changes in a new `packages/antena/src/styles/article-prose.css` (imported by `[slug].astro` only — keeps global CSS lean):

```css
.article-prose { /* replaces empty .prose */
  /* Headings: tighter vertical rhythm, scroll-margin so anchor
     links from the TOC don't hide under sticky UI. */
}
.article-prose h2 { font-size: 1.375rem; font-weight: 700; margin-top: 2.5rem; margin-bottom: 0.75rem; scroll-margin-top: 80px; line-height: 1.25; }
.article-prose h3 { font-size: 1.125rem; font-weight: 600; margin-top: 2rem; margin-bottom: 0.5rem; scroll-margin-top: 80px; line-height: 1.3; }
.article-prose p  { margin-top: 0; margin-bottom: 1.25rem; }
.article-prose ul, .article-prose ol { margin: 1.25rem 0; padding-left: 1.5rem; }
.article-prose ul { list-style: disc; }
.article-prose ol { list-style: decimal; }
.article-prose li { margin-bottom: 0.5rem; }
.article-prose blockquote { border-left: 3px solid var(--accent); padding-left: 1rem; margin: 1.5rem 0; font-style: italic; color: var(--text-tertiary); }
.article-prose a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.article-prose a:hover { text-decoration-thickness: 2px; }
.article-prose code { background: var(--bg-elevated); padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-family: ui-monospace, monospace; font-size: 0.9em; }
.article-prose pre { background: var(--bg-elevated); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 1.5rem 0; }
.article-prose pre code { background: transparent; padding: 0; }
.article-prose img { max-width: 100%; height: auto; border-radius: 0.75rem; margin: 1.5rem auto; }
.article-prose figure { margin: 1.5rem 0; }
.article-prose figcaption { text-align: center; font-size: 0.875rem; color: var(--text-tertiary); margin-top: 0.5rem; }
.article-prose hr { border: 0; border-top: 1px solid var(--border-base); margin: 2.5rem auto; width: 30%; }

@media (prefers-reduced-motion: reduce) {
  .article-prose * { animation: none !important; transition: none !important; }
}
```

The hero image inside the `<figure>` (rendered by the page directly) keeps its own `rounded-xl` class. Embedded `<img>` inside the body uses the `.article-prose img` rule.

### Pillar 2: Reading aids (information density)

**Goal**: User knows what they're getting into, can navigate within the article, and can resume their place.

In `[slug].astro`, after the byline, add a meta line:

```astro
<p class="mt-2 text-sm flex items-center gap-3 flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
  <span>⏱ {Math.max(1, Math.round((article.body?.length ?? 0) / 1200))} min de lectura</span>
  {article.sources_count && article.sources_count > 1 && (
    <a href={`/api/news/${article.id}/cluster`} class="hover:underline" style={{ color: 'var(--accent)' }}>
      📰 {article.sources_count} fuentes cubren esto
    </a>
  )}
  {typeof article.bias_score === 'number' && (
    <span title={`Bias ${article.bias_score.toFixed(2)}`} class="badge" data-bias={article.bias_score}>
      ⚖ {article.bias_score > 0.1 ? 'Of.' : article.bias_score < -0.1 ? 'Op.' : 'Neutro'} {article.bias_score > 0 ? '+' : ''}{article.bias_score.toFixed(2)}
    </span>
  )}
</p>
```

Reading time formula: 1200 chars/minute for Spanish text (a comfortable adult reading rate is 200-250 wpm; Spanish averages ~5 chars per word + spaces, so 1200 chars/min ≈ 220 wpm). Floor at 1 min.

Add a CSS-only scroll progress bar (no JS):

```astro
<div class="article-progress" aria-hidden="true">
  <div class="article-progress-bar"></div>
</div>
```

```css
.article-progress {
  position: sticky;
  top: 0;
  height: 3px;
  background: transparent;
  z-index: 50;
}
.article-progress-bar {
  height: 100%;
  background: var(--accent);
  width: 0%;
  animation: progress-grow linear;
  animation-timeline: scroll(root);
}
@keyframes progress-grow {
  from { width: 0%; }
  to   { width: 100%; }
}
```

Note: `animation-timeline: scroll(root)` is the modern scroll-driven animations API. Safari supports it from 17.4+. Older browsers get a static bar that does nothing — graceful degradation.

TOC (Table of Contents), generated server-side from h2/h3 in `article.body`:

- New helper `extractHeadings(body: string): Array<{ level: 2|3; text: string; id: string }>` in `packages/antena/src/lib/article-toc.ts`. Parses `<h2>` and `<h3>` from the sanitized body. Slugifies the text into `id`s.
- In `[slug].astro`, render a `<details>` element after the summary, closed by default, with a `<summary>` "📑 Contenido" + the list of headings as anchor links.
- If `< 2 headings`, skip the TOC entirely (don't render the empty `<details>`).

```astro
{headings.length >= 2 && (
  <details class="mt-6 rounded-xl border p-4" style={{ borderColor: 'var(--border-base)', background: 'var(--bg-elevated)' }}>
    <summary class="cursor-pointer font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
      📑 Contenido ({headings.length} secciones)
    </summary>
    <ol class="mt-3 space-y-1.5 text-sm">
      {headings.map(h => (
        <li class={h.level === 3 ? 'ml-4' : ''}>
          <a href={`#${h.id}`} class="hover:underline" style={{ color: 'var(--text-secondary)' }}>{h.text}</a>
        </li>
      ))}
    </ol>
  </details>
)}
```

The body rendering uses `innerHTML` for sanitized HTML. The h2/h3 elements need `id` attributes added server-side. Modify `article.body` server-side: walk the HTML, for each `<h2>`/`<h3>`, derive an `id` from the inner text (slugified, deduplicated), and inject `id="..."` into the opening tag. This keeps anchor links stable across SSR and the SPA overlay.

### Pillar 3: Engagement inline (above the fold of intent)

**Goal**: The user can act on the article without scrolling to a separate FAB.

**Cluster badge**: Rendered in the meta line above (Pillar 2). Click → cluster page.

**Bias chip**: Rendered in the meta line above (Pillar 2). Hover/click → tooltip explaining the score (no extra page; it's just a `<span title>` for now). Future: link to a `/metodologia` page when the methodology doc lands.

**Inline vote bar** at the end of the article:

```astro
{article.id && (
  <div class="mt-8 pt-6 border-t flex items-center justify-between flex-wrap gap-4" style={{ borderColor: 'var(--border-base)' }}>
    <div class="flex items-center gap-2">
      <span class="text-sm" style={{ color: 'var(--text-tertiary)' }}>¿Te resultó útil?</span>
      <button class="px-3 py-1.5 rounded-full text-sm font-medium hover:bg-bg-hover" data-vote="1" data-news-id={article.id}>👍 {article.upvotes ?? 0}</button>
      <button class="px-3 py-1.5 rounded-full text-sm font-medium hover:bg-bg-hover" data-vote="-1" data-news-id={article.id}>👎 {article.downvotes ?? 0}</button>
    </div>
    <div class="flex items-center gap-2 text-sm">
      <a href={`/buscar?q=${encodeURIComponent(article.title)}`} class="px-3 py-1.5 rounded-full hover:bg-bg-hover" style={{ color: 'var(--text-secondary)' }}>🔍 Cobertura completa</a>
    </div>
  </div>
)}
```

The vote buttons post to `/api/news/{id}/vote` (existing endpoint). Add a tiny inline script (~10 lines) to handle the click. No new dependencies. The script is non-blocking (deferred) and only registers listeners for `[data-vote]` buttons present on the page.

**Floating action bar** (mobile only, hidden on `sm:` and up):

```astro
<nav class="article-fab sm:hidden" aria-label="Acciones rápidas">
  <button data-action="share">📤</button>
  <button data-action="bookmark">🔖</button>
  <button data-action="read-mode">📖</button>
  <button data-action="back-to-top">🔝</button>
</nav>
```

CSS:
```css
.article-fab {
  position: fixed;
  bottom: max(env(safe-area-inset-bottom), 1rem);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border-base);
  border-radius: 9999px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  z-index: 40;
}
.article-fab button {
  width: 44px;
  height: 44px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.125rem;
  background: transparent;
  border: 0;
  color: var(--text-primary);
  cursor: pointer;
}
.article-fab button:hover { background: var(--bg-hover); }
.article-fab button:active { transform: scale(0.92); }
```

The back-to-top button is hidden until scroll > 50%. The read-mode button toggles a class on `<html>` that the rest of the CSS hooks into.

JavaScript for FAB: ~40 lines inline script that:
- Shares via `navigator.share()` if available, else falls back to copying URL.
- Bookmarks via IndexedDB (existing `antena-db` store).
- Toggles `.reading-mode` class on `<html>`.
- Shows back-to-top only after `window.scrollY > document.body.scrollHeight * 0.5`.

**Source line at the end** of the article:

```astro
<footer class="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border-base)' }}>
  <p class="text-sm" style={{ color: 'var(--text-tertiary)' }}>
    Fuente original: <a href={article.source_url} target="_blank" rel="noopener noreferrer" class="font-semibold hover:underline" style={{ color: 'var(--accent)' }}>{article.source_name}</a>
  </p>
  <p class="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
    Sintetizado por AKIRA · {article.sources_count} {article.sources_count === 1 ? 'fuente' : 'fuentes'}
  </p>
</footer>
```

### Pillar 4: Reading mode & a11y

**Goal**: User can adapt the article to their eyes and context.

Reading mode (toggled by the FAB or via `prefers-color-scheme: light`):

```css
html.reading-mode {
  --bg-base: #FAF6EE;        /* warm paper */
  --bg-elevated: #F2EBD9;
  --text-primary: #1F1B16;
  --text-secondary: #3D362B;
  --text-tertiary: #6B6253;
  --border-base: #D9CFB7;
  --accent: #8B5A2B;         /* muted brown */
  --font-display: Georgia, 'Source Serif Pro', serif;
  --font-body: Georgia, 'Source Serif Pro', serif;
}
html.reading-mode .article-prose { font-size: 1.0625rem; } /* 17px */
html.reading-mode .article-prose h2 { font-size: 1.5rem; }
html.reading-mode .article-prose h3 { font-size: 1.25rem; }
html.reading-mode .article-prose blockquote { font-style: italic; }
```

Reading mode is opt-in (default off). The user toggles it with the FAB. We do NOT auto-enable on `prefers-color-scheme: light` because the existing dark theme is intentional.

Font size scaling: stored in `localStorage` under key `antena-article-font-scale`. Three sizes: 100% (default), 112.5%, 125%. Slider in the FAB? No — too crowded. Instead, the read-mode FAB cycles: small → medium → large → small.

```js
const sizes = [1, 1.125, 1.25];
const next = (current + 1) % sizes.length;
document.documentElement.style.setProperty('--article-font-scale', sizes[next]);
localStorage.setItem('antena-article-font-scale', String(sizes[next]));
```

CSS:
```css
.article-prose { font-size: calc(1rem * var(--article-font-scale, 1)); }
```

Save-data mode (`navigator.connection?.saveData === true` OR `prefers-reduced-data: reduce`):

- Skip lazy-loading hero image (already eager, no change there).
- Hide inline images in body (`<img>` inside body become `<details>` placeholders "Tap to load image").
- Skip the FAB (it requires JS; in save-data mode we still show it but defer JS loading).
- This is detection at runtime, not a build flag.

Keyboard navigation:
- TOC anchor links are already keyboard-accessible (they're `<a>` elements).
- The FAB buttons must have visible focus rings (`:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`).
- `prefers-reduced-motion` disables the progress bar animation.

## Components & Files

**New files**:
- `packages/antena/src/styles/article-prose.css` — pillar 1 prose styles + pillar 4 reading mode
- `packages/antena/src/lib/article-toc.ts` — pillar 2 `extractHeadings()` helper with slugify + dedupe
- `packages/antena/src/lib/article-toc.test.ts` — unit tests for the helper (existing vitest setup)

**Modified files**:
- `packages/antena/src/pages/[year]/[month]/[day]/[slug].astro` — all four pillars land here
- `packages/antena/src/lib/design-tokens.css` — add `--article-font-scale` token (default `1`)

**No new dependencies**. No new routes. No new API endpoints. The vote endpoint `/api/news/{id}/vote` already exists.

## Data Flow

```
Build time (Astro getStaticPaths):
  article (SsrArticle) ──┬── extractHeadings(article.body) → headings[]
                         ├── reading_time = max(1, body.length / 1200) min
                         ├── sources_count, bias_score → meta line
                         └── article.body mutated: h2/h3 get id="..."
                                                 ↓
                                          SSR renders HTML
                                                 ↓
                              Browser parses HTML, loads inline scripts
                                                 ↓
                              FAB JS wires up: share / bookmark / read-mode / back-to-top
                              Vote buttons POST /api/news/{id}/vote
                              IndexedDB bookmark sync
```

The `article.body` mutation (adding `id` to h2/h3) is the only thing that mutates input. It's done in a copy: `const bodyWithIds = addHeadingIds(article.body)`. Original `article.body` stays unchanged.

## Error Handling

- `extractHeadings` returns `[]` on any parse failure. The TOC `<details>` only renders when `headings.length >= 2`.
- Vote POST errors: inline script catches the network error and shows a transient toast (existing toast component) "No se pudo registrar tu voto".
- FAB bookmark: IndexedDB write wrapped in try/catch. On error, show "No se pudo guardar" toast.
- Missing `article.body` (some legacy articles): Pillar 1 prose CSS just renders nothing in the body div. Reading time falls back to summary length / 1200.

## Testing

Unit tests for `extractHeadings`:
- Parses `<h2>foo</h2><h3>bar</h3>` correctly.
- Generates stable, slugified IDs.
- Dedupes repeated headings (`<h2>foo</h2><h2>foo</h2>` → IDs `foo`, `foo-1`).
- Returns empty array on empty input or all-text input.
- Handles headings with HTML entities (`<h2>foo &amp; bar</h2>` → text "foo & bar", id `foo-bar`).
- Ignores non-h2/h3 tags.

Visual regression: smoke test by curling the SSR'd HTML of one article on staging and grepping for: `class="article-prose"`, `class="article-fab"`, `details`, `inline-script-data-vote`. These four greps cover all four pillars in <5 seconds.

Lighthouse: target LCP <2.0s on mobile (3G Fast), CLS <0.05, TBT <100ms. Existing hero image optimization (srcset + fetchpriority) carries over.

## Acceptance Criteria

The implementation is complete when:

1. Typographic baseline: body text on a 375px viewport iPhone shows 17px font, line-height 1.7, and ~65ch measure.
2. Safe-area-inset: notched phones lose no content under the status bar.
3. Headings inside body get anchor IDs and the TOC works.
4. Reading time renders correctly.
5. Cluster badge and bias chip appear when data exists.
6. FAB visible on mobile, hidden on `sm:` and up.
7. Back-to-top FAB appears only after 50% scroll.
8. Vote buttons POST successfully and show toast on error.
9. Reading mode toggle cycles 100/112.5/125% and persists across navigation.
10. Save-data mode hides inline images.
11. `prefers-reduced-motion` disables animations.
12. Lighthouse mobile score ≥ 95.
13. No new test failures; existing 5 pre-existing failures unchanged.
14. No new typecheck errors; existing 5 pre-existing errors unchanged.

## Out of Scope (YAGNI)

- Comments section (deferred — no product decision yet).
- Audio narration (TTS was mentioned in the original AGENTS.md as a future P3).
- Cross-device sync of reading position (no auth system yet).
- Per-user font-size preferences in the cloud (only localStorage).
- Editor-side controls (this is a read-only spec; no CMS work).
- Comments counts / popularity shown above the fold (low signal on the SSR page).
- Related articles strip below the body (could be a follow-up; not blocking the reading experience itself).

## Risks

- **`animation-timeline: scroll(root)` is bleeding-edge.** Safari 17.4+, Chrome 115+, Firefox 134+. Older browsers get a static bar. Acceptable degradation. Documented in the CSS comment.
- **Inline scripts in Astro** require a CSP exception if we add one later. For now Antena has no CSP. If CSP gets added, `script-src 'unsafe-inline'` is needed for the FAB + vote scripts. Document this in the CSS comment + a TODO in the page.
- **Mutation of `article.body` to add IDs** could be done in a third-party sanitizer. We use the existing `sanitizeArticleHtmlForView` (already imported in `[slug].astro`). The new `addHeadingIds` helper runs AFTER sanitization. If sanitization strips h2/h3 (it shouldn't — both are allowed tags), the TOC becomes empty. We can detect this with the test.
- **Reading time formula** is approximate. 1200 chars/min is fine for casual reading; doesn't replace real `getReadingTime()` from `reading-time` package. Out of scope.

## Open Questions

None blocking. The user approved approach C ("Full sweep") in the brainstorming round.