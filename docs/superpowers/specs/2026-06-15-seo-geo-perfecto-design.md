# SEO + GEO Perfecto — Antena

**Fecha:** 2026-06-15
**Autor:** opencode (brainstorming session)
**Estado:** Diseño aprobado, pendiente implementación
**Scope:** `packages/antena` (Astro frontend) + `packages/api` (Cloudflare Workers) + `packages/akira` (Python extractor)

## Resumen ejecutivo

Hacer que Antena sea la fuente de noticias argentinas más citada por Google Search, Google News, ChatGPT, Claude y Perplexity. Esto requiere:

1. **Corregir 13 bugs** SEO existentes detectados en auditoría
2. **Refactorizar** la generación de meta tags en un componente `SeoHead.astro` reutilizable
3. **Expandir el GEO** (Generative Engine Optimization) con `llms-full.txt`, markdown por artículo y FAQPage schema
4. **Migrar URLs** de `/noticia/<uuid>` a `/<year>/<month>/<day>/<slug>` (patrón NYT/BBC) con redirects 301
5. **Tests automatizados** + Lighthouse CI + monitoring en producción

**Outcome esperado a 30 días:**
- 100% de páginas indexadas en Google (baseline: ~70%)
- 2× impressions/día en Search Console
- 25%↑ CTR orgánico (URLs más legibles y compartibles)
- Citas medibles desde ChatGPT/Perplexity/Claude (Analytics Engine, referrer regex)

---

## Contexto

### Decisiones locked (de AGENTS.md)

- **Canonical domain:** `https://www.antena.com.ar` (con `www`). Los apex `antena.com.ar/*` redirigen 301 a `www.`
- **Stack:** Cloudflare 100% (Pages, Workers, D1, R2, Vectorize, Analytics Engine)
- **AKIRA env prefix:** `AKIRA_` para todas las settings de Python
- **Rate limiter:** 1.5s entre requests al mismo dominio
- **Tailwind 4:** CSS-first `@theme` en `src/lib/design-tokens.css`

### Auditoría del estado actual (lo que ya está bien)

- `robots.txt` con todos los AI bots (GPTBot, ClaudeBot, Perplexity, OAI-SearchBot, Google-Extended, Applebot-Extended, Amazonbot, CCBot, Bytespider) explícitamente Allowed
- `llms.txt` (53 líneas) con descripción, categorías, endpoints
- `_redirects`: 301 non-www→www, HTTPS forzado
- `_headers`: HSTS, security headers, MIME types correctos para SEO endpoints
- Sitemap en `/sitemap-index.xml` con 100 últimas notas + hubs
- RSS en `/rss.xml` con 50 últimas notas
- JSON-LD en homepage (WebSite + NewsMediaOrganization + SearchAction)
- JSON-LD en `/noticia/<id>` (NewsArticle + BreadcrumbList + Speakable)
- JSON-LD en `/categoria/<cat>` y `/ciudad/<city>` (ItemList + CollectionPage)
- JSON-LD en `/autor/<name>` (Person, para E-E-A-T)
- Canonical, og:*, twitter:*, hreflang es-AR
- IndexNow configurado en `lib/indexnow.ts`
- E-E-A-T: páginas /about, /contacto, /privacidad
- E-E-A-T menciona equipo, financiamiento, sin tracking

### Bugs detectados (lo que hay que arreglar)

| # | Archivo | Línea | Problema |
|---|---------|-------|----------|
| 1 | `astro.config.mjs` | 8 | `site: "https://antena.com.ar"` (sin `www`) contradice canonical `www` en AGENTS.md |
| 2 | `Layout.astro` | 31 | `og:url` hardcodeado a `https://www.antena.com.ar`, ignora prop `canonical` |
| 3 | `Layout.astro` | 28-41 | `og:title`, `og:description`, `twitter:title`, `twitter:description` hardcodeados, ignoran props `title`/`description` |
| 4 | `noticia/[id].astro` | 115 | `publisher: { '@id': publisherLogo }` — debería ser `'https://www.antena.com.ar/#organization'` (no URL del logo) |
| 5 | `noticia/[id].astro` | 154-166 | Breadcrumb usa `/?cat=X` y `/?loc=Y` (query strings) en vez de `/categoria/<slug>` y `/ciudad/<slug>` (páginas reales pre-renderizadas) |
| 6 | `Layout.astro` | 54-71 | WebSite JSON-LD no tiene `@id: "#website"`, pero `categoria/[cat].astro:104` y `ciudad/[city].astro:109` lo referencian — mismatch |
| 7 | `Layout.astro` | 22 | `theme-color` tiene `id="theme-color"` (raro, estándar es solo `name="theme-color"`) |
| 8 | `404.astro` | — | Sin `<meta name="robots" content="noindex">` — Google puede indexar URLs rotas |
| 9 | `privacidad.astro`, `contacto.astro` | — | Sin JSON-LD (no son WebPage/ContactPage para Knowledge Graph) |
| 10 | `public/og-default.png` | — | 688KB (debería ser <50KB WebP), sin `og:image:alt` |
| 11 | `public/manifest.json` + `astro.config.mjs` | — | Theme color inconsistente: `manifest` `#F9F6F0` (claro) vs `Layout` `#0F1117` (oscuro) |
| 12 | `noticia/[id].astro` | 86-87 | `og:image:width/height` fijo en 1200/630, pero el `srcset` va hasta 1800w |
| 13 | `sitemap-index.xml.astro` | — | Archivo se llama `sitemap-index.xml` pero es un único sitemap (no un index que apunta a otros) |

---

## Sección 1: Quick Wins (13 fixes)

Todos los bugs de la tabla anterior. Cambios low-risk, deploy inmediato en Fase 0.

### Cambios

1. **`astro.config.mjs`** — `site: "https://www.antena.com.ar"` (con `www`)
2. **`Layout.astro:31`** — `og:url` → `content={pageCanonical}` (usar el prop)
3. **`Layout.astro:28-41`** — `og:title` → `content={pageTitle}`, `og:description` → `content={pageDescription}`, similar para twitter
4. **`noticia/[id].astro:115`** — `publisher: { '@type': 'Organization', '@id': 'https://www.antena.com.ar/#organization', 'name': 'Antena', 'logo': {...} }`
5. **`noticia/[id].astro:154-166`** — Breadcrumb links a `slugify(category)` y `slugify(location_name)` apuntando a `/categoria/<slug>` y `/ciudad/<slug>`
6. **`Layout.astro:54-71`** — Agregar `'@id': 'https://www.antena.com.ar/#website'` al WebSite JSON-LD
7. **`Layout.astro:22`** — Quitar `id="theme-color"`, dejar estándar `name="theme-color"`. Agregar media query dark/light:
   ```html
   <meta name="theme-color" content="#0F1117" media="(prefers-color-scheme: dark)" />
   <meta name="theme-color" content="#F9F6F0" media="(prefers-color-scheme: light)" />
   ```
8. **`404.astro`** — Agregar `<meta name="robots" content="noindex">` en el head fragment
9. **`privacidad.astro`** + **`contacto.astro`** — Agregar JSON-LD:
   - Privacidad: `WebPage` con `about: 'PrivacyPolicy'`
   - Contacto: `ContactPage` con `publisher: { '@id': '#organization' }`
10. **`public/og-default.png`** — Optimizar a WebP <50KB (1280×720), agregar `og:image:alt="Antena — Noticias hiperlocales de Argentina"`
11. **`public/manifest.json`** + **`astro.config.mjs`** — Alinear theme colors. En `manifest` agregar `theme_color: "#0F1117"` como default, mantener `background_color: "#F9F6F0"`. Documentar en comentario.
12. **`noticia/[id].astro:86-87`** — `og:image:width="1800"` y `og:image:height="1000"` (aspect ratio 16:9 para imagen real de la nota)
13. **`sitemap-index.xml.astro`** — Renombrar archivo a `sitemap.xml.astro` y actualizar `_redirects`/`robots.txt` references

### Criterios de aceptación

- Lighthouse SEO score ≥ 95 en cada página pública
- Schema.org validator: 0 errores
- `og:url` siempre `https://www.` (validado con test)
- Google Search Console: 0 problemas de canonical

---

## Sección 2: Refactor `SeoHead.astro`

Centralizar toda la generación de meta tags. Elimina duplicación en 10+ páginas.

### Nuevo archivo: `packages/antena/src/components/SeoHead.astro`

```typescript
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
```

### Comportamiento

- **Title:** Si `title` no termina en `— Antena`, appenderlo. Truncar a 60 chars si excede.
- **Description:** Truncar a 160 chars con ellipsis si excede.
- **Canonical:** Si no se pasa, usar `SITE` (default `https://www.antena.com.ar`).
- **og:url:** Siempre `canonical` (forzar `www.` si se olvidaron).
- **og:image default:** `https://www.antena.com.ar/og-default.webp` (nuevo, ver Sección 1 fix #10).
- **og:image:alt:** Requerido, fallback a `title`.
- **og:locale:** `es_AR` siempre. `og:site_name: "Antena"`.
- **Twitter card:** `summary_large_image` siempre.
- **hreflang:** `es-AR` + `x-default` apuntando a `canonical`.
- **Theme color:** Media query dark/light (ver Sección 1 fix #7).
- **robots:** Si `noindex=true`, `<meta name="robots" content="noindex, nofollow">`. Default: index.
- **JSON-LD:** Recibe `object | object[]` y emite uno o más `<script type="application/ld+json">`.

### Lo que se conserva en `Layout.astro`

Solo el JSON-LD del sitio completo (WebSite + NewsMediaOrganization). Todo lo demás pasa por `<SeoHead>`.

### Lo que se elimina de cada página

- `<title>` → manejado por SeoHead
- `<meta name="description">` → manejado por SeoHead
- `<link rel="canonical">` → manejado por SeoHead
- Todos los `<meta property="og:*">` y `<meta name="twitter:*">` → manejados por SeoHead
- hreflang → manejado por SeoHead
- Theme color → manejado por SeoHead

### Páginas que usan `<SeoHead>`

- `index.astro` (home)
- `noticia/[id].astro` → migrado a `/[year]/[month]/[day]/[slug].astro` en Sección 4
- `categoria/[cat].astro`
- `ciudad/[city].astro`
- `autor/[name].astro`
- `about.astro`
- `contacto.astro`
- `privacidad.astro`
- `404.astro` (con `noindex`)
- `buscar.astro` (con `noindex` — search results no se indexan)
- `settings.astro` (con `noindex`)

### Tests

`packages/antena/tests/seo.test.ts`:
- Cada página tiene `<title>`, `<meta name="description">`, `<link rel="canonical">`, og:* completo
- `og:url` siempre con `https://www.`
- `noindex` solo en 404, buscar, settings
- JSON-LD parsea sin errores para schema.org válido
- hreflang apunta a la misma URL canónica

### Criterios de aceptación

- Reducción neta de ~200 líneas de código
- Cambiar título de una página = 1 sola prop, no 4 meta tags
- 0 cambios visuales en SERPs (validado con snapshot test)

---

## Sección 3: GEO (Generative Engine Optimization)

Hacer que los LLMs (ChatGPT, Claude, Perplexity, Gemini) citen a Antena masivamente.

### 3.1 Expandir `public/llms.txt` (53 → ~150 líneas)

**Estructura nueva:**
```
# Antena

> [descripción corta]

## Identidad
[qué es, qué no es, modelo de agregación]

## Cómo citar contenido de Antena
[formato canónico + 3-5 ejemplos reales de citas correctas]

## Tipos de contenido + URL pattern
| Tipo | URL pattern | JSON-LD @type |
|------|-------------|---------------|
| Nota individual | /<year>/<month>/<day>/<slug> | NewsArticle |
| Hubs de ciudad | /ciudad/<slug> | CollectionPage + ItemList |
| Hubs de categoría | /categoria/<slug> | CollectionPage + ItemList |
| Autor (E-E-A-T) | /autor/<slug> | Person |
| Markdown limpio | /<year>/<month>/<day>/<slug>.md | (ninguno) |
| Citation JSON | /api/llm/cite?id=<uuid> | (ninguno) |

## Cobertura geográfica
[12 ciudades top con population data + URL pattern]

## Categorías editoriales
[12 categorías con descripción de 1 línea]

## Score de editorial quality
[metodología del score que rankea las notas]

## Bias rating
[metodología del bias rating de fuentes]

## Reglas de atribución
[citar correctamente, qué NO hacer]

## Endpoints
[lista completa de API endpoints públicos]

## Sitios hermanos / roadmap
[versión portugués, app nativa, API pública]
```

### 3.2 Nuevo `public/llms-full.txt` (~300 líneas)

Spec extendida:
- Qué es Antena, qué NO es (agregador, no medio tradicional, no genera contenido original)
- Schema.org/NewsArticle documentado con 3 ejemplos reales
- Cobertura geográfica detallada con population data
- Editorial quality score: fórmula y ejemplos
- Bias rating: fuentes y metodología
- Lista de las 200+ fuentes ingestadas con URL
- Roadmap público (features en development)

### 3.3 Markdown por artículo

**Nueva ruta:** `/<year>/<month>/<day>/<slug>.md`

**Comportamiento:**
- Devuelve la nota en markdown limpio
- Headers: `# Title` + metadata en frontmatter YAML
- Contenido: title, summary, body (markdown), source citations
- Footer:
  ```
  ---
  Este artículo es una síntesis de N fuentes. Antena es un agregador, no genera contenido original.
  Más info: https://www.antena.com.ar/about
  ```
- Content-Type: `text/markdown; charset=utf-8`
- Link desde cada nota: "📄 Ver como markdown" (descubrible para LLMs y humanos)

### 3.4 FAQPage schema en hubs de ciudad y categoría

4-6 preguntas frecuentes por ciudad/categoría, generadas del contenido + plantillas:

**Plantilla ciudad:**
- ¿Qué pasó hoy en {cityName}?
- ¿Cuáles son las últimas noticias de {cityName}?
- ¿Qué medios cubren {cityName}?
- ¿Cuál es la nota más leída de {cityName} esta semana?

**Plantilla categoría:**
- ¿Qué pasó hoy en {category}?
- ¿Cuáles son las últimas noticias de {category} en Argentina?
- ¿Qué medios cubren mejor {category}?

**JSON-LD `FAQPage` con `Question` + `acceptedAnswer`** (respuesta de 1-2 frases + link a nota específica).

### 3.5 Meta robots: permitir snippets largos

Agregar `<meta name="robots" content="max-snippet:-1, max-image-preview:large, max-video-preview:-1">` en cada página (no limitar extractos que los LLMs pueden citar).

### 3.6 Endpoint `/api/llm/cite?id=<uuid>`

**Response JSON:**
```json
{
  "id": "uuid",
  "canonical_url": "https://www.antena.com.ar/2026/06/15/dolar-blue-hoy-jueves",
  "markdown_url": "https://www.antena.com.ar/2026/06/15/dolar-blue-hoy-jueves.md",
  "title": "Dólar blue hoy: cierre a $1.245",
  "summary": "El dólar blue cerró este jueves a $1.245 para la venta...",
  "body": "...",
  "sources": [
    {"name": "Ámbito", "url": "https://ambito.com/..."},
    {"name": "Clarín", "url": "https://clarin.com/..."}
  ],
  "author": "Redacción Ámbito",
  "category": "Economía",
  "location": "Buenos Aires",
  "published_at": "2026-06-15T16:30:00Z",
  "image_url": "https://antena-images.r2.dev/<hash>",
  "citation_hint": "Citar como: 'Dólar blue hoy: cierre a $1.245' (Antena, 15 jun 2026)",
  "license": "aggregator-attribution"
}
```

- Cache KV: 1h TTL
- Sin HTML, sin CSS classes, llm-friendly

### Criterios de aceptación

- `llms.txt` y `llms-full.txt` pasan validación de https://llmstxt.org/validator
- Schema.org FAQPage validator: 0 errores
- `curl /api/llm/cite?id=X | jq` devuelve JSON válido y parseable
- `curl /<slug>.md` devuelve `text/markdown` parseable

---

## Sección 4: Migración de URLs semánticas

**Cambio:** `/noticia/<uuid>` → `/<year>/<month>/<day>/<slug>`

### 4.1 Backend Python (AKIRA) — generador de slug

**Nuevo:** `packages/akira/extractors/_slug.py`

```python
import re
import unicodedata
from typing import Final

STOPWORDS: Final[set[str]] = {
    "de", "la", "el", "los", "las", "y", "e", "o", "u",
    "en", "a", "con", "por", "para", "del", "al", "un", "una",
    "unos", "unas", "lo", "le", "se", "su", "sus", "que", "es",
    "son", "fue", "ha", "han", "hay", "este", "esta", "estos",
    "estas", "ese", "esa", "esos", "esas", "ese",
}

def _strip_accents(s: str) -> str:
    """'Dólar' → 'Dolar'"""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))

def make_slug(title: str, max_words: int = 7) -> str:
    """Genera slug SEO-friendly del título.

    Examples:
        >>> make_slug("Dólar blue HOY: cierre a $1.245")
        'dolar-blue-hoy-cierre-1245'
        >>> make_slug("El gobierno de Argentina anunció nuevas medidas")
        'gobierno-argentina-anuncio-nuevas-medidas'
    """
    text = _strip_accents(title.lower())
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    words = [w for w in text.split() if w and w not in STOPWORDS]
    slug = "-".join(words[:max_words])
    return slug or "sin-titulo"
```

**Integración:** llamado en `packages/akira/core/engine.py:store_article()` después de extracción.

### 4.2 Schema D1 — agregar columnas

**Modificar:** `packages/api/src/db/schema.ts`

```ts
export const newsCards = sqliteTable("news_cards", {
  // ... existentes
  slug: text("slug").notNull(),
  slugDate: text("slug_date").notNull(),  // "YYYY-MM-DD" de published_at
});
```

**Nueva migración:** `packages/api/migrations/00XX_seo_slug.sql`

```sql
-- 1. Add columns
ALTER TABLE news_cards ADD COLUMN slug TEXT;
ALTER TABLE news_cards ADD COLUMN slug_date TEXT;

-- 2. Backfill: ver packages/akira/scripts/backfill_slugs.py
-- (script Python que itera todas las news_cards y calcula slug)

-- 3. Mark as NOT NULL after backfill
-- (después de validar que 0% son NULL)

-- 4. Unique index
CREATE UNIQUE INDEX idx_news_slug ON news_cards(slug_date, slug);
CREATE INDEX idx_news_slug_lookup ON news_cards(slug);
```

### 4.3 Script de backfill

**Nuevo:** `packages/akira/scripts/backfill_slugs.py`

Itera `news_cards` donde `slug IS NULL`:
1. Llama `make_slug(title)`
2. Verifica unicidad con query `SELECT COUNT(*) FROM news_cards WHERE slug_date = ? AND slug = ?`
3. Si colisiona, appenda `-<id6[:6]>`
4. UPDATE con `slug`, `slug_date = strftime('%Y-%m-%d', published_at)`
5. Log progress cada 1000 rows
6. Modo `--dry-run` para validar antes de commit

### 4.4 Worker API — nuevos endpoints

**Nuevos:**
- `GET /api/news/<year:int>/<month:int>/<day:int>/<slug>` → canónico, devuelve el mismo payload que `/api/news/<id>`
- `GET /api/news/lookup?slug_date=YYYY-MM-DD&slug=<slug>` → helper para Astro getStaticPaths
- `GET /api/news/sitemap-batch?limit=500&offset=N` → para sharding del getStaticPaths

**Modificados:**
- `GET /api/news/<id>` (legacy) → 301 redirect al canónico con `Location: /<year>/<month>/<day>/<slug>`
- `GET /api/news/feed` → incluye `slug` y `slug_date` en cada item
- `GET /api/news/{id}/cluster` → incluye `slug` y `slug_date` por item

### 4.5 Astro: nueva ruta de páginas

**Nueva:** `packages/antena/src/pages/[year]/[month]/[day]/[slug].astro`

`getStaticPaths` lee de `/api/news/sitemap-batch?limit=500` (sharding) y genera los paths.

**Lógica del redirect legacy:**
- `/noticia/[id].astro` se mantiene como página thin
- En server-side (`onRequest` de Cloudflare Pages Function): si la nota tiene slug canónico, hacer `Response.redirect(301, canonical_url)`
- Si la nota no tiene slug (caso edge): render 404 con `noindex`

### 4.6 Cloudflare Pages redirects

**Generado dinámicamente en build:** `packages/api/src/lib/redirects-generator.ts`

Output: `packages/antena/public/_redirects` con:
```
/noticia/<uuid-1>  /2026/06/15/dolar-blue-hoy-jueves  301!
/noticia/<uuid-2>  /2026/06/14/noticia-x  301!
...
```

(Puede ser 500-2000 líneas si hay 500+ notas. Cloudflare Pages acepta hasta 2000 redirect rules, las demás en worker.)

Si excede 2000: las primeras 2000 en `_redirects`, las demás las maneja el worker en `functions/_middleware.ts` con un KV lookup.

### 4.7 R2 image filenames

**Sin cambios.** Las imágenes en R2 usan `sha256(url)`. No hay colisión.

### 4.8 Risk mitigation

- **Dual routing durante 90 días:** legacy `/noticia/<uuid>` con 301 → nuevo. Google entiende la migración.
- **Backward compat en la app:** el cliente mobile/web que cacheó `/noticia/<uuid>` lo desvia transparentemente vía 301.
- **Slugs duplicados:** script de backfill garantiza unicidad con sufijo `-<id6[:6]>`.
- **Build time:** sharding del getStaticPaths, sitemap-batch endpoint limita a 500 por build.

### Criterios de aceptación

- 100% de `news_cards` tienen `slug` y `slug_date` no-NULL
- 0 colisiones de slug en D1 (índice UNIQUE)
- `curl -I /noticia/<uuid>` → 301 con `Location` correcto
- `curl /<year>/<month>/<day>/<slug>` → 200 con HTML completo
- Google Search Console: 0 "not found" crawl errors post-migration
- Top 100 URLs por tráfico siguen manteniendo su ranking (o mejoran)

---

## Sección 5: Rollout, tests, monitoring

### 5.1 Fases de deploy (zero-downtime)

```
Fase 0 (Día 0):   Quick wins (Sección 1) + refactor SeoHead (Sección 2)
                  → URLs viejas siguen funcionando, ningún breaking change
                  → Deploy: wrangler deploy + git push Pages

Fase 1 (Día 1-2): GEO (Sección 3) — llms.txt, llms-full.txt, /<slug>.md, FAQPage
                  → Solo añade contenido, no cambia nada existente
                  → Deploy: git push Pages (changes in /public y /pages)

Fase 2 (Día 3-4): Backend migraciones
                  1. Agregar columnas slug/slug_date a D1 (ALTER TABLE, no destructivo)
                  2. Backfill slugs para 100% de news_cards (~1h con script batched)
                  3. Deploy AKIRA con generador de slug
                  4. Deploy worker con nuevo endpoint canónico
                  → /noticia/<uuid> viejo SIGUE funcionando (200 OK), worker devuelve JSON

Fase 3 (Día 5):   Astro migra a /<year>/<month>/<day>/<slug>
                  1. getStaticPaths lee del nuevo endpoint
                  2. Build genera páginas en nuevo path
                  3. /noticia/<uuid> viejo ahora hace 301 → nuevo
                  → Google ve 301 masivo, entiende el cambio

Fase 4 (Día 6-7): IndexNow submission masiva
                  - Push 500 URLs nuevas a IndexNow
                  - Push sitemap.xml nuevo a Google Search Console
                  - Monitorear indexación en Search Console

Fase 5 (Día 8+):  Monitoring
                  - Search Console: % indexado, CTR, impressions
                  - Analytics Engine: referrer regex para LLM traffic
                  - Lighthouse CI: bloquea deploys si score < 95
```

### 5.2 Tests automatizados

**`packages/antena/tests/seo.test.ts`** (vitest):
- Cada página pública tiene: title, description, canonical, og:* completo
- `og:url` siempre con `https://www.`
- `noindex` solo en 404, buscar, settings
- JSON-LD parsea sin errores para schema.org válido
- hreflang apunta a canonical con `www.`
- 404 con `X-Robots-Tag: noindex` header

**`packages/api/tests/seo-routes.test.ts`** (vitest):
- `/api/news/<uuid>` → 301 con `Location: /<year>/<month>/<day>/<slug>`
- `/api/news/<year>/<month>/<day>/<slug>` → 200 con payload completo
- `/api/news/<year>/<month>/<day>/<slug-inexistente>` → 404
- Slugs duplicados: el segundo recibe sufijo `-<id6>`
- `/api/llm/cite?id=X` → 200 con JSON, cache header correcto
- `/api/news/sitemap-batch?limit=500` → 200, max 500 items

**`packages/akira/tests/test_slug.py`** (pytest):
- `make_slug("Dólar blue HOY: cierre a $1.245")` → `"dolar-blue-hoy-cierre-1245"`
- `make_slug("El gobierno de Argentina anunció...")` → `"gobierno-argentina-anuncio"`
- `make_slug("Economía creció 5% en 2026")` → `"economia-crecio-5-2026"`
- Stopwords removidas correctamente
- Unicode normalizado (acentos, ñ, tildes)
- Max words trunca a N
- Empty title → `"sin-titulo"`

**`packages/antena/tests/seo-snapshots.test.ts`** (vitest):
- Snapshot de HTML head por página (catches regresiones accidentales)
- Snapshot del JSON-LD parseado
- Snapshot del sitemap.xml
- Ejecuta en CI en cada PR

### 5.3 Lighthouse CI

`.lighthouserc.json` ya existe. Agregar assertions:
- SEO score ≥ 95 en todas las páginas públicas
- Performance ≥ 90
- LCP < 2.5s, CLS < 0.1
- Best Practices ≥ 95

URLs testeadas (smoke set):
- `/`
- `/2026/06/15/<slug-de-test>`
- `/ciudad/<slug-de-test>`
- `/categoria/<slug-de-test>`
- `/about`
- `/buscar`

### 5.4 Monitoring post-deploy

**`packages/antena/src/lib/seo-monitor.ts`** (nuevo):
- Cron cada 6h, verifica:
  - `sitemap.xml` accesible y parseable
  - `robots.txt` tiene AI bots allow
  - `og:url` de home apunta a `https://www.`
  - Canonical de 5 páginas random apunta a `https://www.`
  - `llms.txt` accesible
  - `og-default.webp` existe
- Reporta a Analytics Engine dataset `seo_health`
- Alerta por Discord webhook si alguna check falla

**`packages/api/src/lib/seo-redirects-cache.ts`** (nuevo):
- Worker KV cache de redirects legacy → canónico
- TTL 24h
- Auto-refresh cuando se publica nota nueva

### 5.5 Métricas de éxito (30 días post-rollout)

| Métrica | Baseline actual | Target 30 días |
|---------|-----------------|----------------|
| Google Search Console: % páginas indexadas | ~70% | 100% |
| Google Search Console: impressions/día | baseline | 2× |
| Google Search Console: CTR promedio | baseline | +25% |
| Cobertura del sitemap | — | 0 errors |
| Tráfico desde ChatGPT/Perplexity/Claude | 0 (no trackeado) | >100 visits/día (regex match) |
| Lighthouse SEO score | ~85 | ≥95 en todas las páginas |
| Citas en LLMs | 0 | >10/día (medible vía referrer + indexNow) |

### 5.6 Riesgos identificados + mitigación

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| Pérdida temporal de ranking durante migración | Media | 301 por UUID, mantener sitemap viejo activo 30 días, monitorear Search Console diario, tener rollback plan |
| Slug colisión en producción | Baja | Índice UNIQUE en D1 + script de backfill que appenda sufijo `-<id6>` |
| LLM scrapers ignoran robots.txt | Alta | No hay mitigación 100%; el contenido es público igual, mejor scrapeo correcto que ignore |
| Build time crece con URLs | Media | Sharding del getStaticPaths, sitemap batch endpoint limita a 500 por build |
| Backward compat: app mobile con URLs viejas cacheadas | Baja | Redirect 301 las maneja transparentemente |
| >2000 redirects en Cloudflare Pages | Media | Primeras 2000 en `_redirects`, las demás las maneja el worker con KV lookup |
| IndexNow key file no válido | Baja | Verificar `public/antena2026indexnow.txt` contiene exactamente la key, no la URL |

---

## Cambios por archivo (resumen)

### `packages/antena/`

- `astro.config.mjs` — fix #1, #11
- `src/layouts/Layout.astro` — fix #2, #3, #6, #7; simplifica head meta
- `src/components/SeoHead.astro` — **NUEVO** (Sección 2)
- `src/components/article/` — usar `<SeoHead>` en ArticleDetail.tsx (no se renderiza server-side pero el link canónico debe estar en el DOM)
- `src/pages/404.astro` — fix #8; usar `<SeoHead>` con noindex
- `src/pages/about.astro` — usar `<SeoHead>`
- `src/pages/contacto.astro` — fix #9; usar `<SeoHead>`
- `src/pages/privacidad.astro` — fix #9; usar `<SeoHead>`
- `src/pages/buscar.astro` — usar `<SeoHead>` con noindex
- `src/pages/settings.astro` — usar `<SeoHead>` con noindex
- `src/pages/index.astro` — usar `<SeoHead>` con data de home
- `src/pages/categoria/[cat].astro` — fix #5; usar `<SeoHead>` + FAQPage
- `src/pages/ciudad/[city].astro` — fix #5; usar `<SeoHead>` + FAQPage
- `src/pages/autor/[name].astro` — usar `<SeoHead>`
- `src/pages/noticia/[id].astro` — fix #4, #5, #12; legacy 301 redirect
- `src/pages/[year]/[month]/[day]/[slug].astro` — **NUEVO** (Sección 4)
- `src/pages/[year]/[month]/[day]/[slug].md` — **NUEVO** (Sección 3.3)
- `src/pages/sitemap-index.xml.astro` — fix #13 (renombrar o dividir)
- `src/functions/api/news/[year]/[month]/[day]/[slug].ts` — **NUEVO** endpoint markdown
- `src/lib/seo-monitor.ts` — **NUEVO** (Sección 5.4)
- `public/robots.txt` — agregar referencia a `/sitemap.xml` (no `sitemap-index.xml`)
- `public/og-default.png` → **`og-default.webp`** — fix #10
- `public/llms.txt` — expandir (Sección 3.1)
- `public/llms-full.txt` — **NUEVO** (Sección 3.2)
- `public/manifest.json` — fix #11
- `tests/seo.test.ts` — **NUEVO**
- `tests/seo-snapshots.test.ts` — **NUEVO**

### `packages/api/`

- `src/db/schema.ts` — agregar `slug`, `slug_date`
- `migrations/00XX_seo_slug.sql` — **NUEVO**
- `src/routes/news/[id].ts` — agregar 301 redirect a canónico
- `src/routes/news/[year]/[month]/[day]/[slug].ts` — **NUEVO**
- `src/routes/llm/cite.ts` — **NUEVO** (Sección 3.6)
- `src/routes/news/sitemap-batch.ts` — **NUEVO** (Sección 4.4)
- `src/lib/redirects-generator.ts` — **NUEVO** (genera _redirects)
- `src/lib/seo-redirects-cache.ts` — **NUEVO** (Sección 5.4)
- `tests/seo-routes.test.ts` — **NUEVO**

### `packages/akira/`

- `extractors/_slug.py` — **NUEVO** (Sección 4.1)
- `core/engine.py` — integrar `make_slug()` en `store_article()`
- `scripts/backfill_slugs.py` — **NUEVO** (Sección 4.3)
- `tests/test_slug.py` — **NUEVO**

### Documentación

- `docs/SEO-SUBMISSION-CHECKLIST.md` — actualizar con nueva estructura de URLs
- `docs/superpowers/specs/2026-06-15-seo-geo-perfecto-design.md` — **ESTE ARCHIVO**
- `docs/superpowers/plans/2026-06-15-seo-geo-perfecto.md` — plan de implementación (lo crea `writing-plans`)

---

## Out of scope (decisiones tomadas para NO hacer)

- **No migrar a imágenes WebP/AVIF en disco.** Las imágenes ya pasan por Cloudflare Image Resizing que sirve WebP/AVIF on-the-fly desde R2. El `og-default.png` se optimiza pero no toca el resto.
- **No agregar `hreflang` multiidioma.** El sitio es 100% español argentina, no hay i18n todavía. Cuando se agregue portugués (roadmap), se agrega `hreflang="pt-BR"`.
- **No implementar Service Worker changes.** El SW actual cachea correctamente; no necesita cambios.
- **No cambiar a Next.js.** Astro 5 + Solid es el stack actual, los cambios son compatibles.
- **No reescribir la lógica de extracción.** AKIRA sigue igual, solo agrega slug al output.
- **No agregar Google Analytics.** El proyecto es privacy-first por diseño, Plausible sería aceptable pero no es parte de este spec.

---

## Próximos pasos

1. ✅ Spec escrito y committed (este doc)
2. ⏭️ Self-review del spec (placeholders, contradicciones, ambigüedad, scope)
3. ⏭️ User review del spec
4. ⏭️ Invocar `writing-plans` skill para crear plan de implementación
5. ⏭️ Ejecutar plan con `subagent-driven-development` o `executing-plans`
