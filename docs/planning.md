# ANTEKA — Plan Maestro y Deuda Técnica

> **Creado:** 2026-04-05  
> **Última actualización:** 2026-04-05  
> **Estado:** Documento vivo — actualizar con cada avance  
> **Alcance:** Todo el ecosistema AKIRA → API → Antena

---

## 1. Arquitectura Actual

```
┌─────────────────────────────────────────────────────────────────┐
│  AKIRA (Python/FastAPI — puerto 5000)                           │
│  Motor de extracción con 10 métodos                             │
│  SQLite: akira.db (sources, news_cards, locations, etc.)        │
└──────────────────────────┬──────────────────────────────────────┘
                           │ POST /extract, /extract/google-news
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  API (Node/Hono — puerto 8787)                                  │
│  Proxy a AKIRA + rutas de noticias/ubicaciones/categorías       │
│  KV cache, ingest route, CORS configurado                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ GET /api/news, /api/locations, etc.
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Antena (Astro 5 + Solid.js — puerto 4324)                      │
│  Frontend público con layout tipo Reddit                        │
│  Fondo crema #F9F6F0, primario terracota #e25336                │
│  PWA manifest configurado                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Estado Actual por Componente

### 2.1 AKIRA Extraction Engine (v3.2)

| Componente | Estado | Notas |
|------------|--------|-------|
| 10 extractores (RSS, WP API, Newspaper, Goose, Sitemap, Playwright, Jina, Video, Social, Google News) | ✅ | Todos con db_path/source_id params |
| Cascade inteligente con method learning | ✅ | Weighted scoring + optimización por fuente |
| Delta extraction (seen_urls, last_harvest_at) | ✅ | Evita duplicados |
| Source recovery / auto-healing | ✅ | Servicio de recuperación automática |
| Rate limiting + circuit breaker | ✅ | 1.5s entre requests al mismo dominio |
| Health monitor | ✅ | Auto-pausa fuentes con 5+ fallos |
| Prometheus metrics | ✅ | Endpoint de métricas |
| 112 tests passing | ✅ | Cobertura básica |
| SQLite unificada (akira.db) | ✅ | ~917 fuentes, ~3339 news_cards |
| 118 localidades argentinas | ✅ | Desde datos oficiales |

### 2.2 API Layer (Hono)

| Componente | Estado | Notas |
|------------|--------|-------|
| News feed endpoints | ✅ | `/api/news`, `/api/news/:id`, `/api/news/cluster/:id` |
| KV cache | ✅ | Cache de feeds y artículos |
| Ingest route | ✅ | `POST /api/news/ingest` para AKIRA → API sync |
| Locations + categories | ✅ | `/api/locations/tree`, `/api/categories` |
| Extract proxy | ✅ | Proxy a AKIRA `/api/extract` |
| Stats, images, RSS, sitemap | ✅ | Rutas auxiliares |
| CORS | ✅ | Configurado para akira.ar + localhost |
| Rate limiting | ⬜ | Pendiente |
| Request validation | ⬜ | Pendiente |
| Cursor pagination | ⬜ | Solo offset-based |
| Search endpoint (FTS5) | ⬜ | Pendiente |
| Cache headers | ⬜ | Sin Cache-Control/ETag |
| API versioning | ⬜ | Sin `/api/v1/` |

### 2.3 Antena Frontend

| Componente | Estado | Notas |
|------------|--------|-------|
| Layout tipo Reddit (3 columnas desktop) | ✅ | Sidebar + Feed + Right Panel |
| Header con tabs de categorías | ✅ | 8 categorías hardcodeadas |
| Location selector | ✅ | Dropdown con ubicaciones |
| News feed con cards | ✅ | Con infinite scroll |
| Featured cluster hero | ✅ | Noticia con más fuentes |
| Breaking news banner | ✅ | signalLevel >= 8 |
| Bias distribution widget | ✅ | Barra visual Neutral/Oficialista/Opositor |
| Time filters | ✅ | Última hora / Hoy / Esta semana / Todas |
| Article detail view | ✅ | Con multimedia (YouTube/Vimeo embeds, galería) |
| Right panel | ✅ | Síntesis del día, bias, ruido filtrado |
| Modo Mate (TTS) | ✅ | Text-to-speech con speed control |
| Menu view | ✅ | Guardados, Mis Antenas, Tema, Acerca de |
| Sintonizar view | ✅ | Selector de categorías/ubicaciones |
| Bookmarks | ✅ | localStorage |
| Share functionality | ✅ | Web Share API + fallback clipboard |
| Mobile bottom nav | ✅ | 3 tabs: Inicio, Sintonizar, Menú |
| Loading skeletons | ✅ | 5 skeletons con animación |
| Error states | ✅ | Con retry button |
| Empty states | ✅ | Mensaje sin noticias |
| PWA manifest | ✅ | Configurado |
| Service Worker | ⬜ | Pendiente |
| Dark theme | ⬜ | Pendiente |
| SEO meta tags | ⬜ | Sin Open Graph/structured data |
| RSS feed generation | ⬜ | Pendiente |
| City selector / geolocation | ⬜ | Pendiente |
| Source credibility badge | ⬜ | Pendiente |
| Reading time calculation | ⬜ | Pendiente |

### 2.4 Hermes Skills

| Skill | Estado | DB Target |
|-------|--------|-----------|
| akira-scout | ✅ | akira.db |
| akira-harvester | ✅ | akira.db |
| akira-analyst | ✅ | akira.db |
| akira-cleaner | ✅ | akira.db |
| akira-publisher | ✅ | akira.db |
| akira-supervisor | ✅ | akira.db |
| akira-smart-harvester | ✅ | akira.db |
| akira-d1-harvest | ✅ | akira.db |

---

## 3. Features Planeadas (No Implementadas)

### 3.1 Prioridad 1 — Conexión a Datos Vivos
| # | Feature | Estado | Esfuerzo | Dependencias |
|---|---------|--------|----------|--------------|
| 1.1 | Reemplazar datos estáticos con API fetch | ✅ Parcial | 2h | 1.2 |
| 1.2 | API `/api/news/feed` end-to-end con akira.db | ⚠️ | 1h | — |
| 1.3 | SSR data loading en index.astro | ⬜ | 2h | 1.2 |
| 1.4 | Conectar ubicacion/[slug].astro con location_id filter | ⬜ | 3h | 1.2 |
| 1.5 | Conectar noticia/[slug].astro para artículo detail | ⬜ | 2h | 1.2 |
| 1.6 | Loading states + error fallbacks en todas las páginas | ⬜ | 2h | 1.3, 1.4, 1.5 |

### 3.2 Prioridad 2 — Data Quality & Content Pipeline
| # | Feature | Estado | Esfuerzo | Dependencias |
|---|---------|--------|----------|--------------|
| 2.1 | Full harvest cycle en todas las fuentes | ⬜ | 4h | — |
| 2.2 | Scheduled harvest (cron/systemd/GitHub Actions) | ⬜ | 3h | 2.1 |
| 2.3 | Bias detection + clustering pipeline | ⬜ | 6h | — |
| 2.4 | Cleaner pipeline (gacetillas, obituarios, spam) | ⬜ | 4h | — |
| 2.5 | Image pipeline (descarga + optimización + R2) | ⬜ | 6h | — |
| 2.6 | Source health dashboard | ⬜ | 4h | — |

### 3.3 Prioridad 3 — API Hardening
| # | Feature | Estado | Esfuerzo | Dependencias |
|---|---------|--------|----------|--------------|
| 3.1 | API rate limiting (Hono middleware) | ⬜ | 2h | — |
| 3.2 | Request validation + error handling middleware | ⬜ | 2h | — |
| 3.3 | Cursor pagination (no offset) | ⬜ | 3h | — |
| 3.4 | Search endpoint (FTS5) | ⬜ | 4h | — |
| 3.5 | Cache headers (Cache-Control, ETag) | ⬜ | 1h | — |
| 3.6 | API versioning (/api/v1/...) | ⬜ | 1h | — |

### 3.4 Prioridad 4 — Antena UX & Features
| # | Feature | Estado | Esfuerzo | Dependencias |
|---|---------|--------|----------|--------------|
| 4.1 | Infinite scroll / load more | ✅ | 3h | 1.3 |
| 4.2 | Category filtering | ✅ Parcial | 2h | 1.3 |
| 4.3 | City selector / geolocation | ⬜ | 3h | 1.4 |
| 4.4 | Dark/light theme toggle | ⬜ | 2h | — |
| 4.5 | SEO: meta tags, Open Graph, structured data | ⬜ | 3h | 1.5 |
| 4.6 | RSS feed generation por ubicación/categoría | ⬜ | 2h | 3.4 |
| 4.7 | PWA: service worker, offline support | ⬜ | 6h | — |
| 4.8 | TTS (Text-to-Speech) para artículos | ✅ | 4h | 1.5 |

### 3.5 Prioridad 5 — Infrastructure & DevOps
| # | Feature | Estado | Esfuerzo | Dependencias |
|---|---------|--------|----------|--------------|
| 5.1 | Docker compose para dev local | ⬜ | 3h | — |
| 5.2 | CI/CD pipeline (GitHub Actions) | ⬜ | 4h | — |
| 5.3 | Deploy AKIRA a VPS/Render/Railway | ⬜ | 3h | — |
| 5.4 | Deploy API a Cloudflare Workers | ⬜ | 3h | 3.6 |
| 5.5 | Deploy Antena a Cloudflare Pages | ⬜ | 2h | 4.5 |
| 5.6 | Monitoring: health checks, uptime alerts, logs | ⬜ | 4h | 5.3 |
| 5.7 | Database backup strategy para akira.db | ⬜ | 2h | — |

### 3.6 Prioridad 6 — Scout & Source Discovery
| # | Feature | Estado | Esfuerzo | Dependencias |
|---|---------|--------|----------|--------------|
| 6.1 | Scout v12: auto-register discovered sources | ⬜ | 4h | — |
| 6.2 | Scout scheduling: weekly por provincia | ⬜ | 2h | 6.1 |
| 6.3 | Source deduplication | ⬜ | 2h | 6.1 |
| 6.4 | Source quality scoring | ⬜ | 3h | 2.6 |

---

## 4. Deuda Técnica

### 4.1 Crítica (Bloquea Producción)

| ID | Descripción | Impacto | Esfuerzo | Archivo(s) |
|----|-------------|---------|----------|------------|
| DT-01 | **Categorías hardcodeadas** — Las categorías están hardcodeadas en App.tsx y no se sincronizan con la API | Alto | 1h | `src/App.tsx` |
| DT-02 | **Extracción de categoría desde título** — Workaround en `mappers.ts` porque la API devuelve `category: null` | Alto | 2h | `src/lib/mappers.ts` |
| DT-03 | **API URL hardcodeada** — Sin variable de entorno para la URL de la API | Alto | 0.5h | `src/lib/api.ts` |
| DT-04 | **Sin tests** — Cero tests en el frontend | Alto | 8h | Todo el proyecto |
| DT-05 | **Sin error boundaries** — Errores en Solid.js components pueden crashear toda la app | Alto | 2h | `src/App.tsx`, components |
| DT-06 | **API sin rate limiting** — Vulnerable a abuso | Alto | 2h | `packages/api/` |
| DT-07 | **API sin request validation** — Datos malformados pueden causar errores | Alto | 2h | `packages/api/` |
| DT-08 | **Sin cursor pagination** — Offset-based no escala | Medio | 3h | `packages/api/`, `src/lib/api.ts` |

### 4.2 Alta (Afecta UX/Performance)

| ID | Descripción | Impacto | Esfuerzo | Archivo(s) |
|----|-------------|---------|----------|------------|
| DT-09 | **Bias score mapping hacky** — Conversión de número (-1 a 1) a string es frágil | Medio | 1h | `src/lib/mappers.ts` |
| DT-10 | **Signal level calculation dinámica** — Se calcula en cada render, podría optimizarse | Medio | 1h | `src/lib/mappers.ts` |
| DT-11 | **PostCSS issue con Material Symbols** — URL con comas requiere workaround | Bajo | 0.5h | `src/layouts/Layout.astro` |
| DT-12 | **Hot reload inconsistente** — Astro dev server no siempre recarga cambios en Layout.astro | Medio | 1h | Dev server |
| DT-13 | **Sin loading state para article detail** — No hay feedback visual al cargar artículo | Medio | 1h | `src/components/article/ArticleDetail.tsx` |
| DT-14 | **Sin caching headers** — API no envía Cache-Control/ETag | Medio | 1h | `packages/api/` |
| DT-15 | **Sin SEO meta tags** — Sin Open Graph, Twitter Cards, structured data | Alto | 3h | `src/layouts/Layout.astro` |
| DT-16 | **Sin Service Worker** — PWA incompleta sin offline support | Medio | 6h | `public/sw.js` |

### 4.3 Media (Mejoras de Calidad)

| ID | Descripción | Impacto | Esfuerzo | Archivo(s) |
|----|-------------|---------|----------|------------|
| DT-17 | **Sin dark theme** — CSS variables preparadas pero no implementadas | Bajo | 2h | `src/layouts/Layout.astro`, components |
| DT-18 | **Sin image optimization** — Imágenes se cargan sin optimizar | Medio | 4h | Components de imágenes |
| DT-19 | **Sin source health visualization** — No se muestra estado de fuentes en UI | Bajo | 2h | `src/components/layout/Sidebar.tsx` |
| DT-20 | **Sin reading time calculation** — No se muestra tiempo de lectura | Bajo | 0.5h | `src/lib/mappers.ts` |
| DT-21 | **Sin source credibility badge** — No se muestra confiabilidad de fuente | Bajo | 1h | `src/components/common/NewsCard.tsx` |
| DT-22 | **Sin city selector / geolocation** — Usuario no puede detectar ubicación automáticamente | Medio | 3h | `src/components/common/LocationSelector.tsx` |
| DT-23 | **Sin RSS feed generation** — No se generan feeds RSS por ubicación/categoría | Bajo | 2h | `packages/api/` |
| DT-24 | **Sin scheduled harvest** — Harvest manual, no automático | Alto | 3h | Scripts/CI |

### 4.4 Baja (Nice-to-Have)

| ID | Descripción | Impacto | Esfuerzo | Archivo(s) |
|----|-------------|---------|----------|------------|
| DT-25 | **Sin Docker compose** — Dev environment no reproducible | Medio | 3h | `docker-compose.yml` |
| DT-26 | **Sin CI/CD** — Sin pipeline de lint/test/build | Medio | 4h | `.github/workflows/` |
| DT-27 | **Sin monitoring** — Sin health checks, uptime alerts, logs centralizados | Medio | 4h | Infra |
| DT-28 | **Sin database backup** — akira.db sin backup automático | Alto | 2h | Scripts |
| DT-29 | **Sin source deduplication** — Scout puede registrar dominios duplicados | Medio | 2h | `packages/akira/` |
| DT-30 | **Sin source quality scoring** — No se desactivan fuentes de baja calidad | Medio | 3h | `packages/akira/` |

---

## 5. Timeline Estimado

### Fase 1: "Show Real News" (~15h)
- **Día 1-2:** DT-02, DT-03, 1.2, 1.3 — Conectar Antena a API live
- **Día 3:** 1.4, 1.5 — Location + article pages con datos reales
- **Día 4:** 1.6, DT-05 — Error handling + error boundaries
- **Día 5:** DT-01 — Sincronizar categorías con API

**Outcome:** Antena muestra noticias reales de la base de datos.

### Fase 2: "Data Quality" (~20h)
- **Día 1-2:** 2.2, 2.4 — Scheduled harvest + content cleaner
- **Día 3-4:** 2.3, 2.6 — Clustering + health dashboard
- **Día 5:** DT-06, DT-07, DT-08 — API hardening

**Outcome:** Datos frescos, limpios, API confiable.

### Fase 3: "UX Polish" (~18h)
- **Día 1-2:** 4.3, 4.2 — City selector + category filtering mejorado
- **Día 3:** DT-15, 4.6 — SEO + RSS feeds
- **Día 4-5:** DT-17, 4.7 — Dark theme + PWA service worker

**Outcome:** Frontend pulido, listo para usuarios.

### Fase 4: "Production" (~21h)
- **Día 1-2:** DT-25, DT-26 — Docker + CI/CD
- **Día 3:** 5.3, 5.4, 5.5 — Deploy de los 3 servicios
- **Día 4:** DT-27, DT-28 — Monitoring + backups
- **Día 5:** 6.1-6.4 — Scout automation

**Outcome:** Sistema desplegado, monitoreado, auto-mantenido.

**Total estimado: ~74h en 4 semanas**

---

## 6. Quick Wins (< 4h, Alto Impacto)

| Feature | Impacto | Esfuerzo | Por Qué |
|---------|---------|----------|---------|
| DT-03 API URL como variable de entorno | 🔴 Crítico | 0.5h | Permite configurar dev/prod |
| 1.2 API feed con datos live | 🔴 Crítico | 1h | Desbloquea todo lo demás |
| DT-15 SEO meta tags | 🟡 Alto | 3h | Compartir en redes sociales |
| DT-01 Sincronizar categorías | 🟡 Alto | 1h | UX consistente |
| DT-05 Error boundaries | 🟡 Alto | 2h | Previene crashes |
| 4.4 Dark/light theme | 🟢 Medio | 2h | Polish visible |
| DT-20 Reading time | 🟢 Bajo | 0.5h | UX detail |

---

## 7. Riesgos

| Riesgo | Impacto | Probabilidad | Mitigación |
|--------|---------|--------------|------------|
| Harvest tarda demasiado para 917 fuentes | Alto | Media | Batches, delta extraction, paralelizar |
| Cloudflare Workers CPU limit (10ms) | Alto | Media | Prerender max pages, cache agresivo |
| D1 query limits (50 por invocación) | Medio | Baja | Batch queries, índices eficientes |
| URLs de fuentes se vuelven stale | Medio | Alta | Source recovery service (ya existe) |
| Antena SSR + Solid.js muy pesado para free tier | Medio | Media | Prerender static pages, islands para interactivo |
| Image storage excede R2 free tier (10GB) | Bajo | Baja | Optimizar imágenes, URLs externas, cleanup |
| API sin rate limiting es abusada | Alto | Media | Implementar DT-06 ASAP |

---

## 8. Métricas de Éxito

| Métrica | Actual | Target | Cómo Medir |
|---------|--------|--------|------------|
| Fuentes registradas | ~917 | 1200+ | `SELECT COUNT(*) FROM sources` |
| Noticias en DB | ~3339 | 10,000+ | `SELECT COUNT(*) FROM news_cards` |
| Fuentes con harvest exitoso | ~60% | 80%+ | source_health table |
| API response time (p95) | N/A | < 200ms | Monitoring |
| Antena page load (LCP) | N/A | < 2.5s | Lighthouse |
| Contenido fresco (< 24h) | N/A | 70%+ del feed | `published_at` analysis |
| Test coverage | 112 tests (AKIRA) | 150+ | pytest count |
| Uptime (AKIRA) | N/A | 99%+ | Health check monitoring |
| Uptime (API) | N/A | 99.9%+ | Cloudflare analytics |
| Frontend tests | 0 | 50+ | Vitest/Jest count |

---

## 9. Diferenciadores Únicos

| Feature | Competidores | Antena |
|---------|-------------|--------|
| Síntesis multi-fuente | ❌ | ✅ 54 fuentes → 1 neutral |
| Desglose de voces | ❌ | ✅ 45%N 35%O 20%Of |
| Potencia de señal | ❌ | ✅ 1-10 bars |
| Ruido filtrado | ❌ | ✅ Clickbait destruido |
| Modo Mate | ❌ | ✅ TTS con speed control |
| Top Clusters | ❌ | ✅ Qué es importante hoy |
| Bias del día | ❌ | ✅ Distribución visual |
| Fuentes destacadas | ❌ | ✅ Con confiabilidad |

---

## 10. Próximos Pasos Inmediatos

1. **Resolver DT-03** — Mover API URL a variable de entorno (30 min)
2. **Resolver DT-02** — Mejorar extracción de categorías o fix API (2h)
3. **Verificar 1.2** — Asegurar que `/api/news/feed` devuelve datos de akira.db (1h)
4. **Implementar DT-05** — Agregar error boundaries a Solid.js components (2h)
5. **Implementar DT-15** — Agregar SEO meta tags a Layout.astro (3h)

---

*Documento generado el 2026-04-05. Actualizar con cada avance.*
