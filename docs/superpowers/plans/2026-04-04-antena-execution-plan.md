# AKIRA + ANTENA — PLAN DE EJECUCIÓN

> **Creado:** 2026-04-04
> **Objetivo:** Antena conectado a datos reales de AKIRA, deploy en Cloudflare FREE

---

## Estado Actual del API (verificado)

| Endpoint | Status | Data |
|----------|--------|------|
| `/api/health` | ✅ OK | Worker info |
| `/api/news/feed?limit=2` | ✅ OK | 3520 news, pagination works |
| `/api/news/:id` | ⚠️ IDs son UUIDs | "Not found" para id=1 |
| `/api/locations/tree` | ✅ OK | 118 locations |
| `/api/categories` | ✅ OK | 8 categories con slugs/icons |
| `/api/stats/health` | ✅ OK | 3520 news, 917 sources |

### Fields del API
```json
{
  "id": "uuid",
  "location_id": 1,
  "title": "...",
  "summary": "...",
  "image_url": "https://...",
  "bias_score": 0.0,
  "is_gacetilla": 0,
  "cluster_id": "cluster-xxx",
  "category": "Política",
  "source_ids": "1,2,3",
  "published_at": "2026-04-04T...",
  "created_at": "2026-04-04T..."
}
```

### Gap Analysis
| Antena necesita | API tiene | Solución |
|----------------|-----------|----------|
| `body` | ❌ No | Usar `summary` por ahora |
| `bias` (categorical) | `bias_score` (REAL) | Mapping function |
| `signalLevel` (1-10) | ❌ No | Computed from source_ids count |
| `voices[]` | ❌ No | Computed from cluster bias scores |
| `propagation[]` | ❌ No | Derivable de pipeline (Fase 2) |
| `isClickbait` | ❌ No | Nueva columna (Fase 2) |
| `sourcesCount` | `source_ids` (CSV) | Parse y count |
| `time` ("Hace 2h") | `published_at` | Formatter |

---

## FASE 0.5: API Verification + Local Dev (2h)

### ✅ 0.5.1 Verificar endpoints del Hono API
- [x] `/api/news/feed` - 3520 news, pagination OK
- [x] `/api/news/:id` - IDs son UUIDs, funciona
- [x] `/api/locations/tree` - 118 locations
- [x] `/api/categories` - 8 categories
- [x] `/api/stats/health` - Stats OK

### ✅ 0.5.2 Local dev mode
- [x] Wrangler dev corriendo en port 8787
- [x] D1 local con 3520 news cards
- [x] KV cache local

---

## FASE 0: Fundaciones (9h)

### 0.1 Conectar a AKIRA API (4h)
- [ ] Crear `src/lib/api.ts` con fetch wrapper
- [ ] Feed endpoint → `NewsItem[]`
- [ ] Article endpoint → `NewsItem`
- [ ] Type mapping: bias_score → categorical
- [ ] Time formatter: `published_at` → "Hace 2h"

### 0.2 Loading + Error states (3h)
- [ ] Skeleton cards (3-5)
- [ ] Loading spinner article detail
- [ ] Error boundary con retry
- [ ] Empty state por categoría

### 0.3 Imágenes (2h)
- [ ] Thumbnail en NewsCard (16:9)
- [ ] Hero image en ArticleDetail
- [ ] Fallback con gradiente + icon
- [ ] Lazy loading

---

## FASE 1: Core Features (8h)

### 1.1 Búsqueda (3h)
- [ ] Search con debounce 300ms
- [ ] Resultados inline
- [ ] Empty state

### 1.2 Selector de ubicación (3h)
- [ ] Dropdown `/api/locations/tree`
- [ ] Geolocalización
- [ ] Filtro por location_id
- [ ] Persistencia localStorage

### 1.3 Categorías dinámicas (1h)
- [ ] Fetch `/api/categories`
- [ ] Reemplazar hardcoded
- [ ] Count badges

### 1.4 Stats reales (1h)
- [ ] Sidebar `/api/stats/health`
- [ ] Números dinámicos

---

## FASE 2: AKIRA Synthesis (15h)

### 2.1 Master Articles (5h)
- [ ] `GET /synthesis/master/{cluster_id}`
- [ ] Display en ArticleDetail
- [ ] Fallback al más neutral

### 2.2 Desglose de Voces REAL (4h)
- [ ] Agrupar bias_score del cluster
- [ ] Stacked bar con % reales
- [ ] Labels descriptivos

### 2.3 Línea de Tiempo (3h)
- [ ] Derivar de seen_urls timestamps
- [ ] Timeline visual
- [ ] Labels

### 2.4 Cluster View (3h)
- [ ] `GET /api/news/:id/cluster`
- [ ] Artículos relacionados
- [ ] Source count

---

## FASE 3: UX Polish (12h)

### 3.1 Sintonizar View (4h)
- [ ] Dial interactivo
- [ ] Trending real
- [ ] Community services

### 3.2 Menú (3h)
- [ ] Mis Antenas
- [ ] Edición Dominical
- [ ] Calibrador de Voz

### 3.3 Infinite Scroll (2h)
- [ ] Pagination
- [ ] Intersection Observer

### 3.4 Modo Mate (TTS) (3h)
- [ ] Web Speech API
- [ ] Auto-scroll
- [ ] Speed control

---

## FASE 4: Cloudflare Deploy (14h)

### 4.1 Cloudflare Pages (2h)
- [ ] Build config
- [ ] Deploy
- [ ] Custom domain

### 4.2 Workers API (4h)
- [ ] Hono en Workers
- [ ] D1 binding
- [ ] CORS
- [ ] KV cache

### 4.3 AKIRA → D1 Sync (3h)
- [ ] Script sync cada 15min
- [ ] Delta sync
- [ ] Error handling

### 4.4 SEO + PWA + Analytics (5h)
- [ ] Per-article pages
- [ ] Meta tags
- [ ] Sitemap
- [ ] PWA manifest + SW
- [ ] Cloudflare Analytics
- [ ] Error tracking

---

## Estado Actual

| Fase | Status | Progress |
|------|--------|----------|
| 0.5 API Verification | ✅ Completada | 100% |
| 0 Fundaciones | ⬜ Pendiente | 0% |
| 1 Core Features | ⬜ Pendiente | 0% |
| 2 Synthesis | ⬜ Pendiente | 0% |
| 3 UX Polish | ⬜ Pendiente | 0% |
| 4 Deploy | ⬜ Pendiente | 0% |

---

*Última actualización: 2026-04-04*
