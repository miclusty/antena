# AKIRA — Arquitectura Completa

## Stack Tecnológico

```
┌─────────────────────────────────────────────────────────────────┐
│  MAC MINI (MacOS) — Desarrollo Local                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  AKIRA (FastAPI, port 5000)                                   │
│  └── Cascade de 9 extractores (RSS → WP → Newspaper → Goose →   │
│      Sitemap → Video → Social → Playwright → Jina)           │
│  └── Rate limiter, circuit breaker, cache, health monitor    │
│                                                                 │
│  API (Hono, port 8787)                                        │
│  └── Rutas: /api/news, /api/extract, /api/images, /api/stats  │
│  └── Lee de D1, cache en KV                                   │
│                                                                 │
│  Wrangler Dev (Miniflare D1)                                   │
│  └── D1 SQLite local:                                          │
│      8e8a3dabd670767f6418dd674222bdf51d4dd12ba4d21c3e90c6bfb  │
│                                                                 │
│  Hermes (cron scheduler)                                       │
│  └── 6 jobs activos: scout, harvester, analyst, cleaner,     │
│      publisher, supervisor                                      │
│                                                                 │
│  LM Studio (local inference)                                    │
│  └── text-embedding-nomic-embed-text-v1.5 (clasificación)        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

                         ↓ Cloudflare (producción)

┌─────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE                                                     │
├─────────────────────────────────────────────────────────────────┤
│  D1 (base de datos)                                            │
│  Workers API (Hono)                                            │
│  R2 (imágenes)                                                │
│  KV (cache)                                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## AKIRA — Extraction Engine

### Ubicación
```
packages/akira/
```

### Extractor Cascade (prioridad descendente)

| Prioridad | Método | Librería | Timeout | Uso |
|-----------|--------|----------|---------|-----|
| 100 | RSS | feedparser | 30s | Feeds RSS/Atom estructurados |
| 90 | WordPress REST API | requests | 30s | Sites WordPress |
| 70 | Newspaper4k | newspaper | 60s | Artículo completo con NLP |
| 60 | Goose3 | goose3 | 60s | Fallback article extraction |
| 50 | Sitemap | xml.etree | 15s | URLs recientes de sitemap.xml |
| 40 | Video | requests + oEmbed | 30s | YouTube, Vimeo |
| 35 | Social | requests + oEmbed | 30s | X/Twitter, TikTok, Instagram |
| 30 | Playwright | playwright | 60s | Sites con JavaScript |
| 10 | Jina Reader | r.jina.ai | 60s | Último recurso |

### Flujo de Extracción

```
1. Validar URL (debe tener http/https)
2. Check rate limiter (1.5s entre requests al mismo dominio)
3. Check circuit breaker (5 fallos = pausa por 5 min)
4. Intentar cada extractor en orden de prioridad
5. Primer éxito = retornar resultado
6. Todos fallan = retornar error
7. Cachear resultado exitoso (TTL configurable)
```

### Componentes Core

```
core/
├── rate_limiter.py     # asyncio.Lock por dominio (race condition fix)
├── circuit_breaker.py  # Estado por (url, extractor) — no solo URL
├── cache.py            # MemoryBackend (LRU, TTL, versioning) + NullBackend
├── engine.py           # Orchestrator con retry exponential backoff
├── garbage_collector.py # TTL cleanup, stale removal, circuit reset
└── health_monitor.py   # Extractor health, memory, auto-heal
```

### Endpoints FastAPI

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `GET /` | - | Health check básico |
| `GET /health` | - | Status + uptime + cache hit rate |
| `GET /health/detailed` | - | Full extractor health + recommendations |
| `POST /extract` | JSON | Extraer de URL (url, source_id, prefer_method) |
| `POST /admin/gc` | - | Trigger garbage collection manual |
| `POST /admin/autoheal` | - | Auto-heal extractors con problemas |
| `GET /admin/stats` | - | Stats de cache, circuits, memory |

### Modelo de Datos (Pydantic)

```python
# Request
ExtractRequest(url, source_id?, location_id?, prefer_method?, use_cache=True, timeout=60)

# Response
ExtractResult(success, method: MethodName, type: "feed"|"article",
             items: List[NewsItem], article?, duration_ms, cached, source_id?, error?)

# NewsItem
NewsItem(title, url, summary, published_at?, image_url?, source)
```

---

## Pipeline de Datos

### Arquitectura D1 Directo (v4)

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  HARVESTER                                                      │
│  └── Extrae via AKIRA                                            │
│  └── Escribe a D1 news_cards                                    │
│  └── Actualiza D1 sources (fetch_count, last_fetch, rss_url)   │
│                                                                  │
│  ────────────────────────────────────────────────────────────   │
│                                                                  │
│  ANALYST                                                         │
│  └── SELECT * FROM news_cards WHERE bias_score IS NULL          │
│  └── Clasifica categoría (política, economía, deportes, etc)   │
│  └── Clustering (artículos sobre el mismo tema)                 │
│  └── Bias detection (comparando con fuentes .gob.ar)             │
│  └── Genera neutral_summary                                      │
│  └── UPDATE news_cards SET bias_score, cluster_id, category...  │
│                                                                  │
│  ────────────────────────────────────────────────────────────   │
│                                                                  │
│  CLEANER                                                         │
│  └── SELECT * FROM news_cards WHERE quality_score IS NULL        │
│  └── Filtra: obituarios, horóscopos, farmacias, spam,          │
│             publicidad pagada (gacetillas)                        │
│  └── Computa quality_score (0.0 - 1.0)                           │
│  └── UPDATE news_cards SET quality_score, is_gacetilla           │
│                                                                  │
│  ────────────────────────────────────────────────────────────   │
│                                                                  │
│  PUBLISHER                                                       │
│  └── SELECT * FROM news_cards                                   │
│      WHERE synced = 0 AND quality_score >= 0.3 AND is_gacetilla = 0│
│  └── Upload imágenes a R2 (opcional)                            │
│  └── Invalida cache KV                                          │
│  └── UPDATE news_cards SET synced = 1                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### D1 Schema — sources

```sql
CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  location_id INTEGER,
  reliability_score REAL DEFAULT 0.5,
  is_active INTEGER DEFAULT 1,

  -- Extension v3/v4
  domain TEXT,
  type TEXT DEFAULT 'diario',
  rss_url TEXT,
  last_fetch DATETIME,
  last_success DATETIME,
  fetch_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0
);

CREATE INDEX idx_sources_active ON sources(is_active, last_fetch);
CREATE INDEX idx_sources_domain ON sources(domain);
```

### D1 Schema — news_cards

```sql
CREATE TABLE news_cards (
  id TEXT PRIMARY KEY,
  location_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  image_url TEXT,

  -- Análisis (poblado por Analyst)
  bias_score REAL,           -- -1.0 (anti-gobierno) a +1.0 (pro-gobierno)
  is_gacetilla INTEGER DEFAULT 0,  -- 1 = nota pagada disfrazada
  gacetilla_confidence REAL DEFAULT 0,
  cluster_id TEXT,           -- ID del cluster (mismo tema)
  category TEXT,             -- política, economía, deportes, sociedad, etc
  bias_reasoning TEXT,      -- Explicación del bias score
  neutral_summary TEXT,     -- Resumen neutral generado por IA

  -- Calidad (poblado por Cleaner)
  quality_score REAL,        -- 0.0 a 1.0 (清洗后的质量)

  -- Metadatos
  source_ids TEXT,          -- TEXT con IDs separados por coma "1,3,5"
  published_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Sync status
  synced INTEGER DEFAULT 0,  -- 1 = publicado
  body TEXT                 -- Contenido completo (cuando se extrae)
);

CREATE INDEX idx_news_location ON news_cards(location_id, published_at DESC);
CREATE INDEX idx_news_category ON news_cards(category, published_at DESC);
CREATE INDEX idx_news_cluster ON news_cards(cluster_id);
```

### Flujo de Calidad

```
quality_score >= 0.7  → Alta calidad, publicable
quality_score 0.3-0.7 → Calidad media, publicable
quality_score < 0.3   → Baja calidad, NO publicable
is_gacetilla = 1      → Propaganda, NO publicable
```

---

## Hermes Crons

### Jobs Activos

| Job | Schedule | Descripción |
|-----|----------|-------------|
| `akira-scout` | `0 */6 * * *` |Descubre fuentes con MiniMax web_search |
| `akira-harvester` | `*/30 * * * *` | Extrae noticias de 959 fuentes |
| `akira-analyst` | `*/15 * * * *` | Clasifica, clusteriza, detecta bias |
| `akira-cleaner` | `7 */15 * * * *` | Filtra calidad, detecta gacetillas |
| `akira-publisher` | `10 */15 * * * *` | Publica a CDN, invalida cache |
| `akira-supervisor` | `30 */6 * * *` | Monitorea pipeline, genera reportes |

### Skills Location

```
~/.hermes/skills/news/
├── akira-scout/SKILL.md        # Descubrimiento de fuentes
├── akira-harvester/SKILL.md    # Extracción (AKIRA → D1)
├── akira-analyst/SKILL.md       # Bias + clustering + categorización
├── akira-cleaner/SKILL.md      # Filtrado de calidad
├── akira-publisher/SKILL.md    # Publicación + cache
├── akira-supervisor/SKILL.md   # Monitoreo + auditoría
└── akira-smart-harvester/SKILL.md  # Scraper generator (experimental)
```

---

## API REST

### Endpoints

```
GET  /api/health                    # Health check
GET  /api/news/feed                 # Lista de noticias paginada
GET  /api/news/:id                  # Detalle de noticia
GET  /api/news/:id/cluster          # Todas las noticias del cluster
GET  /api/locations/tree           # Jerarquía de ubicaciones
GET  /api/categories               # Lista de categorías
POST /api/news/ingest              # Ingestar noticia (auth required)
POST /api/images/upload            # Subir imagen a R2
POST /api/cache/invalidate         # Invalidar cache
GET  /api/stats                    # Estadísticas
POST /api/extract                  # Proxy a AKIRA
```

### Query Params para /api/news/feed

| Param | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `location_id` | int | - | Filtrar por ciudad |
| `category` | string | - | Filtrar por categoría |
| `limit` | int | 20 | Items por página (max 100) |
| `offset` | int | 0 | Para paginación |

---

## Clasificación y Categorización

### Categorías

```
política, economía, deportes, sociedad, judiciales,
culturales, tecnología, internacional, generales
```

### Bias Scale

```
-1.0  → Sesgo fuerte en contra del gobierno
-0.5  → Sesgo moderado en contra
 0.0  → Neutral
+0.5  → Sesgo moderado a favor
+1.0  → Sesgo fuerte a favor del gobierno
```

### Gacetilla Detection

Indicadores de nota pagada disfrazada:
- Elogios excesivos al gobierno
- Quotes oficiales sin crítica
- Adjetivos genéricos positivos (excelente, maravilloso, histórico)
- Sin fuentes de información independientes
- Título promocional ("Intendente inauguró...")

---

## Servicios y Puertos

```bash
# AKIRA (FastAPI)
http://localhost:5000

# API (Hono + Wrangler)
http://localhost:8787

# LM Studio (local inference)
http://localhost:1234
```

### D1 Path Local (Wrangler Dev)
```
/Users/omatic/proyectos/news/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/8e8a3dabd670767f6418dd674222bdf51d4dd12ba4d21c3e90c6bfb084265bb6.sqlite
```

### Local DB Path (Pipeline legacy)
```
/Users/omatic/data/akira.db
```

---

## Quick Start

```bash
# Iniciar todo
./scripts/start.sh

# O individual:
cd packages/akira && python3 run.py          # AKIRA (5000)
cd packages/api && npx wrangler dev         # API (8787)

# Health check
curl http://localhost:5000/health | jq .
curl http://localhost:8787/api/health | jq .

# Ver noticias
curl "http://localhost:8787/api/news/feed?location_id=101&limit=3" \
  -H "X-API-Key: akira-dev-key-change-in-production" | jq .
```

---

## Métricas de Éxito del Pipeline

| Métrica | Target | Actual |
|---------|--------|--------|
| News en D1 | 10,000+ | 8,852 |
| Fuentes activas | 500+ | 959 |
| Bias score asignado | 80%+ | 7% |
| Quality score asignado | 100% | 99% |
| Categoría asignada | 80%+ | 8% |
| Gacetillas detectadas | 50+ | 7 |
| Synced | 100% | 99% |
