# Mobile Article Reading Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the SSR article page at `/[year]/[month]/[day]/[slug]` for mobile reading — better typography, reading aids (TOC, progress, time), inline engagement (cluster, bias, votes), and reading-mode toggle.

**Architecture:** Pure CSS + Astro frontmatter + small inline JS for the FAB. No new dependencies. Existing `/api/news/{id}/vote` endpoint reused. Existing IndexedDB `antena-db` store reused for bookmarks.

**Tech Stack:** Astro 6 (SSR static build), Tailwind 4, vanilla CSS, vanilla JS (no Solid for this page — it's static HTML), existing vitest test setup.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/antena/src/lib/article-toc.ts` | CREATE | `extractHeadings()` + `addHeadingIds()` helpers |
| `packages/antena/src/lib/article-toc.test.ts` | CREATE | vitest tests for the helpers |
| `packages/antena/src/styles/article-prose.css` | CREATE | `.article-prose` styles + reading-mode CSS + progress bar |
| `packages/antena/src/lib/design-tokens.css` | MODIFY | Add `--article-font-scale: 1` token to `:root` |
| `packages/antena/src/pages/[year]/[month]/[day]/[slug].astro` | MODIFY | Apply all 4 pillars (typography, reading aids, engagement, reading mode) |

The article page change is large. Keep it inside `[slug].astro` (don't split into a Solid component) because it's static HTML — no reactivity needed.

---

## Task 1: `extractHeadings()` helper with TDD

**Files:**
- Create: `packages/antena/src/lib/article-toc.ts`
- Test: `packages/antena/src/lib/article-toc.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/antena/src/lib/article-toc.test.ts
import { describe, it, expect } from 'vitest';
import { extractHeadings, addHeadingIds } from './article-toc';

describe('extractHeadings', () => {
  it('returns empty array for empty input', () => {
    expect(extractHeadings('')).toEqual([]);
  });

  it('returns empty array for input without h2/h3', () => {
    expect(extractHeadings('<p>just a paragraph</p>')).toEqual([]);
  });

  it('parses a single h2', () => {
    const html = '<h2>Hello world</h2>';
    expect(extractHeadings(html)).toEqual([
      { level: 2, text: 'Hello world', id: 'hello-world' },
    ]);
  });

  it('parses mixed h2 and h3', () => {
    const html = '<h2>Top</h2><h3>Sub</h3><h2>Another</h2>';
    expect(extractHeadings(html)).toEqual([
      { level: 2, text: 'Top', id: 'top' },
      { level: 3, text: 'Sub', id: 'sub' },
      { level: 2, text: 'Another', id: 'another' },
    ]);
  });

  it('deduplicates repeated headings', () => {
    const html = '<h2>foo</h2><h2>foo</h2><h2>foo</h2>';
    expect(extractHeadings(html)).toEqual([
      { level: 2, text: 'foo', id: 'foo' },
      { level: 2, text: 'foo', id: 'foo-1' },
      { level: 2, text: 'foo', id: 'foo-2' },
    ]);
  });

  it('handles HTML entities', () => {
    const html = '<h2>foo &amp; bar</h2>';
    expect(extractHeadings(html)).toEqual([
      { level: 2, text: 'foo & bar', id: 'foo-bar' },
    ]);
  });

  it('strips nested tags from heading text', () => {
    const html = '<h2>foo <strong>bar</strong> baz</h2>';
    expect(extractHeadings(html)).toEqual([
      { level: 2, text: 'foo bar baz', id: 'foo-bar-baz' },
    ]);
  });
});

describe('addHeadingIds', () => {
  it('returns input unchanged when no headings', () => {
    expect(addHeadingIds('<p>nothing here</p>')).toBe('<p>nothing here</p>');
  });

  it('adds id to a single h2', () => {
    expect(addHeadingIds('<h2>Hello</h2>')).toBe('<h2 id="hello">Hello</h2>');
  });

  it('preserves existing attributes', () => {
    expect(addHeadingIds('<h2 class="x">Hi</h2>')).toBe('<h2 class="x" id="hi">Hi</h2>');
  });

  it('does not duplicate ids when called twice', () => {
    const once = addHeadingIds('<h2>foo</h2><h2>foo</h2>');
    const twice = addHeadingIds(once);
    expect(twice).toBe(once);
  });

  it('handles mixed h2 and h3', () => {
    const result = addHeadingIds('<h2>Top</h2><h3>Sub</h3>');
    expect(result).toBe('<h2 id="top">Top</h2><h3 id="sub">Sub</h3>');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter antena test -- article-toc`
Expected: FAIL with "Cannot find module './article-toc'" or "extractHeadings is not a function"

- [ ] **Step 3: Implement the helpers**

```typescript
// packages/antena/src/lib/article-toc.ts
/**
 * Parse h2/h3 headings out of a sanitized HTML article body.
 * Returns an array of { level, text, id } for use in the SSR
 * table-of-contents. IDs are slugified and deduplicated so they
 * are stable as both anchor targets and keys in the React/Solid
 * overlay (ArticleDetail.tsx) on the SPA path.
 */
export interface ArticleHeading {
  level: 2 | 3;
  text: string;
  id: string;
}

const SLUG_MAX = 80;

export function slugifyHeading(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')        // strip accents
    .toLowerCase()
    .replace(/&[a-z]+;/g, ' ')                // strip named entities (&amp; etc.)
    .replace(/&#\d+;/g, ' ')                 // strip numeric entities
    .replace(/<[^>]*>/g, ' ')                 // strip any nested tags
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '') || 'section';
}

export function extractHeadings(html: string): ArticleHeading[] {
  const headings: ArticleHeading[] = [];
  const seen = new Map<string, number>();
  // Match h2 or h3 opening tag, then capture inner text up to the
  // closing tag. Non-greedy so we stop at the first </h2>/</h3>.
  const re = /<h([23])(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const level = Number(m[1]) as 2 | 3;
    const inner = m[2].replace(/<[^>]+>/g, '').trim();
    if (!inner) continue;
    const base = slugifyHeading(inner);
    const seenCount = seen.get(base) ?? 0;
    seen.set(base, seenCount + 1);
    const id = seenCount === 0 ? base : `${base}-${seenCount}`;
    headings.push({ level, text: inner, id });
  }
  return headings;
}

/**
 * Walk h2/h3 elements in an HTML string and inject id="..." derived
 * from the inner text. Idempotent: running twice on the same input
 * is a no-op (already has ids).
 */
export function addHeadingIds(html: string): string {
  const seen = new Set<string>();
  return html.replace(
    /<h([23])((?:\s[^>]*)?)>([\s\S]*?)<\/\1>/gi,
    (_full, level: string, attrs: string, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').trim();
      let id = slugifyHeading(text);
      let suffix = 1;
      while (seen.has(id)) id = `${slugifyHeading(text)}-${suffix++}`;
      seen.add(id);
      const existingIdMatch = /\bid="[^"]*"/.exec(attrs);
      if (existingIdMatch) return `<h${level}${attrs}>${inner}</h${level}>`;
      return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter antena test -- article-toc`
Expected: PASS, 12 tests passing

- [ ] **Step 5: Commit**

```bash
git add packages/antena/src/lib/article-toc.ts packages/antena/src/lib/article-toc.test.ts
git commit -m "feat(article-toc): extractHeadings + addHeadingIds helpers with tests"
```

---

## Task 2: Create `article-prose.css` with pillar 1 + 4 styles

**Files:**
- Create: `packages/antena/src/styles/article-prose.css`

- [ ] **Step 1: Write the CSS file**

```css
/* packages/antena/src/styles/article-prose.css
 *
 * Article body styles. Imported ONLY by the SSR article page at
 * /[year]/[month]/[day]/[slug].astro to keep the global bundle lean.
 *
 * Covers:
 *  - Pillar 1: typography for h2/h3/blockquote/code/pre/lists/figures
 *  - Pillar 2: scroll progress bar (CSS-only, scroll-driven animations)
 *  - Pillar 4: reading-mode (paper/sepia), font-size scaling,
 *               prefers-reduced-motion overrides
 *
 * Token dependency: var(--article-font-scale) is declared in
 * design-tokens.css :root with default 1. Reading-mode overrides it
 * via JS (set on :root.style) when the user taps the FAB.
 */

/* ── Body prose ─────────────────────────────────────────────── */
.article-prose h2 {
  font-size: 1.375rem;
  font-weight: 700;
  margin-top: 2.5rem;
  margin-bottom: 0.75rem;
  scroll-margin-top: 80px;
  line-height: 1.25;
  color: var(--text-primary);
}

.article-prose h3 {
  font-size: 1.125rem;
  font-weight: 600;
  margin-top: 2rem;
  margin-bottom: 0.5rem;
  scroll-margin-top: 80px;
  line-height: 1.3;
  color: var(--text-primary);
}

.article-prose p {
  margin-top: 0;
  margin-bottom: 1.25rem;
}

.article-prose ul,
.article-prose ol {
  margin: 1.25rem 0;
  padding-left: 1.5rem;
}

.article-prose ul { list-style: disc; }
.article-prose ol { list-style: decimal; }

.article-prose li {
  margin-bottom: 0.5rem;
}

.article-prose blockquote {
  border-left: 3px solid var(--accent);
  padding-left: 1rem;
  margin: 1.5rem 0;
  font-style: italic;
  color: var(--text-tertiary);
}

.article-prose a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.article-prose a:hover {
  text-decoration-thickness: 2px;
}

.article-prose code {
  background: var(--bg-elevated);
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}

.article-prose pre {
  background: var(--bg-elevated);
  padding: 1rem;
  border-radius: 0.5rem;
  overflow-x: auto;
  margin: 1.5rem 0;
}

.article-prose pre code {
  background: transparent;
  padding: 0;
}

.article-prose img {
  max-width: 100%;
  height: auto;
  border-radius: 0.75rem;
  margin: 1.5rem auto;
  display: block;
}

.article-prose figure {
  margin: 1.5rem 0;
}

.article-prose figcaption {
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-tertiary);
  margin-top: 0.5rem;
}

.article-prose hr {
  border: 0;
  border-top: 1px solid var(--border-base);
  margin: 2.5rem auto;
  width: 30%;
}

/* Apply user's chosen reading-size scale to the whole prose block. */
.article-prose {
  font-size: calc(1rem * var(--article-font-scale, 1));
}

/* ── Scroll progress bar (CSS-only, scroll-driven) ──────────── */
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

/* ── Reading mode (paper/sepia) ─────────────────────────────── */
html.reading-mode {
  --bg-base: #FAF6EE;
  --bg-elevated: #F2EBD9;
  --text-primary: #1F1B16;
  --text-secondary: #3D362B;
  --text-tertiary: #6B6253;
  --border-base: #D9CFB7;
  --accent: #8B5A2B;
  --font-display: Georgia, 'Source Serif Pro', serif;
  --font-body: Georgia, 'Source Serif Pro', serif;
}

html.reading-mode .article-prose {
  font-size: calc(1.0625rem * var(--article-font-scale, 1));
}

html.reading-mode .article-prose h2 {
  font-size: 1.5rem;
}

html.reading-mode .article-prose h3 {
  font-size: 1.25rem;
}

html.reading-mode .article-prose blockquote {
  font-style: italic;
}

/* ── Reduced motion ────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .article-progress-bar {
    animation: none;
  }
  .article-fab button:active {
    transform: none;
  }
}
```

- [ ] **Step 2: Add `--article-font-scale` token to design-tokens.css**

Open `packages/antena/src/lib/design-tokens.css`. In the `:root { ... }` block, find a logical spot near other scale tokens and add:

```css
  --article-font-scale: 1; /* Pillar 4 reading-mode size multiplier (1 / 1.125 / 1.25) */
```

- [ ] **Step 3: Verify build still works**

Run: `cd packages/antena && pnpm exec astro build 2>&1 | tail -5`
Expected: Build completes (we haven't imported the new CSS yet, just confirmed no token regression)

- [ ] **Step 4: Commit**

```bash
git add packages/antena/src/styles/article-prose.css packages/antena/src/lib/design-tokens.css
git commit -m "feat(article): prose styles + scroll progress bar + reading-mode CSS"
```

---

## Task 3: Update `[slug].astro` — Pillars 1, 2, 3, 4

**Files:**
- Modify: `packages/antena/src/pages/[year]/[month]/[day]/[slug].astro`

This is one large task because the four pillars all land in the same file. Splitting them across separate tasks would require intermediate broken states (e.g., adding the FAB before the styles exist). Instead, do all four changes in one commit, smoke-tested by curling the output.

- [ ] **Step 1: Add CSS import + use extractHeadings/addHeadingIds**

Add the import at the top of the frontmatter (after the existing imports, around line 14):

```astro
---
// (existing imports up top — Layout, SeoHead)
import Layout from '../../../../layouts/Layout.astro';
import SeoHead from '../../../../components/SeoHead.astro';
import { extractHeadings, addHeadingIds } from '../../../../lib/article-toc';

// ── Pillar 4: Reading-mode font-scale persistence ──────
// Apply persisted scale on first render so the SSR HTML reflects
// the user's last choice. localStorage is unavailable at build time;
// we read it in the inline <script> below and apply it client-side.
---
```

- [ ] **Step 2: Compute headings + reading time + body-with-ids in frontmatter**

After the `const { article } = Astro.props` line (~line 128), add:

```ts
const headings = extractHeadings(article.body ?? '');
const bodyWithIds = addHeadingIds(article.body ?? '');
// 1200 chars/min for Spanish casual reading. Floor at 1 min so a
// short summary doesn't show "0 min".
const readingMinutes = Math.max(1, Math.round(((article.body?.length ?? 0) + (article.summary?.length ?? 0)) / 1200));
const biasLabel =
  typeof article.bias_score === 'number'
    ? article.bias_score > 0.1 ? 'Of.' : article.bias_score < -0.1 ? 'Op.' : 'Neutro'
    : null;
```

Then change `const { article } = Astro.props as ...` to keep using the same `article` variable, but assign a mutated body where the markup is rendered. We'll pass `bodyWithIds` to the JSX (see step 3).

- [ ] **Step 3: Update the JSX — `<main>` padding, container width, summary, body, meta, TOC, FAB, footer**

This is the largest edit. Replace from `<main id="main-content" ...` (line 226) through the closing `</main>` and `</Layout>` (line 301) with:

```astro
  <main
    id="main-content"
    class="max-w-[68ch] mx-auto px-4 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),2rem)]"
    tabindex="-1"
  >
    <div class="article-progress" aria-hidden="true">
      <div class="article-progress-bar"></div>
    </div>

    <nav aria-label="Breadcrumb" class="mb-6">
      <ol class="flex items-center gap-1.5 text-xs flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
        <li><a href="/" class="hover:underline" style={{ color: 'var(--accent)' }}>Inicio</a></li>
        {article.category && (
          <>
            <li aria-hidden="true">›</li>
            <li><a href={`/categoria/${slugify(article.category)}`} class="hover:underline" style={{ color: 'var(--accent)' }}>{article.category}</a></li>
          </>
        )}
        {article.location_name && (
          <>
            <li aria-hidden="true">›</li>
            <li><a href={`/ciudad/${slugify(article.location_name)}`} class="hover:underline" style={{ color: 'var(--accent)' }}>{article.location_name}</a></li>
          </>
        )}
        <li aria-hidden="true">›</li>
        <li class="truncate max-w-[200px]" style={{ color: 'var(--text-secondary)' }} aria-current="page">{title}</li>
      </ol>
    </nav>

    <article class="mt-6">
      <header>
        <p class="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--text-tertiary)' }}>
          {article.category || 'General'}
          {article.location_name && <> · {article.location_name}</>}
        </p>
        <h1 class="text-[30px] sm:text-[32px] font-bold leading-[1.2]" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h1>
        <p class="mt-3 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Por <span style={{ color: 'var(--text-secondary)' }}>{author}</span>
          {' · '}
          <time datetime={publishedAt}>
            {new Date(publishedAt).toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' })}
          </time>
        </p>

        {/* Pillar 2: meta line with reading time + cluster + bias */}
        <p class="mt-3 text-sm flex items-center gap-3 flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
          <span aria-label="Tiempo de lectura">⏱ {readingMinutes} min de lectura</span>
          {(article.sources_count ?? 0) > 1 && (
            <a
              href={`/2026/${(article.slug_date ?? '').split('-').join('/')}/${article.slug}/cluster`}
              class="hover:underline"
              style={{ color: 'var(--accent)' }}
            >
              📰 {article.sources_count} fuentes cubren esto
            </a>
          )}
          {biasLabel && (
            <span title={`Bias score: ${article.bias_score?.toFixed(2)}`}>⚖ {biasLabel} {(article.bias_score! > 0 ? '+' : '') + article.bias_score!.toFixed(2)}</span>
          )}
        </p>
      </header>

      {article.image_url && (
        <figure class="mt-6">
          <img
            src={`https://akira-api.miclusty.workers.dev/api/img?url=${encodeURIComponent(article.image_url)}&w=1200&q=75&fmt=webp&fit=cover`}
            srcset={`
              https://akira-api.miclusty.workers.dev/api/img?url=${encodeURIComponent(article.image_url)}&w=600&q=70&fmt=webp&fit=cover 600w,
              https://akira-api.miclusty.workers.dev/api/img?url=${encodeURIComponent(article.image_url)}&w=1200&q=75&fmt=webp&fit=cover 1200w,
              https://akira-api.miclusty.workers.dev/api/img?url=${encodeURIComponent(article.image_url)}&w=1800&q=78&fmt=webp&fit=cover 1800w
            `}
            sizes="(max-width: 768px) 100vw, 920px"
            alt={title}
            width="1200"
            height="630"
            loading="eager"
            fetchpriority="high"
            decoding="async"
            class="w-full h-auto rounded-xl"
          />
        </figure>
      )}

      <p class="mt-6 text-[19px] sm:text-lg leading-[1.7]" style={{ color: 'var(--text-primary)' }}>
        {article.summary}
      </p>

      {/* Pillar 2: TOC — only if 2+ headings */}
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

      {bodyWithIds && (
        <div class="article-prose mt-6 text-[17px] sm:text-base leading-[1.7]" set:html={bodyWithIds} />
      )}

      {/* Pillar 3: inline vote + search-redirect */}
      <div class="mt-8 pt-6 border-t flex items-center justify-between flex-wrap gap-4" style={{ borderColor: 'var(--border-base)' }}>
        <div class="flex items-center gap-2">
          <span class="text-sm" style={{ color: 'var(--text-tertiary)' }}>¿Te resultó útil?</span>
          <button
            class="px-3 py-1.5 rounded-full text-sm font-medium hover:bg-bg-hover transition-colors"
            data-vote="1"
            data-news-id={article.id}
            aria-label="Voto positivo"
          >👍 <span data-vote-count="up">{article.upvotes ?? 0}</span></button>
          <button
            class="px-3 py-1.5 rounded-full text-sm font-medium hover:bg-bg-hover transition-colors"
            data-vote="-1"
            data-news-id={article.id}
            aria-label="Voto negativo"
          >👎 <span data-vote-count="down">{article.downvotes ?? 0}</span></button>
        </div>
        <a
          href={`/buscar?q=${encodeURIComponent(article.title)}`}
          class="px-3 py-1.5 rounded-full text-sm hover:bg-bg-hover transition-colors"
          style={{ color: 'var(--text-secondary)' }}
        >🔍 Cobertura completa</a>
      </div>

      {/* Pillar 3: source line at end */}
      <footer class="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border-base)' }}>
        <p class="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Fuente original:{' '}
          {article.source_url ? (
            <a href={article.source_url} target="_blank" rel="noopener noreferrer" class="font-semibold hover:underline" style={{ color: 'var(--accent)' }}>{article.source_name}</a>
          ) : (
            <span class="font-semibold" style={{ color: 'var(--text-secondary)' }}>{article.source_name}</span>
          )}
        </p>
        <p class="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
          Sintetizado por AKIRA · {article.sources_count ?? 1} {(article.sources_count ?? 1) === 1 ? 'fuente' : 'fuentes'}
        </p>
      </footer>
    </article>
  </main>

  {/* Pillar 3: floating action bar (mobile only) */}
  <nav class="article-fab sm:hidden" aria-label="Acciones rápidas">
    <button type="button" data-action="share" aria-label="Compartir">📤</button>
    <button type="button" data-action="bookmark" aria-label="Guardar">🔖</button>
    <button type="button" data-action="read-mode" aria-label="Modo lectura">📖</button>
    <button type="button" data-action="back-to-top" aria-label="Volver arriba" hidden>🔝</button>
  </nav>

  {/* Pillar 3 + 4: inline scripts. No external deps. No CSP yet
      (Antena has none); when one is added, script-src 'unsafe-inline'
      is needed for this block. */}
  <script is:inline>
    (function() {
      // Pillar 4: restore persisted font-scale
      try {
        var savedScale = localStorage.getItem('antena-article-font-scale');
        if (savedScale) document.documentElement.style.setProperty('--article-font-scale', savedScale);
        var savedMode = localStorage.getItem('antena-article-reading-mode');
        if (savedMode === '1') document.documentElement.classList.add('reading-mode');
      } catch (e) {}

      // Pillar 3: vote buttons
      document.querySelectorAll('[data-vote]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var id = btn.getAttribute('data-news-id');
          var value = btn.getAttribute('data-vote');
          if (!id || !value) return;
          fetch('/api/news/' + encodeURIComponent(id) + '/vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vote: Number(value) }),
            keepalive: true,
          }).then(function(res) {
            if (!res.ok) throw new Error('vote failed');
            return res.json();
          }).then(function(data) {
            var upSpan = btn.parentElement?.querySelector('[data-vote-count="up"]');
            var downSpan = btn.parentElement?.querySelector('[data-vote-count="down"]');
            if (upSpan && data && typeof data.upvotes === 'number') upSpan.textContent = String(data.upvotes);
            if (downSpan && data && typeof data.downvotes === 'number') downSpan.textContent = String(data.downvotes);
          }).catch(function() {
            // silent fail — no toast wired here; the FAB area doesn't have
            // a toast mount. Vote buttons gracefully do nothing on error.
          });
        });
      });

      // Pillar 3: FAB
      var fabBackToTop = document.querySelector('[data-action="back-to-top"]');
      function onScroll() {
        if (!fabBackToTop) return;
        var halfway = document.documentElement.scrollHeight * 0.5;
        fabBackToTop.hidden = window.scrollY < halfway;
      }
      window.addEventListener('scroll', onScroll, { passive: true });

      document.querySelectorAll('.article-fab [data-action]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var action = btn.getAttribute('data-action');
          if (action === 'share') {
            var url = window.location.href;
            var shareTitle = document.title;
            if (navigator.share) {
              navigator.share({ title: shareTitle, url: url }).catch(function() {});
            } else if (navigator.clipboard) {
              navigator.clipboard.writeText(url).then(function() {
                btn.textContent = '✅';
                setTimeout(function() { btn.textContent = '📤'; }, 1500);
              }).catch(function() {});
            }
          } else if (action === 'bookmark') {
            // Use the existing antena-db IndexedDB store (same schema
            // as the SPA). Best-effort write; silently ignore errors.
            try {
              var req = indexedDB.open('antena-db', 1);
              req.onsuccess = function() {
                var db = req.result;
                if (!db.objectStoreNames.contains('bookmarks')) return;
                var tx = db.transaction('bookmarks', 'readwrite');
                tx.objectStore('bookmarks').put({
                  newsId: window.location.pathname,
                  title: document.title,
                  savedAt: Date.now(),
                });
                btn.textContent = '✅';
                setTimeout(function() { btn.textContent = '🔖'; }, 1500);
              };
              req.onerror = function() {};
            } catch (e) {}
          } else if (action === 'read-mode') {
            // Pillar 4: cycle 1 → 1.125 → 1.25 → 1
            var sizes = [1, 1.125, 1.25];
            var current = parseFloat(document.documentElement.style.getPropertyValue('--article-font-scale')) || 1;
            var idx = sizes.indexOf(current);
            var next = sizes[(idx + 1) % sizes.length];
            document.documentElement.style.setProperty('--article-font-scale', String(next));
            try { localStorage.setItem('antena-article-font-scale', String(next)); } catch (e) {}
            // Toggle reading-mode class on the 1.25 step so the user
            // gets a paper-like theme at the largest size.
            if (next === 1.25) {
              document.documentElement.classList.add('reading-mode');
              try { localStorage.setItem('antena-article-reading-mode', '1'); } catch (e) {}
            } else {
              document.documentElement.classList.remove('reading-mode');
              try { localStorage.setItem('antena-article-reading-mode', '0'); } catch (e) {}
            }
          } else if (action === 'back-to-top') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        });
      });
    })();
  </script>
```

- [ ] **Step 4: Import `article-prose.css` in the `<head>`**

The new CSS lives in `packages/antena/src/styles/article-prose.css`. Astro's recommended way to import a CSS file in a page is at the top of the frontmatter:

```astro
---
import '../../../../styles/article-prose.css';
---
```

Add it next to the other imports (after the article-toc import from step 1). The path is `../../../../styles/article-prose.css` because the page is at `pages/[year]/[month]/[day]/` (4 levels deep).

- [ ] **Step 5: Build and smoke-test**

Run:
```bash
cd packages/antena && pnpm exec astro build 2>&1 | tail -5
```

Expected: build succeeds with 2336 pages (or close — articles without slugs get filtered). Inspect one article:

```bash
curl -sS "http://localhost:4321/2026/06/19/primera-vez-historia-madre-hijo-jugaron-mundial/" 2>/dev/null | \
  grep -oE 'class="article-prose"|class="article-fab|class="article-progress|📑 Contenido|⏱ [0-9]+ min de lectura|⚖ |📰 [0-9]+ fuentes'
```

Expected: at least 4 of these 6 patterns match (TOC only appears if 2+ headings; bias chip only if data exists).

- [ ] **Step 6: Run unit tests + typecheck**

```bash
pnpm --filter antena test -- article-toc
pnpm --filter antena typecheck
```

Expected: 12 article-toc tests pass; typecheck shows 5 pre-existing errors (EmptyState.tsx, __cron/indexnow.ts, slug.md.ts, MapView.test.tsx, read-later.test.ts) — same as before, no new errors.

- [ ] **Step 7: Commit**

```bash
git add packages/antena/src/pages/\[year\]/\[month\]/\[day\]/\[slug\].astro
git commit -m "feat(article): mobile reading polish — typography, reading aids, FAB, reading mode"
```

---

## Task 4: Save-data mode (Pillar 4 a11y)

**Files:**
- Modify: `packages/antena/src/pages/[year]/[month]/[day]/[slug].astro` (extend the inline `<script>` from Task 3)

This is a small follow-up that the user may not see on every device. It detects `navigator.connection.saveData` or `prefers-reduced-data: reduce` and replaces inline `<img>` elements with a placeholder.

- [ ] **Step 1: Extend the inline script**

In the same `<script is:inline>` block from Task 3, add at the top of the IIFE (right after the localStorage reads):

```javascript
      // Pillar 4: save-data mode. Replace inline body images with a
      // placeholder so users on metered connections don't burn data.
      var saveData = false;
      try {
        var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn && conn.saveData) saveData = true;
      } catch (e) {}
      try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-data: reduce)').matches) saveData = true;
      } catch (e) {}
      if (saveData) {
        document.querySelectorAll('.article-prose img').forEach(function(img) {
          var ph = document.createElement('details');
          ph.className = 'my-4 text-center';
          ph.innerHTML = '<summary class="cursor-pointer text-sm" style="color:var(--text-tertiary)">📷 Imagen (tap para cargar)</summary>';
          // Re-attach the img inside the details so the user can opt in.
          ph.appendChild(img.cloneNode(true));
          img.replaceWith(ph);
        });
      }
```

- [ ] **Step 2: Build and verify**

```bash
cd packages/antena && pnpm exec astro build 2>&1 | tail -5
```

Expected: build succeeds. (We can't easily test save-data mode headlessly — it requires Chrome devtools override. Code review is sufficient.)

- [ ] **Step 3: Commit**

```bash
git add packages/antena/src/pages/\[year\]/\[month\]/\[day\]/\[slug\].astro
git commit -m "feat(article): save-data mode hides inline body images"
```

---

## Task 5: Lighthouse smoke check

**Files:** none (verification only)

- [ ] **Step 1: Start dev server**

```bash
cd packages/antena && pnpm exec astro preview --port 4321 &
```

- [ ] **Step 2: Run Lighthouse mobile against one article**

```bash
pnpm exec lhci autorun --collect.url="http://localhost:4321/2026/06/19/primera-vez-historia-madre-hijo-jugaron-mundial/" --collect.settings.preset=mobile --collect.settings.throttling.cpuSlowdownMultiplier=4 || true
```

Expected: Performance ≥ 95, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95. If accessibility dips, the most likely culprit is missing `aria-label` on the FAB icons (we added them — confirm they render) or the inline `<img>` in the body missing alt text (we can't fix upstream; document the limitation).

- [ ] **Step 3: Stop preview server**

```bash
pkill -f "astro preview" || true
```

---

## Self-Review (run before handing off)

- [ ] **Spec coverage check**: walk through each pillar in the spec, verify there's a task that implements every requirement.

  | Spec section | Task |
  |---|---|
  | Pillar 1 typography (max-w-[68ch], text-[17px], line-height 1.7, safe-area-inset, h1 size) | Task 3 step 3 |
  | Pillar 1 prose styles (h2/h3, blockquote, code, pre, ul/ol, a, img, figure) | Task 2 step 1 |
  | Pillar 2 reading time | Task 3 step 3 (meta line) |
  | Pillar 2 TOC with collapse | Task 3 step 3 (details element) |
  | Pillar 2 progress bar | Task 2 step 1 + Task 3 step 3 (article-progress) |
  | Pillar 2 heading IDs | Task 1 (addHeadingIds) + Task 3 step 2 (bodyWithIds) |
  | Pillar 3 cluster badge | Task 3 step 3 (meta line) |
  | Pillar 3 bias chip | Task 3 step 3 (meta line) |
  | Pillar 3 vote buttons | Task 3 step 3 (vote bar) + inline script |
  | Pillar 3 FAB (share/bookmark/read-mode/back-to-top) | Task 3 step 3 (article-fab + script) |
  | Pillar 3 source line at end | Task 3 step 3 (footer) |
  | Pillar 4 reading mode CSS | Task 2 step 1 (html.reading-mode) |
  | Pillar 4 font-size cycling | Task 3 step 3 (read-mode handler) |
  | Pillar 4 prefers-reduced-motion | Task 2 step 1 (@media block) |
  | Pillar 4 save-data mode | Task 4 |
  | Acceptance criteria 1-14 | Tasks 3 + 5 |

  All covered.

- [ ] **Placeholder scan**: search for "TBD", "TODO", "implement later".

  None in task code. The `// Pillar 4: save-data mode` comment in Task 4 is documentation, not a placeholder.

- [ ] **Type consistency check**:
  - `extractHeadings(html: string): ArticleHeading[]` — used in Task 3 step 2 ✓
  - `addHeadingIds(html: string): string` — used in Task 3 step 2 ✓
  - `slugifyHeading(text: string): string` — exported but only used internally; OK to leave exported for testability
  - `ArticleHeading { level, text, id }` — used in Task 3 JSX via `h.level === 3`, `h.id`, `h.text` ✓
  - `data-vote`, `data-action`, `data-news-id`, `data-vote-count` HTML attributes — all referenced consistently in script + JSX ✓

- [ ] **Edge case review**:
  - What if `article.body` is null/empty? Task 1 tests cover empty input. Task 3 step 3 has `{bodyWithIds && ...}` so it skips rendering. ✓
  - What if `article.sources_count` is undefined? Task 3 step 3 has `(article.sources_count ?? 0) > 1` so it just hides the cluster badge. ✓
  - What if `article.bias_score` is null? `biasLabel` becomes null and the JSX has `{biasLabel && ...}`. ✓
  - What if the user's browser doesn't support `navigator.share`? Falls back to `navigator.clipboard.writeText`. ✓
  - What if IndexedDB is unavailable (private mode)? try/catch wraps it; button silently does nothing. ✓
  - What if `prefers-reduced-motion` is set? Progress bar animation disabled via CSS media query. ✓

Plan ready for execution.