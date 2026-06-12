# PULSO Master Roadmap — AKIRA + ANTENA

**Fecha:** 2026-04-09
**Estado:** Planificación activa
**Proyecto:** ~/proyectos/news

---

## Diagnóstico del Estado Actual

### AKIRA (Motor de Extracción — Python/FastAPI)
- **Versión:** 4.0.0
- **Puerto actual:** 5000 (colisiona con otros servicios)
- **DB:** `akira.db` — 1061 fuentes activas, 4513 news_cards
- **Pipeline:** raw_news=0, processed_news=0, clean_news=0 (pipeline roto)
- **Problemas identificados:**
  - Solo `news_cards` tiene datos (4513) — son viejas o importadas
  - Pipeline no está fluyendo: raw → processed → clean
  - Skills de analyst/cleaner/publisher NO están integrados al motor
  - Method learning existe pero no aprende de verdad
  - 1061 fuentes pero la mayoría sin `extraction_method` definido
  - Falta el skill `akira-d1-harvest` como batch harvester
  - Falta skill `akira-supervisor` para monitoring

### ANTENA (Frontend — Astro + Solid.js)
- **Puerto default:** 4321
- **API endpoint:** `http://localhost:8787`
- **Stack:** Astro (SSR?) + Solid.js + Tailwind
- **Componentes:** App.tsx con 5 views (feed, article, sintonizar, menu, bookmarks)
- **Problemas:**
  - No está claro si SSR está funcionando
  - Wrangler config apunta a D1 "AKIRA_DB_ID" placeholder
  - API routes existen pero no hay validación de que funcionen
  - Falta mucha UI/UX (detalles en sección dedicada)

### API (Hono + Cloudflare Workers)
- **Puerto dev:** 8787
- **Config:** wrangler.toml con D1/KV/R2 placeholders
- **Routes:** news, locations, categories, ingest, images, sitemap, rss, stats, extract-unified, synthesis, health
- **Problemas:**
  - `better-sqlite3` no funciona en Workers (debería ser D1 client)
  - D1 binding usa placeholder ID
  - KV/CACHE no configurado

### Git
- Branch: `main`
- Cambios sin commit: .pyc files + 3 archivos TSX modificados
- Trabajo anterior en worktrees

---

## Arquitectura Objetivo (Mixto Local + Cloudflare)

```
┌─────────────────────────────────────────────────────────┐
│  MAC MINI M4 (LOCAL)                                    │
│                                                         │
│  AKIRA (puerto 5050)                                    │
│  ├── Scout      →Descubre fuentes (nic.ar, dorks)       │
│  ├── Harvester  →Extrae raw_news de 1061 fuentes        │
│  ├── Analyst    →Bias scoring, clustering               │
│  ├── Cleaner    →Filtra gacetillas, spam                │
│  └── Publisher  →Sync a Cloudflare D1                   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ SKILLS (Hermes)                                  │   │
│  │ akira-scout, akira-harvester, akira-analyst,    │   │
│  │ akira-cleaner, akira-publisher, akira-supervisor │   │
│  │ akira-smart-harvester, akira-d1-harvest         │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          │
                          │ Sync (clean_news → D1)
                          ▼
┌─────────────────────────────────────────────────────────┐
│  CLOUDFLARE (Free Tier)                                 │
│                                                         │
│  D1 Database (akira-db)                                 │
│  KV Cache (akira-cache)                                 │
│  R2 Bucket (akira-images)                               │
│  Workers (akira-api) — puerto 8787 dev / prod worker   │
│                                                         │
│  ANTENA (Astro + Solid.js)                              │
│  ├── SSR en Cloudflare Pages                            │
│  └── CSG con Cloudflare D1/KV/R2                        │
└─────────────────────────────────────────────────────────┘
```

---

## FASE 1: Cimientos — Levantar Servicios (1-2 días)

### 1.1 Levantar AKIRA en puerto 5050
- Cambiar `config.py` port de 5000 → 5050
- Verificar que levante: `curl http://localhost:5050/health`
- Commit: "chore: move akira to port 5050"

### 1.2 Levantar API en puerto 8788 (dev alternativo)
- API actual usa `better-sqlite3` que no funciona en Workers
- Para dev local: crear script que use SQLite directamente
- Para prod: migrar a D1 client
- Verificar que levante

### 1.3 Ver estado actual de Antenna
- `cd packages/antena && pnpm dev` en puerto 4321
- Probar que conecta a API
- Documentar qué falla

### 1.4 Configurar wrangler.toml con D1/KV/R2 reales (o mock)
- Crear D1 database: `wrangler d1 create akira-db`
- Crear KV: `wrangler kv:namespace create AKIRA_CACHE`
- Crear R2 bucket: `wrangler r2 bucket create akira-images`
- Actualizar `wrangler.toml` con IDs reales

### 1.5 Setup Cloudflare (primeros pasos)
- `hermes config` para configurar `CLOUDFLARE_*` env vars
- `wrangler login` para autenticar

---

## FASE 2: Pipeline de Extracción — AKIRA funcional (3-5 días)

### 2.1 Integrar Skills al Motor AKIRA
Cada skill debe ser callable desde el motor, no solo desde Hermes.

```
AKIRA main.py lifespan:
├── method_learner = MethodLearner(akira_db_path)
├── method_scorer = MethodScorer(akira_db_path)
├── synthesis_engine = SynthesisEngine(...)
├── clustering_service = ClusteringService(...)
└── HTTPClient + BrowserPool
```

**Falta integrar:**
- `akira-analyst` → bias scoring + clustering
- `akira-cleaner` → filtro de gacetillas/spam
- `akira-publisher` → sync a D1

### 2.2 Harvester: Extraer raw_news
- Elegir 50 fuentes activas con RSS funcional
- Implementar ciclo: para cada fuente → `/extract` → guardar en `raw_news`
- Guardar: title, body, image_url, published_at, source_id

### 2.3 Analyst: Bias + Clustering
- Integration con MiniMax API para bias scoring
- Clustering de noticias similares (usar `clustering_service`)
- Guardar en `processed_news`

### 2.4 Cleaner: Filtrar
- Detectar gacetillas (vs noticias reales)
- Filtrar obituarios, horóscopos, farmacias de turno
- Guardar en `clean_news`

### 2.5 Publisher: Sync a D1
- `clean_news` → `news_cards` en D1
- Subir imágenes a R2

### 2.6 D1 Harvest (batch)
- Script que corra periódicamente
- Usar skill `akira-d1-harvest` o cron job

---

## FASE 3: Scout — Descubrir Fuentes (2-3 días)

### 3.1 Fuentes Activas con RSS
- De las 1061 fuentes, identificar cuáles tienen RSS funcional
- Crear script de test RSS masivo

### 3.2 Scout: Nic.ar Discovery
- Buscar nuevos dominios `.com.ar` de medios
- Usar skill `akira-scout` con MiniMax web_search

### 3.3 Registrar Fuentes Nuevas
- Insertar en `sources` con `extraction_method` correcto
- Asignar `location_id` por provincia/ciudad

---

## FASE 4: ANTENA UI/UX (5-7 días)

### 4.1 Fixes Críticos
- [ ] SSR mode funciona correctamente
- [ ] API connection estable
- [ ] Error boundaries proper
- [ ] Loading states para todas las views

### 4.2 Views que Faltan o Están Incompletas
- [ ] **ArticleDetail** — mejorar layout, compartir, bookmark
- [ ] **SintonizarView** — UI de categorías
- [ ] **MenuView** — stats, bookmarks count
- [ ] **BookmarksView** — persistencia de bookmarks

### 4.3 Components
- [ ] **NewsCard** — mejorar variantes (feed, compact, featured)
- [ ] **FeaturedCluster** — hero para noticia principal
- [ ] **LocationSelector** — dropdown con búsqueda
- [ ] **BiasDistributionWidget** — ya existe, mejorar visual
- [ ] **BreakingNewsBanner** — animaciones, diseño
- [ ] **ModoMate** — feature experimental (¿qué es?)

### 4.4 UX Features
- [ ] Pull to refresh en mobile
- [ ] Share native
- [ ] Deep linking (URL state ya existe)
- [ ] PWA manifest + service worker
- [ ] Offline support con cached news

### 4.5 Performance
- [ ] Lazy loading de imágenes
- [ ] Skeleton screens mejorados
- [ ] Virtual scrolling si hay muchas news
- [ ] Lighthouse target: 90+

---

## FASE 5: Cloudflare Production (3-4 días)

### 5.1 D1 Schema Migration
- Aplicar `migrations/0001_complete_schema.sql` a D1 real
- Verificar que news_cards sea accesible desde API

### 5.2 API Migration (better-sqlite3 → D1)
- El cliente D1 de Hono es diferente a `better-sqlite3`
- Necesita async/await
- Endpoints: `/api/news`, `/api/news/:id`, `/api/news/ingest`

### 5.3 R2 Image Upload Pipeline
- Publisher debe subir a R2
- API debe servir imágenes optimizadas

### 5.4 KV Cache Strategy
- Cachear news feed por location + category
- TTL: 5 minutos para news recientes, 1 hora para old

### 5.5 Deploy Pipeline
- GitHub Actions: build + deploy a Cloudflare Pages
- `wrangler deploy` para API
- Secrets en Cloudflare dashboard

---

## FASE 6: Automatización + Monitoring (2-3 días)

### 6.1 Cron Jobs (Hermes)
- Scout: cada 6 horas
- Harvester: cada 15 minutos
- D1 Harvest: cada 1 hora
- Cleaner: post-harvest

### 6.2 akira-supervisor
- Health checks de fuentes
- Alertas de fuentes muertas
- Estadísticas de extracción

### 6.3 Logs + Observability
- `hermes logs` command
- Errores en Cloudflare dashboard
- D1 query analytics

---

## Archivos Clave a Modificar

### AKIRA
- `packages/akira/config.py` — puerto, paths
- `packages/akira/main.py` — integrar skills
- `packages/akira/core/engine.py` — cascade logic
- `packages/akira/core/synthesis.py` — synthesis engine
- `packages/akira/core/clustering.py` — clustering service
- `packages/akira/data/akira.db` — migrations

### API
- `packages/api/src/index.ts` — CORS, routes
- `packages/api/src/routes/news.ts` — D1 queries
- `packages/api/src/lib/d1.ts` — D1 client
- `packages/api/wrangler.toml` — bindings reales
- `packages/api/.dev.vars` — secrets

### ANTENA
- `packages/antena/src/App.tsx` — main app
- `packages/antena/src/pages/index.astro` — entry
- `packages/antena/astro.config.mjs` — SSR config
- `packages/antena/src/lib/api.ts` — API client
- `packages/antena/public/manifest.json` — PWA

---

## Orden de Implementación Sugerido

```
1. Levantar servicios (1.1 → 1.2 → 1.3)
   └→ Commit: "feat: services running on alternate ports"

2. Pipeline básico (2.2 → 2.3 → 2.4 → 2.5)
   └→ Commit: "feat: full extraction pipeline working"

3. Fuentes (3.1 → 3.2 → 3.3)
   └→ Commit: "feat: active source discovery and registration"

4. Antenna UI (4.1 → 4.2 → 4.3)
   └→ Commit incremental por componente

5. Cloudflare prod (5.1 → 5.2 → 5.3 → 5.4)
   └→ Commit: "feat: production deployment"

6. Automation (6.1 → 6.2 → 6.3)
   └→ Commit: "feat: cron jobs and monitoring"
```

---

## Skills a Usar por Fase

| Fase | Skills |
|------|--------|
| 1. Cimientos | `wrangler`, `github-pr-workflow` |
| 2. Pipeline | `opencode`, `akira-harvester`, `akira-analyst`, `akira-cleaner`, `akira-publisher` |
| 3. Scout | `akira-scout`, `akira-smart-harvester` |
| 4. Antenna | `opencode`, `dogfood` |
| 5. Cloudflare | `wrangler`, `github-pr-workflow` |
| 6. Automation | `cron`, `akira-supervisor`, `akira-d1-harvest` |

---

## Open Questions

1. ¿El frontend Antenna usa SSR o Static? El `astro.config.mjs` no lo vi
2. ¿`ModoMate` es una feature real o experimental?
3. ¿Hay API key de Cloudflare configurada? (necesito verificar `.dev.vars`)
4. ¿Las imágenes ya se guardan en R2 o se ссылаются directamente?
5. ¿Qué modelo de MiniMax se usa para bias/analysis?
6. ¿`antena-top-tier` worktree era otra rama? ¿lo mergeamos?

---

## Validation Steps (por fase)

### Fase 1
```bash
curl http://localhost:5050/health | jq .
curl http://localhost:8788/api/health | jq .
cd packages/antena && pnpm dev  # verificar en localhost:4321
```

### Fase 2
```bash
sqlite3 packages/akira/data/akira.db "SELECT COUNT(*) FROM raw_news;"  # > 0
sqlite3 packages/akira/data/akira.db "SELECT COUNT(*) FROM processed_news;"  # > 0
sqlite3 packages/akira/data/akira.db "SELECT COUNT(*) FROM clean_news;"  # > 0
```

### Fase 3
```bash
sqlite3 packages/akira/data/akira.db "SELECT COUNT(*) FROM sources WHERE is_active=1 AND extraction_method IS NOT NULL;"
```

### Fase 4
```bash
# Lighthouse CI o manual
open http://localhost:4321
```

### Fase 5
```bash
wrangler d1 execute akira-db --file=migrations/0001_complete_schema.sql
curl https://akira-api.workers.dev/api/health
```
