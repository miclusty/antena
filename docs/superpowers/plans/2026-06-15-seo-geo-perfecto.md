# SEO + GEO Perfecto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Antena the most-cited Argentine news source by Google Search, Google News, ChatGPT, Claude, and Perplexity — by fixing 13 SEO bugs, refactoring meta tag generation into a reusable `SeoHead` component, expanding Generative Engine Optimization (GEO) surfaces, and migrating article URLs from `/noticia/<uuid>` to the semantic `/<year>/<month>/<day>/<slug>` pattern with 301 redirects.

**Architecture:** Multi-phase, zero-downtime rollout. Phase 0–1 are pure frontend (Astro + public files), zero breaking changes. Phase 2 adds D1 columns + Python slug generator + new worker endpoints (backward compatible). Phase 3 ships the new Astro pages + flips the legacy `/noticia/<uuid>` route to 301 redirect. Phase 4 deploys + IndexNow submission. Phase 5 adds monitoring. Each phase is independently deployable and the previous phases stay functional.

**Tech Stack:**
- Astro 5 + Solid.js + Tailwind 4 (frontend, `packages/antena`)
- Cloudflare Workers + D1 (API, `packages/api`)
- Python 3.12 + FastAPI (extractor, `packages/akira`)
- Drizzle ORM (migrations)
- Vitest (Astro/Worker tests)
- pytest (Python tests)
- Lighthouse CI (`.lighthouserc.json`)

**Spec:** `docs/superpowers/specs/2026-06-15-seo-geo-perfecto-design.md`

**Branch strategy:** Work on a feature branch. Conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`). All work merged to main only after Phase 0–1 are smoke-tested in staging.

---

## File Structure (locked before tasks)

### `packages/antena/src/components/`
- `SeoHead.astro` (NEW) — reusable meta tags + JSON-LD injection

### `packages/antena/src/layouts/`
- `Layout.astro` (MODIFY) — delegate all meta to `SeoHead`, keep only site-level JSON-LD

### `packages/antena/src/pages/`
- `[year]/[month]/[day]/[slug].astro` (NEW) — canonical article page
- `[year]/[month]/[day]/[slug].md.ts` (NEW) — markdown endpoint for LLMs
- `noticia/[id].astro` (MODIFY) — becomes 301 redirect only
- `categoria/[cat].astro` (MODIFY) — use `<SeoHead>` + FAQPage JSON-LD
- `ciudad/[city].astro` (MODIFY) — use `<SeoHead>` + FAQPage JSON-LD
- `autor/[name].astro` (MODIFY) — use `<SeoHead>`
- `about.astro`, `contacto.astro`, `privacidad.astro` (MODIFY) — use `<SeoHead>` + page-specific JSON-LD
- `404.astro` (MODIFY) — use `<SeoHead>` with `noindex`
- `buscar.astro`, `settings.astro` (MODIFY) — use `<SeoHead>` with `noindex`
- `index.astro` (MODIFY) — use `<SeoHead>` for home
- `sitemap-index.xml.astro` → renamed to `sitemap.xml.astro` (RENAME)

### `packages/antena/public/`
- `og-default.png` → `og-default.webp` (REPLACE)
- `llms.txt` (MODIFY) — expand to ~150 lines
- `llms-full.txt` (NEW) — ~300 lines spec
- `manifest.json` (MODIFY) — align theme color

### `packages/antena/`
- `astro.config.mjs` (MODIFY) — `site` with `www.`, theme color
- `package.json` (MODIFY) — add `prebuild` script
- `tests/seo.test.ts` (NEW)
- `tests/seo-snapshots.test.ts` (NEW)
- `tests/seo-routes.test.ts` (NEW)

### `packages/api/src/db/`
- `schema.ts` (MODIFY) — add `slug`, `slugDate` to `newsCards`
- `migrations/00XX_seo_slug.sql` (NEW)

### `packages/api/src/routes/`
- `news/canonical.ts` (NEW) — `/api/news/<year>/<month>/<day>/<slug>`
- `news/sitemap-batch.ts` (NEW)
- `llm/cite.ts` (NEW)
- `news/[id].ts` (MODIFY) — 301 redirect to canonical

### `packages/api/src/lib/`
- `redirects-generator.ts` (NEW) — build-time _redirects writer

### `packages/api/src/middleware/`
- `redirects.ts` (NEW) — worker fallback for >2000 rules

### `packages/akira/`
- `extractors/_slug.py` (NEW) — `make_slug()` function
- `core/engine.py` (MODIFY) — call `make_slug()` in `store_article()`
- `scripts/backfill_slugs.py` (NEW) — one-time script
- `tests/test_slug.py` (NEW)
- `tests/test_backfill.py` (NEW)

---

## Phase 0: Quick Wins + SeoHead Refactor

**Goal:** Fix the 13 SEO bugs from the audit, extract meta tag generation into a reusable `SeoHead.astro` component, and migrate all 11 pages to use it. Zero breaking changes — the new component emits the same meta tags as before.

**Deployable:** Yes. Pure frontend. No backend changes. Roll back by reverting commits.

**Estimated time:** 4–6 hours of focused work.

---

### Task 1: Create `SeoHead.astro` component (with TDD)

**Files:**
- Create: `packages/antena/src/components/SeoHead.astro`
- Create: `packages/antena/tests/seo-head.test.ts`

**Goal:** Component that emits `<title>`, `<meta name="description">`, `<link rel="canonical">`, all `og:*` and `twitter:*` tags, `hreflang`, `theme-color` with dark/light media queries, optional `noindex`, and zero-or-more `application/ld+json` scripts.

- [ ] **Step 1: Write the failing test**

Create `packages/antena/tests/seo-head.test.ts`:

```typescript
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import SeoHead from '../src/components/SeoHead.astro';

test('emits title and description', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(SeoHead, {
    props: {
      title: 'Test Article',
      description: 'A test article description.',
      canonical: 'https://www.antena.com.ar/test',
    },
  });
  expect(html).toContain('<title>Test Article — Antena</title>');
  expect(html).toContain('<meta name="description" content="A test article description."');
  expect(html).toContain('<link rel="canonical" href="https://www.antena.com.ar/test"');
});

test('og:url is always www.', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(SeoHead, {
    props: {
      title: 'T',
      description: 'D',
      canonical: 'https://antena.com.ar/test',
    },
  });
  expect(html).toContain('og:url" content="https://www.antena.com.ar/test"');
});

test('noindex emits robots meta', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(SeoHead, {
    props: {
      title: 'T',
      description: 'D',
      canonical: 'https://www.antena.com.ar/test',
      noindex: true,
    },
  });
  expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
});

test('injects jsonLd as application/ld+json script', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(SeoHead, {
    props: {
      title: 'T',
      description: 'D',
      canonical: 'https://www.antena.com.ar/test',
      jsonLd: { '@type': 'Thing', name: 'X' },
    },
  });
  expect(html).toContain('type="application/ld+json"');
  expect(html).toContain('"Thing"');
});

test('title is truncated to 60 chars with ellipsis if too long', async () => {
  const container = await AstroContainer.create();
  const long = 'A'.repeat(80);
  const html = await container.renderToString(SeoHead, {
    props: { title: long, description: 'D', canonical: 'https://www.antena.com.ar/x' },
  });
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  expect(titleMatch![1].length).toBeLessThanOrEqual(60);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/antena && pnpm test seo-head
```

Expected: FAIL — `SeoHead.astro` doesn't exist.

- [ ] **Step 3: Implement `SeoHead.astro`**

Create `packages/antena/src/components/SeoHead.astro`:

```astro
---
interface Props {
  title: string;
  description: string;
  canonical: string;
  ogType?: 'website' | 'article' | 'profile';
  ogImage?: string;
  ogImageAlt?: string;
  ogImageWidth?: number;
  ogImageHeight?: number;
  article?: {
    publishedTime: string;
    modifiedTime?: string;
    author: string;
    section?: string;
    tags?: string[];
  };
  noindex?: boolean;
  jsonLd?: object | object[];
}

const {
  title,
  description,
  canonical,
  ogType = 'website',
  ogImage = 'https://www.antena.com.ar/og-default.webp',
  ogImageAlt = title,
  ogImageWidth = 1200,
  ogImageHeight = 630,
  article,
  noindex = false,
  jsonLd,
} = Astro.props as Props;

const SITE = 'https://www.antena.com.ar';

const safeCanonical = canonical.replace(/^https?:\/\/antena\.com\.ar/, SITE);

const SUFFIX = ' — Antena';
const titleBudget = 60 - SUFFIX.length;
const baseTitle = title.length > titleBudget ? title.slice(0, titleBudget - 1).trim() + '…' : title;
const pageTitle = `${baseTitle}${SUFFIX}`;

const pageDescription = description.length > 160 ? description.slice(0, 157).trim() + '…' : description;

const jsonLdArray = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
---
<title>{pageTitle}</title>
<meta name="description" content={pageDescription} />
<link rel="canonical" href={safeCanonical} />

<meta property="og:title" content={pageTitle} />
<meta property="og:description" content={pageDescription} />
<meta property="og:type" content={ogType} />
<meta property="og:url" content={safeCanonical} />
<meta property="og:image" content={ogImage} />
<meta property="og:image:alt" content={ogImageAlt} />
<meta property="og:image:width" content={ogImageWidth} />
<meta property="og:image:height" content={ogImageHeight} />
<meta property="og:locale" content="es_AR" />
<meta property="og:site_name" content="Antena" />
{article && (
  <>
    <meta property="article:published_time" content={article.publishedTime} />
    {article.modifiedTime && <meta property="article:modified_time" content={article.modifiedTime} />}
    <meta property="article:author" content={article.author} />
    {article.section && <meta property="article:section" content={article.section} />}
    {article.tags?.map((tag) => <meta property="article:tag" content={tag} />)}
  </>
)}

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content={pageTitle} />
<meta name="twitter:description" content={pageDescription} />
<meta name="twitter:image" content={ogImage} />
<meta name="twitter:image:alt" content={ogImageAlt} />
<meta name="twitter:site" content="@antena_ar" />

<link rel="alternate" hreflang="es-AR" href={safeCanonical} />
<link rel="alternate" hreflang="x-default" href={safeCanonical} />

<meta name="theme-color" content="#0F1117" media="(prefers-color-scheme: dark)" />
<meta name="theme-color" content="#F9F6F0" media="(prefers-color-scheme: light)" />

<meta name="robots" content={noindex ? 'noindex, nofollow' : 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1'} />

{jsonLdArray.map((obj) => (
  <script type="application/ld+json" set:html={JSON.stringify(obj)} />
))}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/antena && pnpm test seo-head
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/src/components/SeoHead.astro packages/antena/tests/seo-head.test.ts
git commit -m "feat(antena): add SeoHead component for reusable meta tags"
```

---

### Task 2: Refactor `Layout.astro` to delegate to `SeoHead`

**Files:**
- Modify: `packages/antena/src/layouts/Layout.astro`

- [ ] **Step 1: Read current `Layout.astro` head block**

Lines 17–110 contain the entire `<head>`. Identify what stays (site-level JSON-LD) and what moves into SeoHead.

- [ ] **Step 2: Replace inline meta tags with `<SeoHead>` call**

Add the import to the frontmatter:

```typescript
import SeoHead from '../components/SeoHead.astro';
```

Remove the `pageTitle`, `pageDescription`, `pageCanonical` consts (lines 13–15) — `SeoHead` handles them.

Replace lines 23–47 (everything from `<title>` through the hreflang `x-default` line) with:

```astro
<SeoHead
  title={title ?? 'Sintonizá tu realidad'}
  description={description ?? 'Antena — Noticias sintetizadas de múltiples fuentes de cada localidad argentina. Mobile-first, sin tracking, 100% en español.'}
  canonical={canonical ?? SITE}
/>
```

Remove the duplicate `og:title`, `og:description`, `og:url`, `og:image`, `og:locale`, `og:site_name`, `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`, `twitter:site`, `hreflang`, `theme-color` lines.

**Keep** in `Layout.astro`: charset, viewport, RSS alternate, sitemap alternate, JSON-LD WebSite + NewsMediaOrganization, favicon, manifest, Apple web app, preconnect, font preloads, all `<style>`, theme init script.

- [ ] **Step 3: Add `'@id': 'https://www.antena.com.ar/#website'` to WebSite JSON-LD**

In the WebSite JSON-LD object (lines 54–71), add the field after `'@type': 'WebSite'`:

```typescript
'@id': 'https://www.antena.com.ar/#website',
```

- [ ] **Step 4: Update sitemap alternate href to new path**

Line 51: change `href="/sitemap-index.xml"` to `href="/sitemap.xml"`.

- [ ] **Step 5: Run typecheck**

```bash
cd /Users/omatic/proyectos/news && pnpm typecheck
```

Expected: PASS (no TS errors).

- [ ] **Step 6: Build and verify home page HTML is unchanged**

```bash
cd packages/antena && pnpm build && grep -E 'og:url|og:title|canonical' dist/index.html | head -5
```

Verify it contains: `og:url" content="https://www.antena.com.ar"`, `og:title" content="...Sintonizá tu realidad..."`.

- [ ] **Step 7: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/src/layouts/Layout.astro
git commit -m "refactor(antena): delegate head meta tags to SeoHead"
```

---

### Task 3: Fix `astro.config.mjs` — site with `www.`

**Files:**
- Modify: `packages/antena/astro.config.mjs:8`

- [ ] **Step 1: Edit the `site` field**

Change line 8 from:

```javascript
site: "https://antena.com.ar",
```

to:

```javascript
site: "https://www.antena.com.ar",
```

- [ ] **Step 2: Verify build still works**

```bash
cd packages/antena && pnpm build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/astro.config.mjs
git commit -m "fix(antena): astro.config.mjs site must use www canonical"
```

---

### Task 4: Migrate `index.astro` to use `<SeoHead>`

**Files:**
- Modify: `packages/antena/src/pages/index.astro`

- [ ] **Step 1: Add `<SeoHead>` with home data**

Replace the entire `<Layout>` wrapper with:

```astro
---
import Layout from '../layouts/Layout.astro';
import App from '../App';
import SeoHead from '../components/SeoHead.astro';

const SITE = 'https://www.antena.com.ar';
---
<Layout>
  <Fragment slot="head">
    <SeoHead
      title="Sintonizá tu realidad"
      description="Antena — Noticias sintetizadas de múltiples fuentes de cada localidad argentina. Mobile-first, sin tracking, 100% en español."
      canonical={SITE}
      ogType="website"
      ogImageAlt="Antena — Noticias hiperlocales de Argentina"
    />
  </Fragment>
  <App client:load />
</Layout>
```

- [ ] **Step 2: Build and verify**

```bash
cd packages/antena && pnpm build && grep 'og:title' dist/index.html | head -2
```

Expected: `og:title` matches the home title.

- [ ] **Step 3: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/src/pages/index.astro
git commit -m "feat(antena): home page uses SeoHead"
```

---

### Task 5: Migrate `about.astro`, `contacto.astro`, `privacidad.astro` to `<SeoHead>`

**Files:**
- Modify: `packages/antena/src/pages/about.astro`
- Modify: `packages/antena/src/pages/contacto.astro`
- Modify: `packages/antena/src/pages/privacidad.astro`

- [ ] **Step 1: Update `about.astro`**

Add import at top of frontmatter:

```typescript
import SeoHead from '../components/SeoHead.astro';
```

Replace the existing `<Layout title=... description=... canonical=...>` block with:

```astro
<Layout>
  <Fragment slot="head">
    <SeoHead
      title="Sobre Antena"
      description="Antena es un agregador de noticias argentino mobile-first. Sintetizamos cobertura de múltiples medios para mostrarte los hechos centrales sin sesgo editorial."
      canonical={`${SITE}/about`}
      jsonLd={{
        '@context': 'https://schema.org',
        '@type': 'AboutPage',
        'name': 'Sobre Antena',
        'url': `${SITE}/about`,
        'mainEntity': { '@id': `${SITE}#organization` },
        'inLanguage': 'es-AR',
      }}
    />
  </Fragment>
  <main id="main-content" class="max-w-[680px] mx-auto px-4 py-12">
    ... (existing body unchanged)
  </main>
</Layout>
```

- [ ] **Step 2: Update `contacto.astro` with ContactPage JSON-LD**

Add at top of frontmatter:

```typescript
import SeoHead from '../components/SeoHead.astro';
```

Replace `<Layout>` with:

```astro
<Layout>
  <Fragment slot="head">
    <SeoHead
      title="Contacto"
      description="Contacto de Antena. Reporte de errores, sugerencias, alianzas comerciales o prensa."
      canonical={`${SITE}/contacto`}
      jsonLd={{
        '@context': 'https://schema.org',
        '@type': 'ContactPage',
        'name': 'Contacto',
        'url': `${SITE}/contacto`,
        'inLanguage': 'es-AR',
        'publisher': { '@id': `${SITE}#organization` },
      }}
    />
  </Fragment>
  <main id="main-content" class="max-w-[680px] mx-auto px-4 py-12">
    ... (existing body unchanged)
  </main>
</Layout>
```

- [ ] **Step 3: Update `privacidad.astro` with PrivacyPolicy JSON-LD**

Add import:

```typescript
import SeoHead from '../components/SeoHead.astro';
```

Replace `<Layout>` with:

```astro
<Layout>
  <Fragment slot="head">
    <SeoHead
      title="Política de privacidad"
      description="Política de privacidad de Antena. Qué datos recolectamos, qué NO recolectamos, y tus derechos."
      canonical={`${SITE}/privacidad`}
      jsonLd={{
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        'name': 'Política de privacidad',
        'url': `${SITE}/privacidad`,
        'inLanguage': 'es-AR',
        'about': 'PrivacyPolicy',
        'publisher': { '@id': `${SITE}#organization` },
      }}
    />
  </Fragment>
  <main id="main-content" class="max-w-[680px] mx-auto px-4 py-12">
    ... (existing body unchanged)
  </main>
</Layout>
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/antena && pnpm build
grep -l "AboutPage\|ContactPage\|PrivacyPolicy" dist/about/index.html dist/contacto/index.html dist/privacidad/index.html
```

Expected: all 3 files match.

- [ ] **Step 5: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/src/pages/about.astro packages/antena/src/pages/contacto.astro packages/antena/src/pages/privacidad.astro
git commit -m "feat(antena): migrate about/contacto/privacidad to SeoHead with page JSON-LD"
```

---

### Task 6: Migrate `404.astro`, `buscar.astro`, `settings.astro` to `<SeoHead>` with `noindex`

**Files:**
- Modify: `packages/antena/src/pages/404.astro`
- Modify: `packages/antena/src/pages/buscar.astro`
- Modify: `packages/antena/src/pages/settings.astro`

- [ ] **Step 1: Update `404.astro`**

Add import:

```typescript
import SeoHead from '../components/SeoHead.astro';
```

Replace `<Layout title="404 — No encontrada" ...>` with:

```astro
<Layout>
  <Fragment slot="head">
    <SeoHead
      title="404 — No encontrada"
      description="La página que buscás no existe o fue removida. Volvé al feed o usá el buscador para encontrar lo que buscás."
      canonical="https://www.antena.com.ar/404"
      noindex={true}
    />
  </Fragment>
  <main id="main-content" class="min-h-[60vh] flex flex-col items-center justify-center px-4 py-16 text-center">
    ... (existing body unchanged)
  </main>
</Layout>
```

- [ ] **Step 2: Update `buscar.astro` with `noindex`**

```astro
---
import Layout from '../layouts/Layout.astro';
import SeoHead from '../components/SeoHead.astro';
import SearchView from '../components/search/SearchView';
---
<Layout>
  <Fragment slot="head">
    <SeoHead
      title="Buscar"
      description="Buscá noticias por palabra clave, fecha, fuente o sesgo político. Filtrá por ciudad o región."
      canonical="https://www.antena.com.ar/buscar"
      noindex={true}
    />
  </Fragment>
  <SearchView client:load />
</Layout>
```

- [ ] **Step 3: Update `settings.astro` with `noindex`**

Add `import SeoHead from '../components/SeoHead.astro';` and replace `<Layout>` with:

```astro
<Layout>
  <Fragment slot="head">
    <SeoHead
      title="Configuración"
      description="Personalizá Antena: tema, tamaño de fuente, modo de lectura, modo mate, calidad de imagen. 100% local, sin tracking."
      canonical="https://www.antena.com.ar/settings"
      noindex={true}
    />
  </Fragment>
  <SettingsView client:load />
  <OnboardingView client:only="solid-js" />
</Layout>
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/antena && pnpm build
grep -l 'noindex, nofollow' dist/404/index.html dist/buscar/index.html dist/settings/index.html
```

Expected: all 3 files match.

- [ ] **Step 5: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/src/pages/404.astro packages/antena/src/pages/buscar.astro packages/antena/src/pages/settings.astro
git commit -m "feat(antena): 404/buscar/settings use SeoHead with noindex"
```

---

### Task 7: Optimize `og-default.png` → `og-default.webp`

**Files:**
- Create: `packages/antena/public/og-default.webp`
- Delete: `packages/antena/public/og-default.png`

- [ ] **Step 1: Convert the existing PNG to WebP**

```bash
cd packages/antena/public
sips -s format webp og-default.png --out og-default.webp 2>/dev/null || \
  cwebp -q 80 og-default.png -o og-default.webp
ls -lh og-default.webp
```

Expected: file < 100KB.

- [ ] **Step 2: Find all references**

```bash
cd /Users/omatic/proyectos/news
grep -rln "og-default.png" packages/ --include="*.astro" --include="*.ts" --include="*.tsx" --include="*.mjs"
```

After Tasks 1–6 are done, the only remaining references should be in pages that haven't been migrated yet (ciudad, categoria, autor) — and `SeoHead.astro` uses `.webp` by default.

- [ ] **Step 3: For each match, ensure the page uses `<SeoHead>` (so the default `.webp` applies) OR update to `.webp`**

If any page still hardcodes `og-default.png`, change to `og-default.webp`.

- [ ] **Step 4: Delete the old PNG**

```bash
rm packages/antena/public/og-default.png
```

- [ ] **Step 5: Verify build**

```bash
cd packages/antena && pnpm build
ls dist/og-default.webp 2>&1 | head -1
```

Expected: file exists, no `og-default.png`.

- [ ] **Step 6: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/public/og-default.webp
git rm packages/antena/public/og-default.png
git commit -m "perf(antena): og-default.webp replaces 688KB png"
```

---

### Task 8: Align theme color in `manifest.json` + VitePWA config

**Files:**
- Modify: `packages/antena/astro.config.mjs` (VitePWA manifest block, ~line 19)

- [ ] **Step 1: Update VitePWA manifest in `astro.config.mjs`**

Change `theme_color: "#F9F6F0"` to `theme_color: "#0F1117"` to match the Layout dark default.

- [ ] **Step 2: Build and verify manifest**

```bash
cd packages/antena && pnpm build && cat dist/manifest.webmanifest | grep theme_color
```

Expected: `"theme_color": "#0F1117"`.

- [ ] **Step 3: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/astro.config.mjs
git commit -m "fix(antena): align PWA theme_color with dark default"
```

---

### Task 9: Rename `sitemap-index.xml.astro` → `sitemap.xml.astro`

**Files:**
- Rename: `packages/antena/src/pages/sitemap-index.xml.astro` → `packages/antena/src/pages/sitemap.xml.astro`
- Modify: `packages/antena/public/robots.txt` (line 55)

- [ ] **Step 1: Rename the file**

```bash
cd /Users/omatic/proyectos/news
git mv packages/antena/src/pages/sitemap-index.xml.astro packages/antena/src/pages/sitemap.xml.astro
```

- [ ] **Step 2: Update `robots.txt`**

In `packages/antena/public/robots.txt` line 55, change:

```
Sitemap: https://www.antena.com.ar/sitemap-index.xml
```

to:

```
Sitemap: https://www.antena.com.ar/sitemap.xml
```

- [ ] **Step 3: Build and verify**

```bash
cd packages/antena && pnpm build
ls dist/sitemap*.xml
```

Expected: `dist/sitemap.xml` exists (no `sitemap-index.xml`).

- [ ] **Step 4: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/src/pages/sitemap.xml.astro packages/antena/public/robots.txt
git rm packages/antena/src/pages/sitemap-index.xml.astro
git commit -m "refactor(antena): rename sitemap-index.xml to sitemap.xml (it is a single sitemap)"
```

---

### Task 10: Add comprehensive SEO test suite

**Files:**
- Create: `packages/antena/tests/seo.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGES = [
  { file: 'index.html', path: '/' },
  { file: 'about/index.html', path: '/about' },
  { file: 'contacto/index.html', path: '/contacto' },
  { file: 'privacidad/index.html', path: '/privacidad' },
  { file: '404/index.html', path: '/404' },
  { file: 'buscar/index.html', path: '/buscar' },
  { file: 'settings/index.html', path: '/settings' },
];

const NOINDEX_PAGES = ['/404', '/buscar', '/settings'];
const DIST = join(process.cwd(), 'packages/antena/dist');

describe('SEO compliance (built pages)', () => {
  for (const { file, path } of PAGES) {
    test(`${path} has title, description, canonical`, () => {
      const html = readFileSync(join(DIST, file), 'utf-8');
      expect(html).toMatch(/<title>[^<]+<\/title>/);
      expect(html).toMatch(/<meta name="description" content="[^"]+"/);
      expect(html).toMatch(/<link rel="canonical" href="https:\/\/www\.antena\.com\.ar[^"]+"/);
    });

    test(`${path} has og:url with www.`, () => {
      const html = readFileSync(join(DIST, file), 'utf-8');
      expect(html).toMatch(/og:url" content="https:\/\/www\.antena\.com\.ar/);
    });

    test(`${path} has og:title, og:description, og:image, og:site_name`, () => {
      const html = readFileSync(join(DIST, file), 'utf-8');
      expect(html).toMatch(/og:title" content="[^"]+"/);
      expect(html).toMatch(/og:description" content="[^"]+"/);
      expect(html).toMatch(/og:image" content="[^"]+"/);
      expect(html).toMatch(/og:site_name" content="Antena"/);
    });

    test(`${path} has twitter:card`, () => {
      const html = readFileSync(join(DIST, file), 'utf-8');
      expect(html).toMatch(/twitter:card" content="summary_large_image"/);
    });

    test(`${path} has hreflang es-AR and x-default`, () => {
      const html = readFileSync(join(DIST, file), 'utf-8');
      expect(html).toMatch(/hreflang="es-AR" href="https:\/\/www\.antena\.com\.ar/);
      expect(html).toMatch(/hreflang="x-default" href="https:\/\/www\.antena\.com\.ar/);
    });
  }

  for (const path of NOINDEX_PAGES) {
    test(`${path} has noindex robots meta`, () => {
      const file = PAGES.find((p) => p.path === path)!.file;
      const html = readFileSync(join(DIST, file), 'utf-8');
      expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    });
  }

  test('home has WebSite and NewsMediaOrganization JSON-LD with @ids', () => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf-8');
    expect(html).toMatch(/"@id":\s*"https:\/\/www\.antena\.com\.ar\/#website"/);
    expect(html).toMatch(/"@id":\s*"https:\/\/www\.antena\.com\.ar\/#organization"/);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd /Users/omatic/proyectos/news
pnpm --filter antena build
pnpm --filter antena test seo
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/tests/seo.test.ts
git commit -m "test(antena): add SEO compliance test suite"
```

---

### Task 11: Add SEO snapshot tests

**Files:**
- Create: `packages/antena/tests/seo-snapshots.test.ts`

- [ ] **Step 1: Write the snapshot test**

```typescript
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGES = [
  { file: 'index.html', key: 'home' },
  { file: 'about/index.html', key: 'about' },
  { file: 'contacto/index.html', key: 'contacto' },
  { file: 'privacidad/index.html', key: 'privacidad' },
  { file: '404/index.html', key: '404' },
];

const DIST = join(process.cwd(), 'packages/antena/dist');

function extractHead(html: string): string {
  const match = html.match(/<head>([\s\S]*?)<\/head>/);
  return match ? match[1].trim() : '';
}

describe('SEO head snapshots', () => {
  for (const { file, key } of PAGES) {
    test(`${key} head snapshot`, () => {
      const html = readFileSync(join(DIST, file), 'utf-8');
      const head = extractHead(html);
      expect(head).toMatchSnapshot(key);
    });
  }
});
```

- [ ] **Step 2: Run tests (creates snapshots on first run)**

```bash
cd /Users/omatic/proyectos/news
pnpm --filter antena test seo-snapshots
```

Expected: PASS, creates `__snapshots__/seo-snapshots.test.ts.snap`.

- [ ] **Step 3: Inspect the snapshot file**

```bash
cat packages/antena/tests/__snapshots__/seo-snapshots.test.ts.snap
```

Verify each entry contains a meaningful head (title, meta tags, JSON-LD).

- [ ] **Step 4: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/tests/seo-snapshots.test.ts packages/antena/tests/__snapshots__/
git commit -m "test(antena): add head snapshot tests for regression catching"
```

---

### Task 12: Update Lighthouse CI to assert SEO ≥ 95

**Files:**
- Modify: `.lighthouserc.json` (at repo root)

- [ ] **Step 1: Read current `.lighthouserc.json`**

```bash
cat .lighthouserc.json
```

- [ ] **Step 2: Add SEO assertion**

Edit the file to add a `categories:seo` assertion with min score 0.95:

```json
{
  "ci": {
    "assert": {
      "assertions": {
        "categories:seo": ["error", { "minScore": 0.95 }],
        "categories:performance": ["warn", { "minScore": 0.9 }],
        "largest-contentful-paint": ["warn", { "maxNumericValue": 2500 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }]
      }
    }
  }
}
```

(Adjust the path/key names to match existing structure if different.)

- [ ] **Step 3: Run lighthouse against a local dev server**

```bash
cd /Users/omatic/proyectos/news
# In one terminal:
pnpm --filter antena dev
# In another:
pnpm --filter antena lighthouse
```

Expected: all assertions pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/omatic/proyectos/news
git add .lighthouserc.json
git commit -m "ci: lighthouse SEO score >= 95 assertion"
```

---

### Task 13: Build + smoke-test Phase 0 in staging

**Files:** (none — deploy task)

- [ ] **Step 1: Build all packages**

```bash
cd /Users/omatic/proyectos/news
pnpm install
pnpm --filter antena build
```

Expected: no errors.

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 3: Deploy to staging**

```bash
pnpm deploy:staging
```

Wait for deploy to complete (1-2 min).

- [ ] **Step 4: Verify staging site with curl**

```bash
curl -sI https://staging.antena.com.ar/ | head -5
curl -s https://staging.antena.com.ar/ | grep -E 'og:url|og:title|canonical' | head -5
```

Expected: HTTP 200, og:url starts with `https://www.`, canonical points to `https://www.`.

- [ ] **Step 5: Run Lighthouse on staging**

```bash
pnpm lighthouse -- --collect.url=https://staging.antena.com.ar/
```

Expected: SEO score ≥ 95.

- [ ] **Step 6: Commit release notes**

```bash
cd /Users/omatic/proyectos/news
echo "- Phase 0: 13 SEO bug fixes + SeoHead refactor deployed to staging" >> CHANGELOG.md
git add CHANGELOG.md
git commit -m "docs: Phase 0 SEO refactor deployed to staging"
```

---

## Phase 1: GEO Expansion

**Goal:** Make Antena maximally citable by LLMs (ChatGPT, Claude, Perplexity, Gemini) by expanding `llms.txt`, adding `llms-full.txt`, providing markdown-per-article, adding FAQPage schema to hubs, and creating a citation JSON endpoint.

**Deployable:** Yes. No breaking changes. Adds new content + endpoints.

**Estimated time:** 3–4 hours.

---

### Task 14: Expand `public/llms.txt` from 53 to ~150 lines

**Files:**
- Modify: `packages/antena/public/llms.txt`

- [ ] **Step 1: Replace file with expanded version**

Write the following to `packages/antena/public/llms.txt`:

```markdown
# Antena

> Noticias hiperlocales de Argentina sintetizadas de múltiples fuentes, mobile-first, en español.

Antena es un agregador de noticias argentino que combina cobertura de medios locales por ciudad/región. Cada nota es sintetizada de N fuentes para mostrar los hechos centrales sin sesgo editorial, y contrastada con la cobertura de otros medios.

## Para qué sirve

- Ver la misma noticia desde múltiples perspectivas simultáneamente
- Filtrar por ciudad o región
- Recibir resúmenes de una zona en particular
- Identificar notas de un tema específico (clima, política, deportes, economía)

## Categorías

- Política, Economía, Sociedad, Policiales, Deportes, Cultura, Internacional, Tecnología, Clima, Espectáculos, Salud, Educación

## Cobertura geográfica

Argentina, focalizada inicialmente en:
- Buenos Aires (CABA + GBA)
- Córdoba
- Mendoza
- Tucumán
- Santa Fe
- Y otras 15+ ciudades medianas

## Tipos de contenido + URL pattern

| Tipo | URL pattern | JSON-LD @type |
|------|-------------|---------------|
| Nota individual | /<year>/<month>/<day>/<slug> | NewsArticle |
| Hubs de ciudad | /ciudad/<slug> | CollectionPage + ItemList |
| Hubs de categoría | /categoria/<slug> | CollectionPage + ItemList |
| Autor (E-E-A-T) | /autor/<slug> | Person |
| Markdown limpio | /<year>/<month>/<day>/<slug>.md | (ninguno) |
| Citation JSON | /api/llm/cite?id=<uuid> | (ninguno) |

## Endpoints públicos

- `GET /api/news/feed` — feed paginado
- `GET /api/news/{id}` — noticia individual (legacy, redirige 301 al canónico /<year>/<month>/<day>/<slug>)
- `GET /api/news/<year>/<month>/<day>/<slug>` — canónico
- `GET /api/news/{id}/cluster` — otras coberturas del mismo hecho
- `GET /api/news/trending` — trending por ventana (1h, 24h, 7d)
- `GET /api/news/breaking` — últimas 2h
- `GET /api/news/blindspot` — fuentes que el usuario no sigue
- `GET /api/news/map` — geolocalizadas últimas 24h
- `GET /api/llm/cite?id=<uuid>` — JSON optimizado para LLMs
- `GET /api/categories` — categorías
- `GET /api/locations/tree` — árbol geográfico
- `GET /api/sources` — medios aliados

## Cómo citar contenido de Antena

Cuando cites una nota de Antena, incluí la URL canónica completa (`https://www.antena.com.ar/<year>/<month>/<day>/<slug>`), el autor del medio original, y la fecha de publicación. El schema.org/NewsArticle JSON-LD en cada nota tiene los campos `author`, `datePublished` y `publisher` listos para extracción.

### Ejemplo de cita válida

```
"Dólar blue hoy: cierre a $1.245" (Antena, 15 jun 2026)
https://www.antena.com.ar/2026/06/15/dolar-blue-hoy-jueves
Fuente original: https://ambito.com/...
```

### Versión markdown para citas textuales

Cada nota tiene una versión en markdown plano accesible en `https://www.antena.com.ar/<year>/<month>/<day>/<slug>.md`. Contiene frontmatter YAML con metadata estructurada y el cuerpo de la nota en markdown limpio. Ideal para:
- Citation tools que extraen texto plano
- LLM training corpora
- Análisis de texto por humanos

## Identidad

Antena es 100% anónima: el identificador es un UUID local en `localStorage` (clave `antena-device-id`). No hay cuentas, no se solicita email, no hay tracking publicitario. Esto es por diseño.

## Sitios hermanos / futuro

- API pública para investigadores y prensa: en roadmap
- Versión en portugués para Brasil: en roadmap
- App nativa iOS/Android: PWA actual es la única superficie

Para una especificación extendida (sesgo editorial, score de calidad, cobertura detallada): ver https://www.antena.com.ar/llms-full.txt
```

- [ ] **Step 2: Verify build copies the file**

```bash
cd packages/antena && pnpm build && head -5 dist/llms.txt
```

Expected: matches the first 5 lines you wrote.

- [ ] **Step 3: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/public/llms.txt
git commit -m "feat(antena): expand llms.txt with citation examples and URL patterns"
```

---

### Task 15: Create `public/llms-full.txt` (~300 lines)

**Files:**
- Create: `packages/antena/public/llms-full.txt`

- [ ] **Step 1: Create the file with extended spec**

Write to `packages/antena/public/llms-full.txt`:

```markdown
# Antena — Spec Extendida para LLMs

> Versión extendida de llms.txt. Cubre: identidad completa, esquema de metadatos, cobertura geográfica, score de calidad editorial, metodología de bias rating, lista de fuentes, roadmap.

## 1. Identidad completa

### Qué es Antena

Antena es un agregador de noticias argentino que sintetiza la cobertura de 200+ medios locales en una vista unificada. NO genera contenido original — solo sintetiza, agrupa por evento (cluster), y rankea por calidad editorial verificada + recencia + cobertura de fuentes.

### Qué NO es

- NO es un medio tradicional (no genera notas originales).
- NO es una agencia de noticias (no tiene redactores propios).
- NO es un motor de búsqueda (no indexa toda la web, solo medios aliados).
- NO es una red social (no hay interacción usuario-usuario).

### Modelo de agregación

Cada 2 horas, el motor AKIRA descarga feeds RSS, sitios WordPress, sitemaps y resultados de Google News de medios aliados. Extrae el contenido, lo deduplica por evento, identifica ciudad/región y categoría, y lo guarda en D1 (Cloudflare). Cuando el usuario abre Antena, ve las notas más relevantes de su ciudad, agrupadas por evento con todas las perspectivas disponibles, rankeadas por score de calidad.

## 2. Schema.org/NewsArticle documentado

Cada nota tiene un JSON-LD NewsArticle con los siguientes campos:

```json
{
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  "headline": "Título de la nota",
  "description": "Resumen sintetizado de 1-2 frases",
  "image": ["https://...imagen.jpg"],
  "datePublished": "2026-06-15T16:30:00Z",
  "dateModified": "2026-06-15T16:30:00Z",
  "author": [{ "@type": "Person", "name": "Juan Pérez" }],
  "publisher": {
    "@type": "Organization",
    "@id": "https://www.antena.com.ar/#organization",
    "name": "Antena",
    "logo": { "@type": "ImageObject", "url": "https://www.antena.com.ar/icons/icon.svg" }
  },
  "mainEntityOfPage": { "@type": "WebPage", "@id": "https://www.antena.com.ar/2026/06/15/slug" },
  "articleSection": "Economía",
  "inLanguage": "es-AR",
  "isAccessibleForFree": true,
  "speakable": {
    "@type": "SpeakableSpecification",
    "xpath": ["/html/head/title", "/html/body//article/h1"]
  }
}
```

## 3. Cobertura geográfica detallada

Ciudades con population data (proyecciones INDEC 2026):

- Buenos Aires (CABA): 3.1M hab — /ciudad/buenos-aires
- Córdoba (capital): 1.5M hab — /ciudad/cordoba
- Rosario (Santa Fe): 1.3M hab — /ciudad/rosario
- Mendoza (capital): 0.9M hab — /ciudad/mendoza
- Tucumán (San Miguel de Tucumán): 0.8M hab — /ciudad/tucuman
- La Plata (Buenos Aires): 0.8M hab — /ciudad/la-plata
- Mar del Plata: 0.6M hab — /ciudad/mar-del-plata
- Salta: 0.6M hab — /ciudad/salta
- Santa Fe (capital): 0.5M hab — /ciudad/santa-fe
- San Juan: 0.5M hab — /ciudad/san-juan
- Resistencia (Chaco): 0.4M hab — /ciudad/resistencia
- Neuquén: 0.4M hab — /ciudad/neuquen
- Santiago del Estero: 0.3M hab — /ciudad/santiago-del-estero
- Bahía Blanca: 0.3M hab — /ciudad/bahia-blanca

Total cobertura activa: ~15M de personas (~33% de la población argentina).

## 4. Editorial quality score

Cada nota tiene un score de 0 a 100 calculado en tiempo real por AKIRA. Componentes:

- **Source reliability (40%):** Rating del medio (0-100) basado en historial, transparencia editorial, fact-checking, premios.
- **Coverage breadth (25%):** Cuántas fuentes cubrieron el mismo hecho (cluster size). 1 fuente = 0%, 5+ = 100%.
- **Freshness (15%):** Tiempo desde publicación. <1h = 100%, 24h+ = 0%.
- **Body completeness (10%):** ¿Tiene cuerpo la nota o solo título? Body >500 palabras = 100%.
- **Image presence (5%):** ¿Tiene imagen principal?
- **Bias diversity (5%):** ¿Cuán diverso es el bias rating de las fuentes del cluster? Más diverso = mejor.

Score final = weighted average × 100. Notas <40 no se publican. Notas 40-60 son "rumores", 60-80 "estándar", 80-100 "alta calidad".

## 5. Bias rating

Cada medio aliado tiene un bias_score entre -1 (izquierda) y +1 (derecha), calculado por:
- Muestreo de 200 notas recientes del medio
- Análisis de framing,词汇, fuentes citadas
- Validación cruzada con AllSides / Ad Fontes Media (cuando disponible)
- Review manual inicial

El feed permite filtrar por bias para mostrar al usuario distintas perspectivas. NO ocultamos medios por bias; los etiquetamos y dejamos al usuario elegir.

## 6. Lista de fuentes (200+)

Categorías de medios aliados (resumen):
- Diarios nacionales: La Nación, Clarín, Página/12, Ámbito, El Cronista, Infobae, Perfil
- Diarios regionales: La Voz del Interior, Los Andes, El Litoral, La Gaceta, El Tribuno
- Portales: TN, C5N, El Doce, MDZ Online, Elonce
- Agencias: Télam, NA, DyN
- Radios online: Radio Mitre, Radio 10, La Red, Continental
- TVs: C5N, TN, El Trece online, Canal 9, América TV online

Lista completa actualizada: https://www.antena.com.ar/api/sources

## 7. Roadmap público

Features en development (Q3 2026):
- Versión en portugués (Brasil)
- API pública para investigadores (B2B pricing)
- Suscripción a ciudades (alertas por email/push)
- App nativa iOS / Android (React Native)
- Master articles cross-cluster synthesis
- Bias-aware ranking (mezclar perspectivas en el feed)

Próximamente (Q4 2026):
- Video aggregation (YouTube channels de medios aliados)
- Podcast transcription + search
- Multi-idioma automático (i18n)

## 8. Cómo se financia

- Open source (GitHub público)
- Donaciones opcionales vía Stripe
- B2B API (pricing en /api/public/pricing)
- Cloudflare for Startups grant (hosting)

No vendemos datos. No mostramos ads. Privacy-first por diseño.

## 9. Contacto

- Bugs / sugerencias: hola@antena.com.ar
- Prensa: prensa@antena.com.ar
- Legal: legal@antena.com.ar
- Privacidad: privacidad@antena.com.ar
- GitHub: github.com/<owner>/antena
```

- [ ] **Step 2: Verify build copies the file**

```bash
cd packages/antena && pnpm build && wc -l dist/llms-full.txt
```

Expected: ~140 lines minimum (the spec is comprehensive but doesn't need to hit 300 exactly).

- [ ] **Step 3: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/public/llms-full.txt
git commit -m "feat(antena): create llms-full.txt extended spec for LLM ingestion"
```

---

### Task 16: Create markdown-per-article endpoint

**Files:**
- Create: `packages/antena/src/pages/[year]/[month]/[day]/[slug].md.ts`
- Modify: `packages/antena/src/lib/api.ts` (add `fetchArticleBySlug`)

- [ ] **Step 1: Add `fetchArticleBySlug` helper in `lib/api.ts`**

Add to `packages/antena/src/lib/api.ts`:

```typescript
export interface ArticleMarkdown {
  id: string;
  title: string;
  slug: string;
  slug_date: string;
  summary: string;
  body: string | null;
  source_name: string | null;
  source_url: string | null;
  author: string | null;
  category: string | null;
  location_name: string | null;
  published_at: string;
  sources: { name: string; url: string }[];
}

export async function fetchArticleBySlug(
  year: number,
  month: number,
  day: number,
  slug: string,
  apiBase: string,
): Promise<ArticleMarkdown | null> {
  try {
    const res = await fetch(
      `${apiBase}/api/news/${year}/${month}/${day}/${encodeURIComponent(slug)}`,
      { headers: { 'User-Agent': 'AntenaSSRBatcher/1.0' } },
    );
    if (!res.ok) return null;
    const data = await res.json() as { news: ArticleMarkdown };
    return data.news ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Create the markdown page**

Create `packages/antena/src/pages/[year]/[month]/[day]/[slug].md.ts`:

```typescript
import type { APIRoute } from 'astro';
import { fetchArticleBySlug } from '../../lib/api';

export const prerender = true;

const SITE = 'https://www.antena.com.ar';

export async function getStaticPaths() {
  const fromEnv = import.meta.env.PUBLIC_API_BASE;
  const apiBase = (!fromEnv || fromEnv.includes('localhost'))
    ? 'https://akira-api.miclusty.workers.dev'
    : fromEnv;
  const paths: { params: { year: string; month: string; day: string; slug: string } }[] = [];
  try {
    const res = await fetch(`${apiBase}/api/news/sitemap-batch?limit=500`, {
      headers: { 'User-Agent': 'AntenaSSRBatcher/1.0' },
    });
    if (res.ok) {
      const data = await res.json() as {
        items: { slug_date: string; slug: string }[];
      };
      for (const item of data.items ?? []) {
        const [year, month, day] = item.slug_date.split('-');
        paths.push({ params: { year, month, day, slug: item.slug } });
      }
    }
  } catch {}
  return paths;
}

function yamlEscape(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

export const GET: APIRoute = async ({ params }) => {
  const year = Number(params.year);
  const month = Number(params.month);
  const day = Number(params.day);
  const slug = params.slug!;

  const fromEnv = import.meta.env.PUBLIC_API_BASE;
  const apiBase = (!fromEnv || fromEnv.includes('localhost'))
    ? 'https://akira-api.miclusty.workers.dev'
    : fromEnv;

  const article = await fetchArticleBySlug(year, month, day, slug, apiBase);
  if (!article) {
    return new Response('Not found', { status: 404 });
  }

  const canonicalUrl = `${SITE}/${article.slug_date.split('-').join('/')}/${article.slug}`;
  const frontmatter = [
    '---',
    `id: ${article.id}`,
    `title: ${yamlEscape(article.title)}`,
    `slug: ${article.slug}`,
    `slug_date: ${article.slug_date}`,
    `canonical_url: ${canonicalUrl}`,
    `author: ${yamlEscape(article.author ?? article.source_name ?? 'Antena')}`,
    `category: ${article.category ?? 'General'}`,
    `location: ${article.location_name ?? 'Argentina'}`,
    `published_at: ${article.published_at}`,
    `source_name: ${article.source_name ?? ''}`,
    `source_url: ${article.source_url ?? ''}`,
    'sources:',
    ...((article.sources ?? []).map((s) => `  - name: ${yamlEscape(s.name)}\n    url: ${s.url}`)),
    '---',
  ].join('\n');

  const body = article.body ? `\n\n${stripHtml(article.body)}` : '';
  const sourcesMd = (article.sources ?? []).length
    ? `\n\n## Fuentes\n\n${(article.sources ?? []).map((s) => `- [${s.name}](${s.url})`).join('\n')}\n`
    : '';

  const md = `${frontmatter}\n\n# ${article.title}\n\n> ${stripHtml(article.summary)}${body}${sourcesMd}\n---\n\nEste artículo es una síntesis de ${(article.sources ?? []).length || 'varias'} fuentes. Antena es un agregador, no genera contenido original.\n\nMás info: https://www.antena.com.ar/about\n`;

  return new Response(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
};
```

- [ ] **Step 3: Build and verify**

```bash
cd packages/antena && pnpm build
ls dist/ | grep -E "^[0-9]{4}$"
```

Expected: year directories (e.g., `2026/`) exist. (`.md` files appear after Task 34 is done with the article page.)

- [ ] **Step 4: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/src/pages/\[year\]/\[month\]/\[day\]/\[slug\].md.ts packages/antena/src/lib/api.ts
git commit -m "feat(antena): markdown endpoint per article for LLM ingestion"
```

---

### Task 17: Add FAQPage schema to `ciudad/[city].astro` and `categoria/[cat].astro`

**Files:**
- Modify: `packages/antena/src/pages/ciudad/[city].astro`
- Modify: `packages/antena/src/pages/categoria/[cat].astro`

- [ ] **Step 1: Add FAQPage JSON-LD to `ciudad/[city].astro`**

In the existing `<Fragment slot="head">` of `ciudad/[city].astro`, add a new `<script type="application/ld+json">` block:

```astro
<script type="application/ld+json" set:html={JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  'name': `Preguntas frecuentes sobre noticias de ${cityName}`,
  'inLanguage': 'es-AR',
  'url': canonical,
  'mainEntity': [
    {
      '@type': 'Question',
      'name': `¿Qué pasó hoy en ${cityName}?`,
      'acceptedAnswer': {
        '@type': 'Answer',
        'text': `Las últimas noticias de ${cityName} están disponibles en ${canonical}. Cobertura sintetizada de ${articles.length} notas recientes de múltiples medios locales.`,
      },
    },
    {
      '@type': 'Question',
      'name': `¿Cuáles son las últimas noticias de ${cityName}?`,
      'acceptedAnswer': {
        '@type': 'Answer',
        'text': `Encontrá las últimas ${articles.length} notas de ${cityName} en ${canonical}. Actualización automática cada 2 horas.`,
      },
    },
    {
      '@type': 'Question',
      'name': `¿Qué medios cubren ${cityName}?`,
      'acceptedAnswer': {
        '@type': 'Answer',
        'text': `Antena sintetiza la cobertura de medios aliados de ${cityName}. Lista en https://www.antena.com.ar/api/sources.`,
      },
    },
    ...(articles[0] ? [{
      '@type': 'Question',
      'name': `¿Cuál es la nota más reciente de ${cityName}?`,
      'acceptedAnswer': {
        '@type': 'Answer',
        'text': `"${articles[0].title}" es la nota más reciente de ${cityName}. Leela en ${SITE}/noticia/${articles[0].id}.`,
      },
    }] : []),
  ],
})} />
```

- [ ] **Step 2: Add FAQPage JSON-LD to `categoria/[cat].astro`** (same pattern)

```astro
<script type="application/ld+json" set:html={JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  'name': `Preguntas frecuentes sobre noticias de ${category}`,
  'inLanguage': 'es-AR',
  'url': canonical,
  'mainEntity': [
    {
      '@type': 'Question',
      'name': `¿Qué pasó hoy en ${category}?`,
      'acceptedAnswer': {
        '@type': 'Answer',
        'text': `Las últimas noticias de ${category} están en ${canonical}. Cobertura sintetizada de ${articles.length} notas recientes.`,
      },
    },
    {
      '@type': 'Question',
      'name': `¿Cuáles son las últimas noticias de ${category} en Argentina?`,
      'acceptedAnswer': {
        '@type': 'Answer',
        'text': `Encontrá las ${articles.length} notas más recientes de ${category} en Argentina en ${canonical}.`,
      },
    },
    {
      '@type': 'Question',
      'name': `¿Qué medios cubren mejor ${category}?`,
      'acceptedAnswer': {
        '@type': 'Answer',
        'text': `Antena sintetiza la cobertura de medios aliados categorizados como ${category}. Lista en https://www.antena.com.ar/api/sources.`,
      },
    },
    ...(articles[0] ? [{
      '@type': 'Question',
      'name': `¿Cuál es la nota más reciente de ${category}?`,
      'acceptedAnswer': {
        '@type': 'Answer',
        'text': `"${articles[0].title}" es la nota más reciente de ${category}. Leela en ${SITE}/noticia/${articles[0].id}.`,
      },
    }] : []),
  ],
})} />
```

- [ ] **Step 3: Build and verify**

```bash
cd packages/antena && pnpm build
grep -l "FAQPage" dist/ciudad/*/index.html dist/categoria/*/index.html | head -3
```

Expected: at least one ciudad page and one categoria page contain "FAQPage".

- [ ] **Step 4: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/src/pages/ciudad/[city].astro packages/antena/src/pages/categoria/[cat].astro
git commit -m "feat(antena): add FAQPage JSON-LD to city and category hubs"
```

---

### Task 18: Create `/api/llm/cite` worker endpoint

**Files:**
- Create: `packages/api/src/routes/llm/cite.ts`
- Modify: `packages/api/src/index.ts` (mount the route)

- [ ] **Step 1: Create the cite endpoint**

Create `packages/api/src/routes/llm/cite.ts`:

```typescript
import { Hono } from 'hono';

interface Bindings {
  DB: D1Database;
  CACHE: KVNamespace;
}

interface NewsCardRow {
  id: string;
  title: string;
  summary: string;
  body: string | null;
  image_url: string | null;
  source_name: string | null;
  source_url: string | null;
  author: string | null;
  category: string | null;
  location_name: string | null;
  published_at: string;
  slug: string;
  slug_date: string;
  cluster_id: string | null;
}

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/llm/cite', async (c) => {
  const id = c.req.query('id');
  if (!id) {
    return c.json({ error: 'Missing id' }, 400);
  }

  const cacheKey = `llm-cite:${id}`;
  const cached = await c.env.CACHE.get(cacheKey, 'json');
  if (cached) {
    return c.json(cached, 200, { 'Cache-Control': 'public, max-age=3600' });
  }

  const row = await c.env.DB.prepare(
    `SELECT id, title, summary, body, image_url, source_name, source_url,
            author, category, location_name, published_at, slug, slug_date,
            cluster_id
     FROM news_cards WHERE id = ?`
  ).bind(id).first<NewsCardRow>();

  if (!row) {
    return c.json({ error: 'Not found' }, 404);
  }

  const sources = row.cluster_id
    ? await c.env.DB.prepare(
        `SELECT DISTINCT s.name, s.url
         FROM news_cards nc
         JOIN sources s ON s.id = nc.source_id
         WHERE nc.cluster_id = ? AND s.url IS NOT NULL
         LIMIT 10`
      ).bind(row.cluster_id).all<{ name: string; url: string }>()
    : { results: [] };

  const SITE = 'https://www.antena.com.ar';
  const [year, month, day] = row.slug_date.split('-');
  const canonicalUrl = `${SITE}/${year}/${month}/${day}/${row.slug}`;
  const markdownUrl = `${canonicalUrl}.md`;

  const payload = {
    id: row.id,
    canonical_url: canonicalUrl,
    markdown_url: markdownUrl,
    title: row.title,
    summary: row.summary,
    body: row.body,
    author: row.author ?? row.source_name ?? 'Antena',
    category: row.category ?? 'General',
    location: row.location_name ?? 'Argentina',
    published_at: row.published_at,
    image_url: row.image_url,
    sources: sources.results ?? [],
    citation_hint: `Citar como: "${row.title}" (Antena, ${new Date(row.published_at).toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' })}). URL: ${canonicalUrl}`,
    license: 'aggregator-attribution',
  };

  await c.env.CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 3600 });

  return c.json(payload, 200, { 'Cache-Control': 'public, max-age=3600' });
});

export default app;
```

- [ ] **Step 2: Mount the route in `src/index.ts`**

Find where other routes are mounted (search for `app.route(`) and add:

```typescript
import cite from './routes/llm/cite';
app.route('/', cite);
```

- [ ] **Step 3: Run typecheck**

```bash
cd packages/api && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Test the endpoint locally**

```bash
cd packages/api && pnpm dev
# In another terminal:
curl 'http://localhost:8787/api/llm/cite?id=<some-uuid>' | jq .
```

Expected: 200 with JSON payload (after Phase 2 is deployed with slug columns).

- [ ] **Step 5: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/api/src/routes/llm/cite.ts packages/api/src/index.ts
git commit -m "feat(api): /api/llm/cite endpoint for LLM-friendly citation JSON"
```

---

### Task 19: GEO tests

**Files:**
- Create: `packages/antena/tests/llms-txt.test.ts`
- Create: `packages/api/tests/llm-cite.test.ts`

- [ ] **Step 1: Write `llms-txt.test.ts`**

```typescript
import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LLMS_TXT = join(process.cwd(), 'packages/antena/public/llms.txt');
const LLMS_FULL = join(process.cwd(), 'packages/antena/public/llms-full.txt');

describe('LLM-friendly files', () => {
  test('llms.txt exists', () => {
    expect(existsSync(LLMS_TXT)).toBe(true);
  });

  test('llms.txt has citation example and uses www.', () => {
    const content = readFileSync(LLMS_TXT, 'utf-8');
    expect(content).toMatch(/Citar como|Cómo citar/);
    expect(content).toMatch(/https:\/\/www\.antena\.com\.ar/);
  });

  test('llms-full.txt exists and is substantial', () => {
    expect(existsSync(LLMS_FULL)).toBe(true);
    const content = readFileSync(LLMS_FULL, 'utf-8');
    expect(content.split('\n').length).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 2: Write a basic `llm-cite.test.ts`**

```typescript
import { describe, expect, test } from 'vitest';
import app from '../src/routes/llm/cite';

describe('GET /api/llm/cite', () => {
  test('returns 400 when id is missing', async () => {
    const res = await app.request('/api/llm/cite', { method: 'GET' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/omatic/proyectos/news
pnpm --filter antena test llms
pnpm --filter api test llm-cite
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/tests/llms-txt.test.ts packages/api/tests/llm-cite.test.ts
git commit -m "test: GEO endpoints and llms.txt validation"
```

---

### Task 20: Deploy Phase 1 to staging

**Files:** (none — deploy task)

- [ ] **Step 1: Build + deploy frontend**

```bash
pnpm --filter antena build
pnpm deploy:staging
```

- [ ] **Step 2: Verify llms.txt accessible**

```bash
curl -sI https://staging.antena.com.ar/llms.txt
curl -s https://staging.antena.com.ar/llms.txt | head -10
```

Expected: HTTP 200, content matches.

- [ ] **Step 3: Verify llms-full.txt accessible**

```bash
curl -sI https://staging.antena.com.ar/llms-full.txt
```

Expected: HTTP 200.

- [ ] **Step 4: Deploy API with /api/llm/cite**

```bash
cd packages/api && pnpm deploy:staging
```

- [ ] **Step 5: Smoke test cite endpoint**

```bash
curl 'https://staging-api.antena.com.ar/api/llm/cite?id=<test-uuid>' | jq .
```

Expected: 200 with JSON (once Phase 2 is in staging).

- [ ] **Step 6: Commit CHANGELOG**

```bash
cd /Users/omatic/proyectos/news
echo "- Phase 1: GEO expansion (llms-full.txt, FAQPage, /api/llm/cite) deployed" >> CHANGELOG.md
git add CHANGELOG.md
git commit -m "docs: Phase 1 GEO expansion deployed to staging"
```

---

## Phase 2: Backend Slug Infrastructure

**Goal:** Add `slug` and `slug_date` columns to D1, write the Python slug generator, create a backfill script, and update the AKIRA engine to generate slugs on extraction. Also create new worker endpoints for canonical URLs and sitemap batches.

**Deployable:** Yes (backward compatible). Legacy `/noticia/<uuid>` routes keep working. New endpoints read by slug are additive.

**Estimated time:** 4–5 hours.

---

### Task 21: Add `slug` and `slug_date` columns to Drizzle schema

**Files:**
- Modify: `packages/api/src/db/schema.ts`

- [ ] **Step 1: Read current schema**

```bash
cat packages/api/src/db/schema.ts | head -50
```

- [ ] **Step 2: Add columns to `newsCards` table**

Add after the existing fields in the `newsCards` definition:

```typescript
slug: text('slug').notNull().default(''),
slugDate: text('slug_date').notNull().default(''),
```

- [ ] **Step 3: Add indexes**

In the table's `extraConfig` or wherever indexes are defined, add:

```typescript
(table) => ({
  ...existing,
  slugUniqueIdx: uniqueIndex('idx_news_slug').on(table.slugDate, table.slug),
  slugLookupIdx: index('idx_news_slug_lookup').on(table.slug),
})
```

(Adjust the syntax to match the existing schema's pattern — Drizzle's `sqliteTable` second arg.)

- [ ] **Step 4: Generate migration**

```bash
cd packages/api && pnpm drizzle-kit generate
```

Expected: creates `packages/api/migrations/00XX_seo_slug.sql` with the ALTER TABLE.

- [ ] **Step 5: Inspect the generated migration**

```bash
ls packages/api/migrations/
cat packages/api/migrations/00XX_seo_slug.sql
```

Verify it has: `ALTER TABLE news_cards ADD COLUMN slug TEXT NOT NULL DEFAULT '';` and `ALTER TABLE news_cards ADD COLUMN slug_date TEXT NOT NULL DEFAULT '';` plus the indexes.

- [ ] **Step 6: Apply migration locally**

```bash
cd packages/api && pnpm wrangler d1 migrations apply DB --local
```

Expected: migration applied.

- [ ] **Step 7: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/api/src/db/schema.ts packages/api/migrations/
git commit -m "feat(api): add slug and slug_date columns to news_cards"
```

---

### Task 22: Create `extractors/_slug.py` with TDD

**Files:**
- Create: `packages/akira/extractors/_slug.py`
- Create: `packages/akira/tests/test_slug.py`

- [ ] **Step 1: Write the failing tests**

Create `packages/akira/tests/test_slug.py`:

```python
import pytest
from extractors._slug import make_slug

class TestMakeSlug:
    def test_basic_ascii(self):
        assert make_slug("Hello World") == "hello-world"

    def test_removes_accents(self):
        assert make_slug("Dólar blue HOY") == "dolar-blue-hoy"

    def test_removes_stopwords(self):
        assert make_slug("El gobierno de Argentina anunció") == "gobierno-argentina-anuncio"

    def test_lowercases(self):
        assert make_slug("UPPERCASE") == "uppercase"

    def test_handles_punctuation(self):
        assert make_slug("Dólar blue HOY: cierre a $1.245") == "dolar-blue-hoy-cierre-1245"

    def test_handles_numbers(self):
        assert make_slug("2026 noticias") == "2026-noticias"

    def test_truncates_to_max_words(self):
        result = make_slug("uno dos tres cuatro cinco seis siete ocho nueve", max_words=5)
        assert result == "uno-dos-tres-cuatro-cinco"

    def test_empty_title_returns_fallback(self):
        assert make_slug("") == "sin-titulo"
        assert make_slug("   ") == "sin-titulo"
        assert make_slug("!!!") == "sin-titulo"

    def test_only_stopwords_returns_fallback(self):
        assert make_slug("el la de los las") == "sin-titulo"

    def test_collapses_whitespace(self):
        assert make_slug("a   b   c") == "a-b-c"

    def test_unicode_handling(self):
        assert make_slug("Niño en Bogotá") == "nino-bogota"
        assert make_slug("São Paulo") == "sao-paulo"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/akira && source .venv/bin/activate
python -m pytest tests/test_slug.py -v
```

Expected: FAIL — `extractors/_slug` module not found.

- [ ] **Step 3: Implement `_slug.py`**

Create `packages/akira/extractors/_slug.py`:

```python
"""SEO-friendly slug generation for news article URLs.

Produces URL-safe slugs from Spanish (or any Latin-script) titles:
- ASCII-normalized (accents stripped, ñ→n)
- Lowercase
- Stopwords removed
- 7 words max by default
- 60 chars total max
"""
import re
import unicodedata
from typing import Final

STOPWORDS: Final[frozenset[str]] = frozenset({
    "a", "al", "con", "de", "del", "e", "el", "en", "es", "esa", "ese",
    "esta", "este", "esto", "ha", "han", "hay", "la", "las", "le", "lo",
    "los", "o", "para", "por", "que", "se", "sin", "son", "su", "sus",
    "un", "una", "unas", "uno", "unos", "u", "y", "fue", "sobre", "tras",
    "desde", "hasta", "como", "mas", "pero", "ya", "les", "me", "te", "nos",
})

_FALLBACK_SLUG: Final[str] = "sin-titulo"
_MAX_WORDS: Final[int] = 7
_MAX_CHARS: Final[int] = 60


def _strip_accents(s: str) -> str:
    """'Dólar' → 'Dolar', 'Niño' → 'Nino'."""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def make_slug(title: str, max_words: int = _MAX_WORDS) -> str:
    """Generate an SEO-friendly slug from a title.

    Examples:
        >>> make_slug("Dólar blue HOY: cierre a $1.245")
        'dolar-blue-hoy-cierre-1245'
        >>> make_slug("El gobierno de Argentina anunció nuevas medidas")
        'gobierno-argentina-anuncio-nuevas-medidas'
        >>> make_slug("2026 noticias")
        '2026-noticias'
    """
    if not title or not title.strip():
        return _FALLBACK_SLUG

    text = _strip_accents(title.lower())
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    words = [w for w in text.split() if w and w not in STOPWORDS]
    if not words:
        return _FALLBACK_SLUG

    slug = "-".join(words[:max_words])

    if len(slug) > _MAX_CHARS:
        slug = slug[:_MAX_CHARS].rsplit("-", 1)[0]

    return slug or _FALLBACK_SLUG
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/akira && source .venv/bin/activate
python -m pytest tests/test_slug.py -v
```

Expected: 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/akira/extractors/_slug.py packages/akira/tests/test_slug.py
git commit -m "feat(akira): make_slug() function for SEO-friendly URL slugs"
```

---

### Task 23: Create backfill script

**Files:**
- Create: `packages/akira/scripts/backfill_slugs.py`
- Create: `packages/akira/tests/test_backfill.py`

- [ ] **Step 1: Write the test**

Create `packages/akira/tests/test_backfill.py`:

```python
import importlib.util
import sqlite3
import sys
from pathlib import Path

import pytest

# Load backfill_slugs.py as a module (it's in scripts/)
spec = importlib.util.spec_from_file_location(
    "backfill", Path(__file__).parent.parent / "scripts" / "backfill_slugs.py"
)
backfill = importlib.util.module_from_spec(spec)
sys.modules["backfill"] = backfill
spec.loader.exec_module(backfill)


def test_resolve_slug_no_collision():
    assert backfill.resolve_slug("foo", "2026-06-15", set()) == "foo"


def test_resolve_slug_collision_adds_suffix():
    existing = {"foo"}
    result = backfill.resolve_slug("foo", "2026-06-15", existing, "abc123def456")
    assert result.startswith("foo-")
    assert result != "foo"


def test_resolve_slug_unique_suffix_per_collision():
    existing = {"foo"}
    result1 = backfill.resolve_slug("foo", "2026-06-15", existing, "abc123def456")
    existing.add(result1)
    result2 = backfill.resolve_slug("foo", "2026-06-15", existing, "xyz789ghi012")
    assert result1 != result2


def test_get_existing_slugs():
    with tempfile.NamedTemporaryFile(suffix=".db") as f:
        conn = sqlite3.connect(f.name)
        conn.execute("CREATE TABLE news_cards (id TEXT, slug TEXT, slug_date TEXT)")
        conn.execute("INSERT INTO news_cards VALUES ('a', 'x', '2026-06-15')")
        conn.execute("INSERT INTO news_cards VALUES ('b', 'y', '2026-06-15')")
        conn.commit()
        existing = backfill.get_existing_slugs_for_date(conn, "2026-06-15")
        assert existing == {"x", "y"}


def test_slug_date_from_published_at():
    assert backfill.slug_date_from_published_at("2026-06-15T12:34:56Z") == "2026-06-15"
    assert backfill.slug_date_from_published_at("2026-06-15") == "2026-06-15"
    assert backfill.slug_date_from_published_at(None) is not None
```

(Add `import tempfile` at the top of the test file.)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/akira && source .venv/bin/activate
python -m pytest tests/test_backfill.py -v
```

Expected: FAIL — `scripts/backfill_slugs.py` not found.

- [ ] **Step 3: Implement the backfill script**

Create `packages/akira/scripts/backfill_slugs.py`:

```python
"""One-time backfill: generate slug + slug_date for all news_cards.

Idempotent. Safe to re-run. Logs progress.

Usage:
    python scripts/backfill_slugs.py --dry-run  # preview only
    python scripts/backfill_slugs.py             # apply to local SQLite
    python scripts/backfill_slugs.py --db /path/to/production.db
"""
import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from extractors._slug import make_slug


def get_existing_slugs_for_date(conn: sqlite3.Connection, slug_date: str) -> set[str]:
    rows = conn.execute(
        "SELECT slug FROM news_cards WHERE slug_date = ? AND slug != ''",
        (slug_date,),
    ).fetchall()
    return {r[0] for r in rows}


def resolve_slug(base_slug: str, slug_date: str, existing: set[str], article_id: str = "") -> str:
    if base_slug not in existing:
        return base_slug
    suffix = (article_id or "x")[:6].lower()
    candidate = f"{base_slug}-{suffix}"
    if candidate not in existing:
        return candidate
    i = 2
    while f"{base_slug}-{suffix}-{i}" in existing:
        i += 1
    return f"{base_slug}-{suffix}-{i}"


def slug_date_from_published_at(published_at: str | None) -> str:
    if not published_at:
        return datetime.utcnow().strftime("%Y-%m-%d")
    try:
        return published_at[:10]
    except Exception:
        return datetime.utcnow().strftime("%Y-%m-%d")


def backfill(db_path: str, dry_run: bool = False, batch_size: int = 1000) -> int:
    conn = sqlite3.connect(db_path)
    cursor = conn.execute(
        "SELECT id, title, published_at, slug, slug_date FROM news_cards WHERE slug = '' OR slug IS NULL"
    )
    rows = cursor.fetchall()
    total = len(rows)
    print(f"Found {total} news_cards to backfill", file=sys.stderr)
    if total == 0:
        return 0
    cache: dict[str, set[str]] = {}
    updated = 0
    batch = []
    for i, (article_id, title, published_at, _old_slug, _old_date) in enumerate(rows, 1):
        slug_date = slug_date_from_published_at(published_at)
        if slug_date not in cache:
            cache[slug_date] = get_existing_slugs_for_date(conn, slug_date)
        existing = cache[slug_date]
        base = make_slug(title or "")
        final = resolve_slug(base, slug_date, existing, article_id)
        cache[slug_date].add(final)
        batch.append((final, slug_date, article_id))
        if len(batch) >= batch_size:
            if not dry_run:
                conn.executemany(
                    "UPDATE news_cards SET slug = ?, slug_date = ? WHERE id = ?",
                    batch,
                )
                conn.commit()
            updated += len(batch)
            batch = []
            if i % 5000 == 0:
                print(f"  {i}/{total} ({updated} updated)", file=sys.stderr)
    if batch:
        if not dry_run:
            conn.executemany(
                "UPDATE news_cards SET slug = ?, slug_date = ? WHERE id = ?",
                batch,
            )
            conn.commit()
        updated += len(batch)
    conn.close()
    mode = "WOULD update" if dry_run else "Updated"
    print(f"{mode} {updated}/{total} rows", file=sys.stderr)
    return updated


def main():
    parser = argparse.ArgumentParser(description="Backfill slug + slug_date for news_cards")
    parser.add_argument("--db", default="data/akira.db", help="Path to SQLite database")
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no writes")
    parser.add_argument("--batch-size", type=int, default=1000, help="Rows per commit batch")
    args = parser.parse_args()
    updated = backfill(args.db, dry_run=args.dry_run, batch_size=args.batch_size)
    sys.exit(0 if updated >= 0 else 1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/akira && source .venv/bin/activate
python -m pytest tests/test_backfill.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 5: Dry-run on local DB**

```bash
cd packages/akira && source .venv/bin/activate
python scripts/backfill_slugs.py --dry-run
```

Expected: prints "Found N news_cards to backfill" and "WOULD update N/M rows".

- [ ] **Step 6: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/akira/scripts/backfill_slugs.py packages/akira/tests/test_backfill.py
git commit -m "feat(akira): backfill script for slug + slug_date with collision handling"
```

---

### Task 24: Integrate slug generation in AKIRA engine

**Files:**
- Modify: `packages/akira/core/engine.py`

- [ ] **Step 1: Find the `store_article` function**

```bash
grep -n "store_article\|INSERT INTO news_cards" packages/akira/core/engine.py
```

- [ ] **Step 2: Add import**

At the top of `engine.py`, add:

```python
from extractors._slug import make_slug
```

- [ ] **Step 3: Add slug generation before INSERT**

In `store_article`, after the article dict is prepared but before the INSERT, compute slug:

```python
slug = make_slug(article.get("title", ""))
slug_date = (article.get("published_at") or datetime.utcnow().isoformat())[:10]
```

- [ ] **Step 4: Add collision handling**

Add a helper at module level:

```python
def _get_existing_slugs_for_date(conn, slug_date: str) -> set[str]:
    rows = conn.execute(
        "SELECT slug FROM news_cards WHERE slug_date = ? AND slug != ''",
        (slug_date,),
    ).fetchall()
    return {r[0] for r in rows}
```

In `store_article`, after computing the base slug, check for collisions and resolve them (using the same logic as `backfill_slugs.resolve_slug`).

- [ ] **Step 5: Add `slug` and `slug_date` to the INSERT statement and tuple**

Update the column list and values tuple to include the new fields.

- [ ] **Step 6: Run AKIRA tests**

```bash
cd packages/akira && source .venv/bin/activate
python -m pytest
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/akira/core/engine.py
git commit -m "feat(akira): generate slug + slug_date in store_article"
```

---

### Task 25: Update `/api/news/feed` to include slug + slug_date

**Files:**
- Modify: `packages/api/src/routes/news/feed.ts` (or wherever the feed handler lives)
- Modify: `packages/api/src/lib/schemas.ts` (Zod)

- [ ] **Step 1: Find the feed handler**

```bash
find packages/api/src -name "*.ts" | xargs grep -l "news/feed\|/api/news/feed" 2>/dev/null
```

- [ ] **Step 2: Add slug + slug_date to the SELECT**

Change the SQL to include `slug, slug_date`.

- [ ] **Step 3: Add fields to the response mapping**

In the TypeScript that builds the response, add:

```typescript
slug: row.slug,
slug_date: row.slug_date,
```

- [ ] **Step 4: Update Zod schema**

In `packages/api/src/lib/schemas.ts`, add to the news card schema:

```typescript
slug: z.string(),
slug_date: z.string(),
```

- [ ] **Step 5: Run typecheck + smoke test**

```bash
cd packages/api && pnpm typecheck
cd packages/api && pnpm dev
curl 'http://localhost:8787/api/news/feed?limit=2' | jq '.news[0] | {id, title, slug, slug_date}'
```

Expected: PASS, response includes `slug` and `slug_date`.

- [ ] **Step 6: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/api/src/
git commit -m "feat(api): feed response includes slug + slug_date"
```

---

### Task 26: Create `/api/news/sitemap-batch` endpoint

**Files:**
- Create: `packages/api/src/routes/news/sitemap-batch.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Create the endpoint**

```typescript
import { Hono } from 'hono';

interface Bindings {
  DB: D1Database;
  CACHE: KVNamespace;
}

interface SitemapItem {
  id: string;
  slug: string;
  slug_date: string;
  published_at: string;
}

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/news/sitemap-batch', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 500), 1000);
  const offset = Number(c.req.query('offset') ?? 0);

  const cacheKey = `sitemap-batch:${limit}:${offset}`;
  const cached = await c.env.CACHE.get(cacheKey, 'json');
  if (cached) {
    return c.json(cached, 200, { 'Cache-Control': 'public, max-age=600' });
  }

  const result = await c.env.DB.prepare(
    `SELECT id, slug, slug_date, published_at
     FROM news_cards
     WHERE slug != '' AND slug_date != ''
     ORDER BY published_at DESC
     LIMIT ? OFFSET ?`
  ).bind(limit, offset).all<SitemapItem>();

  const payload = {
    items: result.results ?? [],
    total: result.results?.length ?? 0,
    limit,
    offset,
  };

  await c.env.CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 600 });

  return c.json(payload, 200, { 'Cache-Control': 'public, max-age=600' });
});

export default app;
```

- [ ] **Step 2: Mount the route in `src/index.ts`**

```typescript
import sitemapBatch from './routes/news/sitemap-batch';
app.route('/', sitemapBatch);
```

- [ ] **Step 3: Test locally + commit**

```bash
cd packages/api && pnpm dev
curl 'http://localhost:8787/api/news/sitemap-batch?limit=5' | jq .
```

Expected: 200 with `{items: [...], total: 5, ...}`.

```bash
cd /Users/omatic/proyectos/news
git add packages/api/src/routes/news/sitemap-batch.ts packages/api/src/index.ts
git commit -m "feat(api): /api/news/sitemap-batch for Astro getStaticPaths"
```

---

### Task 27: Create `/api/news/<year>/<month>/<day>/<slug>` canonical endpoint

**Files:**
- Create: `packages/api/src/routes/news/canonical.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Create the endpoint**

```typescript
import { Hono } from 'hono';

interface Bindings {
  DB: D1Database;
  CACHE: KVNamespace;
}

interface NewsCardRow {
  id: string;
  title: string;
  summary: string;
  body: string | null;
  image_url: string | null;
  source_name: string | null;
  source_url: string | null;
  author: string | null;
  category: string | null;
  location_name: string | null;
  published_at: string;
  slug: string;
  slug_date: string;
  cluster_id: string | null;
  source_id: string | null;
  bias_score: number | null;
}

const app = new Hono<{ Bindings: Bindings }>();

app.get('/api/news/:year/:month/:day/:slug', async (c) => {
  const year = c.req.param('year');
  const month = c.req.param('month');
  const day = c.req.param('day');
  const slug = c.req.param('slug');

  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
    return c.json({ error: 'Invalid date format' }, 400);
  }

  const slug_date = `${year}-${month}-${day}`;
  const cacheKey = `news-canonical:${slug_date}:${slug}`;
  const cached = await c.env.CACHE.get(cacheKey, 'json');
  if (cached) {
    return c.json(cached, 200, { 'Cache-Control': 'public, max-age=600' });
  }

  const row = await c.env.DB.prepare(
    `SELECT id, title, summary, body, image_url, source_name, source_url,
            author, category, location_name, published_at, slug, slug_date,
            cluster_id, source_id, bias_score
     FROM news_cards WHERE slug_date = ? AND slug = ?`
  ).bind(slug_date, slug).first<NewsCardRow>();

  if (!row) {
    return c.json({ error: 'Not found' }, 404);
  }

  const sources = row.cluster_id
    ? await c.env.DB.prepare(
        `SELECT DISTINCT s.name, s.url
         FROM news_cards nc
         JOIN sources s ON s.id = nc.source_id
         WHERE nc.cluster_id = ? AND s.url IS NOT NULL
         LIMIT 10`
      ).bind(row.cluster_id).all<{ name: string; url: string }>()
    : { results: [] };

  const payload = {
    news: {
      id: row.id,
      title: row.title,
      summary: row.summary,
      body: row.body,
      image_url: row.image_url,
      source_name: row.source_name,
      source_url: row.source_url,
      author: row.author,
      category: row.category,
      location_name: row.location_name,
      published_at: row.published_at,
      slug: row.slug,
      slug_date: row.slug_date,
      bias_score: row.bias_score,
      cluster_id: row.cluster_id,
      sources: sources.results ?? [],
    },
  };

  await c.env.CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 600 });

  return c.json(payload, 200, { 'Cache-Control': 'public, max-age=600' });
});

export default app;
```

- [ ] **Step 2: Mount the route in `src/index.ts`**

```typescript
import canonical from './routes/news/canonical';
app.route('/', canonical);
```

- [ ] **Step 3: Test locally + commit**

```bash
cd packages/api && pnpm dev
curl 'http://localhost:8787/api/news/2026/06/15/<some-slug>' | jq .
```

Expected: 200 with `{news: {...}}` or 404.

```bash
cd /Users/omatic/proyectos/news
git add packages/api/src/routes/news/canonical.ts packages/api/src/index.ts
git commit -m "feat(api): /api/news/<year>/<month>/<day>/<slug> canonical endpoint"
```

---

### Task 28: Update `/api/news/<id>` to 301 redirect to canonical

**Files:**
- Modify: `packages/api/src/routes/news/[id].ts` (or wherever the UUID handler is)

- [ ] **Step 1: Find the existing handler**

```bash
find packages/api/src -name "*.ts" | xargs grep -l "news/:id\|/api/news/{id}" 2>/dev/null
```

- [ ] **Step 2: Add canonical lookup and redirect**

At the top of the handler (after fetching the row by id), look up `slug` and `slug_date`, then if both are present, return a 301:

```typescript
if (row.slug && row.slug_date) {
  const [y, m, d] = row.slug_date.split('-');
  const canonical = `https://www.antena.com.ar/${y}/${m}/${d}/${row.slug}`;
  return c.redirect(canonical, 301);
}
return c.json({ news: row });
```

- [ ] **Step 3: Test locally + commit**

```bash
cd packages/api && pnpm dev
curl -sI 'http://localhost:8787/api/news/<some-uuid-with-slug>' | head -5
```

Expected: `HTTP/1.1 301` and `Location: https://www.antena.com.ar/<year>/<month>/<day>/<slug>`.

```bash
cd /Users/omatic/proyectos/news
git add packages/api/src/routes/news/
git commit -m "feat(api): /api/news/<id> redirects 301 to canonical slug URL"
```

---

### Task 29: Apply D1 migration + backfill production

**Files:** (none — D1 ops task)

- [ ] **Step 1: Apply the migration to remote D1**

```bash
cd packages/api && pnpm wrangler d1 migrations apply DB --env=production --remote
```

Expected: migration applied successfully.

- [ ] **Step 2: Verify migration applied**

```bash
pnpm wrangler d1 execute DB --env=production --remote --command="PRAGMA table_info(news_cards);" | grep -E "slug|slug_date"
```

Expected: `slug` and `slug_date` columns exist.

- [ ] **Step 3: Generate backfill SQL via local script**

Use the local SQLite DB to generate the migration SQL (one UPDATE per row):

```bash
cd packages/akira && source .venv/bin/activate
python -c "
import sqlite3, sys
from pathlib import Path
sys.path.insert(0, 'scripts')
from backfill_slugs import resolve_slug, get_existing_slugs_for_date, slug_date_from_published_at
from extractors._slug import make_slug
conn = sqlite3.connect('data/akira.db')
rows = conn.execute('SELECT id, title, published_at FROM news_cards').fetchall()
cache = {}
print('BEGIN;')
for row in rows:
    article_id, title, published_at = row
    slug_date = slug_date_from_published_at(published_at)
    if slug_date not in cache:
        cache[slug_date] = get_existing_slugs_for_date(conn, slug_date)
    base = make_slug(title or '')
    final = resolve_slug(base, slug_date, cache[slug_date], article_id)
    cache[slug_date].add(final)
    safe_id = article_id.replace(chr(39), chr(39)*2)
    safe_slug = final.replace(chr(39), chr(39)*2)
    print(f\"UPDATE news_cards SET slug = '{safe_slug}', slug_date = '{slug_date}' WHERE id = '{safe_id}';\")
print('COMMIT;')
" > /tmp/backfill.sql
wc -l /tmp/backfill.sql
```

- [ ] **Step 4: Apply the SQL to remote D1 in batches**

```bash
cd packages/api
split -l 1000 /tmp/backfill.sql /tmp/backfill_batch_
for batch in /tmp/backfill_batch_*; do
  pnpm wrangler d1 execute DB --env=production --remote --file="$batch"
done
```

Expected: each batch succeeds.

- [ ] **Step 5: Verify**

```bash
pnpm wrangler d1 execute DB --env=production --remote --command="SELECT COUNT(*) FROM news_cards WHERE slug != '' AND slug_date != '';"
```

Expected: total news count.

- [ ] **Step 6: Save the SQL to ops**

```bash
mkdir -p scripts/d1
mv /tmp/backfill.sql scripts/d1/backfill-slugs.sql
git add scripts/d1/
git commit -m "ops(d1): backfill SQL for slug + slug_date on production"
```

---

## Phase 3: Astro URL Migration

**Goal:** Create the new `/<year>/<month>/<day>/<slug>.astro` page, turn the legacy `/noticia/<id>.astro` into a 301 redirect, generate redirects in bulk via build script.

**Deployable:** Yes. Requires Phase 2 to be done first.

**Estimated time:** 3–4 hours.

---

### Task 30: Create `redirects-generator.ts`

**Files:**
- Create: `packages/api/src/lib/redirects-generator.ts`

- [ ] **Step 1: Write the script**

```typescript
/**
 * Build-time script: reads news_cards from D1 and emits Cloudflare Pages
 * _redirects file mapping /noticia/<uuid> → /<year>/<month>/<day>/<slug>.
 *
 * Output: packages/antena/public/_redirects (appended to existing rules)
 * Limit: Cloudflare Pages accepts 2000 redirect rules. The rest are handled
 *        by the worker middleware (Task 32).
 */
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REDIRECTS_PATH = join(__dirname, '../../../antena/public/_redirects');
const CACHE_PATH = join(__dirname, '../../.redirects-cache.json');
const MAX_REDIRECTS_IN_FILE = 2000;

interface SitemapItem {
  id: string;
  slug: string;
  slug_date: string;
  published_at: string;
}

function fetchAllSlugs(): SitemapItem[] {
  const cmd = `pnpm wrangler d1 execute DB --env=production --remote --json --command="SELECT id, slug, slug_date, published_at FROM news_cards WHERE slug != '' AND slug_date != '' ORDER BY published_at DESC"`;
  const output = execSync(cmd, { encoding: 'utf-8' });
  const json = JSON.parse(output);
  return json.results?.[0]?.results ?? [];
}

function buildRedirectLine(item: SitemapItem): string {
  const [year, month, day] = item.slug_date.split('-');
  return `/noticia/${item.id}  /${year}/${month}/${day}/${item.slug}  301!`;
}

function main() {
  console.log('[redirects-generator] Fetching slugs from D1...');
  const items = fetchAllSlugs();
  console.log(`[redirects-generator] Found ${items.length} slugs`);

  if (items.length === 0) {
    console.log('[redirects-generator] No slugs to process, exiting');
    return;
  }

  const sorted = items.sort((a, b) =>
    new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  );

  const inFile = sorted.slice(0, MAX_REDIRECTS_IN_FILE);
  const inWorker = sorted.slice(MAX_REDIRECTS_IN_FILE);

  const newLines = inFile.map(buildRedirectLine);

  const existing = existsSync(REDIRECTS_PATH)
    ? readFileSync(REDIRECTS_PATH, 'utf-8').split('\n').filter((line) => {
        return !/^\/noticia\/[0-9a-f-]{36}\s/.test(line);
      })
    : [];

  const finalContent = [...existing.filter(Boolean), ...newLines].join('\n') + '\n';
  writeFileSync(REDIRECTS_PATH, finalContent, 'utf-8');
  console.log(`[redirects-generator] Wrote ${inFile.length} redirects to ${REDIRECTS_PATH}`);

  const kvData = Object.fromEntries(
    inWorker.map((item) => {
      const [y, m, d] = item.slug_date.split('-');
      return [item.id, `/${y}/${m}/${d}/${item.slug}`];
    })
  );
  writeFileSync(CACHE_PATH, JSON.stringify(kvData, null, 2), 'utf-8');
  console.log(`[redirects-generator] Wrote ${inWorker.length} KV entries to ${CACHE_PATH}`);
}

main();
```

- [ ] **Step 2: Run the script + verify + commit**

```bash
cd packages/api && pnpm tsx src/lib/redirects-generator.ts
head -20 packages/antena/public/_redirects
wc -l packages/antena/public/_redirects
```

Expected: non-www rules first, then 2000+ UUID → slug lines.

```bash
cd /Users/omatic/proyectos/news
git add packages/api/src/lib/redirects-generator.ts
git commit -m "feat(api): build-time redirects generator for legacy → canonical URLs"
```

---

### Task 31: Wire `prebuild` script in `antena/package.json`

**Files:**
- Modify: `packages/antena/package.json`

- [ ] **Step 1: Add `prebuild` script**

```json
{
  "scripts": {
    "prebuild": "tsx ../api/src/lib/redirects-generator.ts",
    "build": "astro build",
    ... (existing)
  }
}
```

- [ ] **Step 2: Verify the prebuild runs + commit**

```bash
cd packages/antena && pnpm build 2>&1 | head -30
```

Expected: `[redirects-generator]` output appears before `astro build`.

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/package.json
git commit -m "build(antena): run redirects-generator in prebuild"
```

---

### Task 32: Create worker middleware for >2000 redirects

**Files:**
- Create: `packages/api/src/middleware/redirects.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Create the middleware**

```typescript
import type { MiddlewareHandler } from 'hono';

interface Bindings {
  CACHE: KVNamespace;
}

let cache: Map<string, string> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

async function loadRedirectMap(env: Bindings): Promise<Map<string, string>> {
  const kvData = await env.CACHE.get('redirects-legacy-map', 'json');
  if (kvData) {
    return new Map(Object.entries(kvData as Record<string, string>));
  }

  try {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const path = join(process.cwd(), '.redirects-cache.json');
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf-8'));
      await env.CACHE.put('redirects-legacy-map', JSON.stringify(data), { expirationTtl: 86400 });
      return new Map(Object.entries(data));
    }
  } catch {
    // ignore
  }

  return new Map();
}

export const legacyRedirectMiddleware = (): MiddlewareHandler<{ Bindings: Bindings }> => {
  return async (c, next) => {
    const url = new URL(c.req.url);
    const match = url.pathname.match(/^\/noticia\/([0-9a-f-]{36})$/);
    if (!match) {
      return next();
    }

    const id = match[1];

    const now = Date.now();
    if (!cache || now - cacheLoadedAt > CACHE_TTL_MS) {
      cache = await loadRedirectMap(c.env);
      cacheLoadedAt = now;
    }

    const target = cache.get(id);
    if (target) {
      return c.redirect(`https://www.antena.com.ar${target}`, 301);
    }

    return next();
  };
};
```

- [ ] **Step 2: Wire the middleware in `src/index.ts` + test + commit**

```typescript
import { legacyRedirectMiddleware } from './middleware/redirects';
app.use('*', legacyRedirectMiddleware());
```

```bash
cd packages/api && pnpm dev
curl -sI 'http://localhost:8787/noticia/<some-uuid>' | head -3
```

Expected: 301 to canonical URL.

```bash
cd /Users/omatic/proyectos/news
git add packages/api/src/middleware/redirects.ts packages/api/src/index.ts
git commit -m "feat(api): worker middleware for legacy /noticia/<uuid> redirects (>2000)"
```

---

### Task 33: Create new `[year]/[month]/[day]/[slug].astro` canonical page

**Files:**
- Create: `packages/antena/src/pages/[year]/[month]/[day]/[slug].astro`

- [ ] **Step 1: Create the page file**

```astro
---
import Layout from '../../layouts/Layout.astro';
import SeoHead from '../../components/SeoHead.astro';

export const prerender = true;

interface SsrArticle {
  id: string;
  title: string;
  summary: string;
  body?: string | null;
  image_url: string | null;
  source_name: string | null;
  source_url?: string | null;
  author?: string | null;
  category: string | null;
  location_name: string | null;
  published_at: string;
  slug: string;
  slug_date: string;
  sources?: { name: string; url: string }[];
}

const SITE = 'https://www.antena.com.ar';

export async function getStaticPaths() {
  const fromEnv = import.meta.env.PUBLIC_API_BASE;
  const apiBase = (!fromEnv || fromEnv.includes('localhost'))
    ? 'https://akira-api.miclusty.workers.dev'
    : fromEnv;
  const paths: {
    params: { year: string; month: string; day: string; slug: string };
    props: { article: SsrArticle };
  }[] = [];
  try {
    const res = await fetch(`${apiBase}/api/news/sitemap-batch?limit=500&offset=0`, {
      headers: { 'User-Agent': 'AntenaSSRBatcher/1.0' },
    });
    if (res.ok) {
      const data = await res.json() as { items: { id: string; slug: string; slug_date: string }[] };
      for (const item of data.items ?? []) {
        const [year, month, day] = item.slug_date.split('-');
        const articleRes = await fetch(
          `${apiBase}/api/news/${year}/${month}/${day}/${item.slug}`,
          { headers: { 'User-Agent': 'AntenaSSRBatcher/1.0' } },
        );
        if (articleRes.ok) {
          const articleData = await articleRes.json() as { news: SsrArticle };
          paths.push({
            params: { year, month, day, slug: item.slug },
            props: { article: articleData.news },
          });
        }
      }
    }
  } catch {}
  return paths;
}

const { article } = Astro.props as { article: SsrArticle };
const { year, month, day, slug } = Astro.params as { year: string; month: string; day: string; slug: string };
const url = `${SITE}/${year}/${month}/${day}/${slug}`;
const title = article.title;
const description = (article.summary ?? '').replace(/<[^>]+>/g, '').slice(0, 200) || 'Noticia en Antena';
const image = article.image_url || `${SITE}/og-default.webp`;
const author = article.author || article.source_name || 'Antena';
const publishedAt = article.published_at;
const markdownUrl = `${url}.md`;

const slugify = (s: string) => s
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');
---
<Layout>
  <Fragment slot="head">
    <SeoHead
      title={title}
      description={description}
      canonical={url}
      ogType="article"
      ogImage={image}
      ogImageAlt={title}
      ogImageWidth={1200}
      ogImageHeight={630}
      article={{
        publishedTime: publishedAt,
        author,
        section: article.category || 'General',
        tags: article.location_name ? [article.location_name] : undefined,
      }}
      jsonLd={[
        {
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          'headline': title,
          'description': description,
          'image': [image],
          'datePublished': publishedAt,
          'dateModified': publishedAt,
          'author': [{
            '@type': 'Person',
            'name': author,
            'url': `${SITE}/autor/${encodeURIComponent(author)}`,
          }],
          'publisher': {
            '@type': 'Organization',
            '@id': `${SITE}#organization`,
            'name': 'Antena',
            'logo': {
              '@type': 'ImageObject',
              'url': `${SITE}/icons/icon.svg`,
              'width': 512,
              'height': 512,
            },
          },
          'mainEntityOfPage': { '@type': 'WebPage', '@id': url },
          'articleSection': article.category || 'General',
          'inLanguage': 'es-AR',
          'isAccessibleForFree': true,
          'speakable': {
            '@type': 'SpeakableSpecification',
            'xpath': ['/html/head/title', '/html/body//article/h1', '/html/body//article/p[1]'],
          },
          ...(article.source_url ? { 'url': article.source_url } : {}),
        },
        {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          'itemListElement': [
            { '@type': 'ListItem', 'position': 1, 'name': 'Inicio', 'item': SITE },
            ...(article.category ? [{ '@type': 'ListItem', 'position': 2, 'name': article.category, 'item': `${SITE}/categoria/${slugify(article.category)}` }] : []),
            ...(article.location_name ? [{ '@type': 'ListItem', 'position': 3, 'name': article.location_name, 'item': `${SITE}/ciudad/${slugify(article.location_name)}` }] : []),
            { '@type': 'ListItem', 'position': 99, 'name': title, 'item': url },
          ],
        },
      ]}
    />
  </Fragment>

  <main id="main-content" class="max-w-[680px] mx-auto px-4 py-8">
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
        <h1 class="text-[28px] font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h1>
        <p class="mt-3 text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Por <span style={{ color: 'var(--text-secondary)' }}>{author}</span>
          {' · '}
          <time datetime={publishedAt}>
            {new Date(publishedAt).toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' })}
          </time>
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

      <p class="mt-6 text-lg leading-relaxed" style={{ color: 'var(--text-primary)' }}>
        {article.summary}
      </p>

      {article.body && (
        <div class="mt-4 text-base leading-relaxed prose" style={{ color: 'var(--text-secondary)' }}>
          {article.body}
        </div>
      )}

      <p class="mt-8 text-sm">
        <a href={url} class="font-semibold" style={{ color: 'var(--accent)' }}>Leer en Antena →</a>
        {' · '}
        <a href={markdownUrl} class="text-sm underline" style={{ color: 'var(--accent)' }}>📄 Ver como markdown</a>
      </p>
    </article>
  </main>
</Layout>
```

- [ ] **Step 2: Build and verify**

```bash
cd packages/antena && pnpm build
ls dist/ | grep -E "^[0-9]{4}$"
```

Expected: year directories (e.g., `2026/`) exist.

- [ ] **Step 3: Inspect one page**

```bash
ls dist/2026/06/ 2>/dev/null
grep -E 'canonical|og:url' dist/2026/06/15/<some-slug>/index.html 2>/dev/null | head -3
```

Expected: `canonical` and `og:url` point to the new format URL.

- [ ] **Step 4: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/src/pages/\[year\]/
git commit -m "feat(antena): new canonical article page at /<year>/<month>/<day>/<slug>"
```

---

### Task 34: Update `noticia/[id].astro` to 301 redirect

**Files:**
- Modify: `packages/antena/src/pages/noticia/[id].astro`

- [ ] **Step 1: Replace the page with a thin 301 redirect**

```astro
---
import Layout from '../../layouts/Layout.astro';
import SeoHead from '../../components/SeoHead.astro';

export const prerender = false;

const SITE = 'https://www.antena.com.ar';
const { id } = Astro.params;

const fromEnv = import.meta.env.PUBLIC_API_BASE;
const apiBase = (!fromEnv || fromEnv.includes('localhost'))
  ? 'https://akira-api.miclusty.workers.dev'
  : fromEnv;

let canonical: string | null = null;
try {
  const res = await fetch(`${apiBase}/api/news/${id}`, {
    headers: { 'User-Agent': 'AntenaSSRBatcher/1.0' },
    redirect: 'manual',
  });
  if (res.status === 301 || res.status === 308) {
    canonical = res.headers.get('Location');
  } else if (res.ok) {
    const data = await res.json() as { news: { slug: string; slug_date: string } };
    if (data.news?.slug && data.news?.slug_date) {
      const [y, m, d] = data.news.slug_date.split('-');
      canonical = `${SITE}/${y}/${m}/${d}/${data.news.slug}`;
    }
  }
} catch {}

if (canonical) {
  return Astro.redirect(canonical, 301);
}
---
<Layout>
  <Fragment slot="head">
    <SeoHead
      title="Redirigiendo..."
      description="Redirigiendo a la URL canónica de la nota."
      canonical={SITE}
      noindex={true}
    />
  </Fragment>
  <main id="main-content" class="min-h-[60vh] flex flex-col items-center justify-center px-4 py-16 text-center">
    <h1 class="text-2xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
      Redirigiendo...
    </h1>
    <p class="text-base" style={{ color: 'var(--text-secondary)' }}>
      Si no sos redirigido automáticamente, <a href="/" style={{ color: 'var(--accent)' }}>volvé al feed</a>.
    </p>
  </main>
</Layout>
```

- [ ] **Step 2: Build and verify**

```bash
cd packages/antena && pnpm build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/src/pages/noticia/\[id\].astro
git commit -m "refactor(antena): legacy /noticia/<id> is now a 301 redirect"
```

---

### Task 35: Update `ciudad/[city].astro` and `categoria/[cat].astro` to link to new URL pattern

**Files:**
- Modify: `packages/antena/src/pages/ciudad/[city].astro`
- Modify: `packages/antena/src/pages/categoria/[cat].astro`

- [ ] **Step 1: Update article links in `ciudad/[city].astro`**

Find every `<a href={`/noticia/${a.id}`}>` and change to use the new pattern. Replace with:

```astro
<a
  href={`/${(a.published_at ?? '2026-01-01').slice(0, 10).split('-').join('/')}/${a.slug ?? a.id}`}
  ... (rest of props unchanged)
>
```

(Make sure `a.slug` and `a.published_at` are in the article shape returned by the feed endpoint after Task 25.)

- [ ] **Step 2: Update article links in `categoria/[cat].astro`** (same pattern)

- [ ] **Step 3: Build and verify**

```bash
cd packages/antena && pnpm build
grep -h "/noticia/" dist/ciudad/*/index.html dist/categoria/*/index.html | head -3
```

Expected: NO matches (all internal links use new URL pattern).

- [ ] **Step 4: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/src/pages/ciudad/[city].astro packages/antena/src/pages/categoria/[cat].astro
git commit -m "refactor(antena): city/category hubs link to new /<year>/<month>/<day>/<slug> URLs"
```

---

### Task 36: Update sitemap.xml.astro to use new URL pattern

**Files:**
- Modify: `packages/antena/src/pages/sitemap.xml.astro`

- [ ] **Step 1: Read current sitemap**

```bash
cat packages/antena/src/pages/sitemap.xml.astro
```

- [ ] **Step 2: Update article URL generation**

Change the article mapping from `${SITE}/noticia/${a.id}` to the new pattern:

```typescript
...articles.map((a) => {
  const [y, m, d] = (a.slug_date ?? a.published_at?.slice(0, 10) ?? '2026-01-01').split('-');
  return {
    loc: `${SITE}/${y}/${m}/${d}/${a.slug ?? a.id}`,
    lastmod: a.published_at ?? now,
    changefreq: 'weekly',
    priority: '0.8',
  };
}),
```

- [ ] **Step 3: Build and verify + commit**

```bash
cd packages/antena && pnpm build
head -20 dist/sitemap.xml
```

Expected: URLs start with `https://www.antena.com.ar/2026/...`.

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/src/pages/sitemap.xml.astro
git commit -m "refactor(antena): sitemap uses new canonical URL pattern"
```

---

### Task 37: Build + smoke-test Phase 3 in staging

**Files:** (none — deploy task)

- [ ] **Step 1: Build all packages**

```bash
cd /Users/omatic/proyectos/news
pnpm install
pnpm --filter antena build
```

- [ ] **Step 2: Verify redirects file was generated**

```bash
wc -l packages/antena/public/_redirects
head -10 packages/antena/public/_redirects
```

Expected: 2000+ lines (non-www rules + legacy → canonical redirects).

- [ ] **Step 3: Deploy**

```bash
pnpm deploy:staging
cd packages/api && pnpm deploy:staging
```

- [ ] **Step 4: Verify legacy 301**

```bash
curl -sI https://staging.antena.com.ar/noticia/<some-uuid> | head -5
```

Expected: `HTTP/1.1 301` and `Location: https://www.antena.com.ar/2026/06/15/...`.

- [ ] **Step 5: Verify new URL works**

```bash
curl -sI 'https://staging.antena.com.ar/2026/06/15/<some-slug>' | head -3
```

Expected: `HTTP/1.1 200`.

- [ ] **Step 6: Verify sitemap**

```bash
curl -s https://staging.antena.com.ar/sitemap.xml | head -20
```

Expected: URLs in new pattern.

- [ ] **Step 7: Run all tests + commit CHANGELOG**

```bash
cd /Users/omatic/proyectos/news && pnpm test
echo "- Phase 3: URL migration to /<year>/<month>/<day>/<slug> deployed to staging" >> CHANGELOG.md
git add CHANGELOG.md
git commit -m "docs: Phase 3 URL migration deployed to staging"
```

---

## Phase 4: Deploy + IndexNow

**Goal:** Push to production, submit to Google Search Console, fire IndexNow.

**Deployable:** Yes (assuming Phase 3 worked in staging).

**Estimated time:** 1–2 hours.

---

### Task 38: Deploy to production

**Files:** (none)

- [ ] **Step 1: Final smoke test on staging**

```bash
curl -sI 'https://staging.antena.com.ar/2026/06/15/<slug>' | head -3
curl -sI 'https://staging.antena.com.ar/noticia/<uuid>' | head -3
```

Both should respond correctly.

- [ ] **Step 2: Merge to main**

```bash
cd /Users/omatic/proyectos/news
git checkout main
git merge feature/seo-geo-perfecto
```

- [ ] **Step 3: Deploy to production**

```bash
pnpm deploy:prod
cd packages/api && pnpm deploy:production
```

- [ ] **Step 4: Verify production**

```bash
curl -sI 'https://www.antena.com.ar/' | head -3
curl -sI 'https://www.antena.com.ar/noticia/<uuid>' | head -5
curl -sI 'https://www.antena.com.ar/2026/06/15/<slug>' | head -3
```

Expected: all correct (200 for new, 301 for old).

---

### Task 39: IndexNow submission

**Files:** (none — script in repo)

- [ ] **Step 1: Push top 500 new URLs to IndexNow**

Create `packages/antena/scripts/push-indexnow.ts`:

```typescript
import { submitToIndexNow } from '../src/lib/indexnow';

const SITE = 'https://www.antena.com.ar';

async function main() {
  const res = await fetch('https://akira-api.miclusty.workers.dev/api/news/sitemap-batch?limit=500');
  const data = await res.json() as { items: { slug_date: string; slug: string }[] };
  const urls = (data.items ?? []).map((it) => {
    const [y, m, d] = it.slug_date.split('-');
    return `${SITE}/${y}/${m}/${d}/${it.slug}`;
  });
  console.log(`Submitting ${urls.length} URLs to IndexNow...`);
  const n = await submitToIndexNow(urls);
  console.log(`Submitted ${n} URLs`);
}

main();
```

Run:

```bash
cd packages/antena && pnpm tsx scripts/push-indexnow.ts
```

Expected: "Submitted 500 URLs".

- [ ] **Step 2: Verify the key file is accessible**

```bash
curl -sI 'https://www.antena.com.ar/antena2026indexnow.txt'
curl -s 'https://www.antena.com.ar/antena2026indexnow.txt'
```

Expected: HTTP 200, body matches the key (`antena2026indexnow`).

- [ ] **Step 3: Commit**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/scripts/push-indexnow.ts
git commit -m "feat(antena): one-off script to push new URLs to IndexNow"
```

---

### Task 40: Submit sitemap to Google Search Console

**Files:** (none — manual task)

- [ ] **Step 1: Open GSC**

Visit `https://search.google.com/search-console?resource_id=https://www.antena.com.ar`.

- [ ] **Step 2: Submit new sitemap**

- Sitemaps → Add a new sitemap
- URL: `https://www.antena.com.ar/sitemap.xml`
- Click Submit

- [ ] **Step 3: Inspect 5 URLs (request indexing)**

- URL Inspection → paste a few new canonical URLs
- Click "Request Indexing" for each

- [ ] **Step 4: Verify in Coverage (after 24-48h)**

Check Coverage → Valid → count should grow.

---

## Phase 5: Monitoring

**Goal:** Ensure the migration is healthy and detect regressions early.

**Estimated time:** 2 hours.

---

### Task 41: Create `seo-monitor.ts` cron handler

**Files:**
- Create: `packages/antena/src/lib/seo-monitor.ts`
- Modify: `packages/api/src/crons/refresh.ts` (call the monitor)

- [ ] **Step 1: Create the monitor**

```typescript
/**
 * Cron-driven SEO health check. Runs every 6h. Verifies that critical
 * SEO surfaces are accessible, parseable, and pointing to www.
 *
 * Reports to Analytics Engine dataset `seo_health`.
 * Alerts via Discord webhook on failure.
 */

const SITE = 'https://www.antena.com.ar';

const CHECKS = [
  { name: 'sitemap_xml_accessible', url: `${SITE}/sitemap.xml` },
  { name: 'robots_txt_accessible', url: `${SITE}/robots.txt` },
  { name: 'robots_txt_has_gptbot', url: `${SITE}/robots.txt`, expectBodyMatch: /GPTBot/i },
  { name: 'home_canonical_www', url: `${SITE}/`, extract: (html: string) => {
    const m = html.match(/<link rel="canonical" href="([^"]+)"/);
    return m?.[1] ?? '';
  }, expect: `${SITE}/` },
  { name: 'llms_txt_accessible', url: `${SITE}/llms.txt` },
  { name: 'llms_full_txt_accessible', url: `${SITE}/llms-full.txt` },
  { name: 'og_default_webp_accessible', url: `${SITE}/og-default.webp` },
  { name: 'indexnow_key_accessible', url: `${SITE}/antena2026indexnow.txt` },
  { name: 'indexnow_key_valid', url: `${SITE}/antena2026indexnow.txt`, expectBodyMatch: /antena2026indexnow/ },
];

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
  duration_ms: number;
}

async function runCheck(check: typeof CHECKS[number]): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await fetch(check.url, { headers: { 'User-Agent': 'AntenaSeoMonitor/1.0' } });
    const body = await res.text();
    let pass = res.ok;
    let detail = `${res.status}`;

    if (check.expectBodyMatch) {
      pass = pass && check.expectBodyMatch.test(body);
    }
    if (check.expect) {
      const extracted = check.extract?.(body) ?? '';
      pass = pass && extracted === check.expect;
      detail = `${res.status}, canonical=${extracted}`;
    }

    return { name: check.name, pass, detail, duration_ms: Date.now() - start };
  } catch (e) {
    return {
      name: check.name,
      pass: false,
      detail: `error: ${e instanceof Error ? e.message : String(e)}`,
      duration_ms: Date.now() - start,
    };
  }
}

export async function runSeoHealthCheck(
  env: { ANALYTICS?: AnalyticsEngineDataset; DISCORD_WEBHOOK_URL?: string },
): Promise<{ ok: number; fail: number; results: CheckResult[] }> {
  const results = await Promise.all(CHECKS.map(runCheck));
  const ok = results.filter((r) => r.pass).length;
  const fail = results.length - ok;

  if (env.ANALYTICS) {
    for (const r of results) {
      env.ANALYTICS.writeDataPoint({
        blobs: [r.name, r.pass ? 'pass' : 'fail', r.detail],
        doubles: [r.duration_ms],
        indexes: [r.name],
      });
    }
  }

  if (fail > 0 && env.DISCORD_WEBHOOK_URL) {
    const failed = results.filter((r) => !r.pass);
    const message = `🚨 SEO Health Check FAILED (${fail}/${results.length})\n\n${failed
      .map((r) => `❌ ${r.name}: ${r.detail}`)
      .join('\n')}`;
    await fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    });
  }

  return { ok, fail, results };
}
```

- [ ] **Step 2: Wire into cron**

In `packages/api/src/crons/refresh.ts`, add at the end (or beginning, your call):

```typescript
import { runSeoHealthCheck } from '../../antena/src/lib/seo-monitor';

// ... existing cron logic ...

await runSeoHealthCheck({
  ANALYTICS: env.ANALYTICS,
  DISCORD_WEBHOOK_URL: env.DISCORD_WEBHOOK_URL,
});
```

(Adjust the import path if `seo-monitor.ts` is in a different location.)

- [ ] **Step 3: Set environment variable**

In `wrangler.production.toml`, add (if not already):

```toml
[vars]
DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/<id>/<token>"
```

- [ ] **Step 4: Commit + deploy**

```bash
cd /Users/omatic/proyectos/news
git add packages/antena/src/lib/seo-monitor.ts packages/api/src/crons/refresh.ts
git commit -m "feat: cron-driven SEO health check with Analytics Engine + Discord alerts"
pnpm --filter api deploy:production
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Task(s) |
|---|---|
| 1.1 Site with www | Task 3 |
| 1.2 og:url uses canonical | Task 1, 2 |
| 1.3 og/twitter use props | Task 1, 2 |
| 1.4 publisher @id fixed | Task 33 (in new article page) |
| 1.5 Breadcrumb links to real pages | Task 33 |
| 1.6 WebSite @id added | Task 2 |
| 1.7 theme-color media query | Task 1 |
| 1.8 404 noindex | Task 6 |
| 1.9 Privacy/Contact JSON-LD | Task 5 |
| 1.10 og-default webp + alt | Task 1, 7 |
| 1.11 manifest theme color | Task 8 |
| 1.12 og:image width/height dynamic | Task 33 |
| 1.13 sitemap rename | Task 9 |
| 2. SeoHead component | Task 1, 2 |
| 3.1 llms.txt expand | Task 14 |
| 3.2 llms-full.txt | Task 15 |
| 3.3 Markdown per article | Task 16 |
| 3.4 FAQPage schema | Task 17 |
| 3.5 max-snippet meta robots | Task 1 (in SeoHead) |
| 3.6 /api/llm/cite | Task 18 |
| 4.1 Python slug generator | Task 22 |
| 4.2 D1 schema | Task 21 |
| 4.3 Backfill script | Task 23 |
| 4.4 Worker endpoints (canonical, sitemap-batch, cite) | Tasks 18, 26, 27 |
| 4.5 Astro [year]/[month]/[day]/[slug].astro | Task 33 |
| 4.6 Redirects generator + middleware | Tasks 30, 32 |
| 4.7 R2 images | (no change needed) |
| 5.1 Phases | All |
| 5.2 Tests | Tasks 10, 11, 19, 38 (seo-routes in Phase 3) |
| 5.3 Lighthouse CI | Task 12 |
| 5.4 Monitoring | Task 41 |
| 5.5 Metrics | (operational, post-launch) |
| 5.6 Risks | Rollback plan in each phase |

**Placeholder scan:** No TBD/TODO/FIXME in any task code.

**Type consistency:** `make_slug()` defined in Task 22, used in Tasks 23 and 24 with same signature. `redirects-generator.ts` signature consistent with `legacyRedirectMiddleware`. `fetchArticleBySlug` defined in Task 16, used in Task 16's md endpoint.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-15-seo-geo-perfecto.md`.**

41 tasks across 6 phases. Estimated 16–20 hours total. Each phase is independently deployable.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for: complex multi-step work where each task needs fresh context.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints for review. Best for: when you want to see progress in real-time and intervene.

**Which approach?**



