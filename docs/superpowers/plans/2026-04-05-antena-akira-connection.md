# Conectar Antena UI con AKIRA DB - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar Antena directamente a la DB de AKIRA para que la UI muestre nombres reales de fuentes, bias calculado, y datos completos.

**Architecture:** Agregar 7 endpoints de lectura a AKIRA (FastAPI, puerto 5000) que lean directo de SQLite. Antena apunta a estos endpoints en desarrollo. La API intermedia (Hono/Cloudflare Workers) se usa solo para producción.

**Tech Stack:** Python/FastAPI (AKIRA), SQLite, TypeScript/Solid.js (Antena), Astro 5

---

## Contexto Crítico

### Estado actual de los datos en AKIRA DB

| Métrica | Valor |
|---------|-------|
| Total news_cards | 4513 |
| Con bias_score = 0.0 | 4503 (99.7%) |
| Con bias_score ≠ 0 | 10 (0.3%) |
| Con source_ids | 4513 (todos, formato CSV: "956,954,73") |
| Con quality_score | ~400 (9%) |
| Con body | 0 (vacío) |
| Fuentes únicas | ~917 |
| Categorías | 9 (generales, sociedad, deportes, tecnología, judiciales, política, internacional, economía, culturales) |

### Problemas a resolver

1. **"Fuente 1"** — `source_ids` es CSV pero el JOIN toma solo el primer ID
2. **Bias muerto** — 99.7% tiene bias_score = 0.0, hay que calcularlo desde sources
3. **Source names** — No hay endpoint para resolver IDs a nombres
4. **Categorías hardcodeadas** — Header y Sidebar no usan API
5. **Sidebar stats vacíos** — API no responde

### Endpoints que Antena consume

| # | Endpoint | Para qué |
|---|----------|----------|
| 1 | `GET /api/news/feed?category=&location_id=&limit=&offset=` | Feed principal |
| 2 | `GET /api/news/:id` | Detalle artículo |
| 3 | `GET /api/news/:id/cluster` | Artículos relacionados |
| 4 | `GET /api/locations/tree` | Dropdown ubicaciones |
| 5 | `GET /api/categories` | Lista categorías |
| 6 | `GET /api/synthesis/master/:clusterId` | Artículo sintetizado |
| 7 | `GET /api/stats/health` | Stats del pipeline |

---

## File Map

### AKIRA (packages/akira/)
- **Modify:** `main.py` — Agregar 7 endpoints bajo prefijo `/api/`
- **No new files** — Todo va en main.py siguiendo el patrón existente

### Antena (packages/antena/)
- **Modify:** `src/lib/api.ts` — Cambiar API_BASE a AKIRA, agregar fallback
- **Modify:** `src/lib/mappers.ts` — Usar source_names array, fix bias mapping
- **Modify:** `src/lib/types.ts` — Agregar campos source_names, location_name
- **Modify:** `src/components/layout/Header.tsx` — Usar categorías de API
- **Modify:** `src/components/layout/Sidebar.tsx` — Usar categorías de API
- **Modify:** `src/components/common/NewsCard.tsx` — Mostrar bias bar real

---

## Task 1: Agregar endpoints de lectura a AKIRA

**Files:**
- Modify: `packages/akira/main.py` (agregar al final, antes del admin dashboard)

- [ ] **Step 1.1: Agregar sección de endpoints para Antena en main.py**

Agregar al final de `main.py` (antes de los admin endpoints, línea ~880):

```python
# ═══════════════════════════════════════════
# ANTENA API ENDPOINTS (read-only, SQLite)
# ═══════════════════════════════════════════

def get_db_connection():
    """Get SQLite connection with row factory."""
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    return conn


def resolve_source_names(source_ids_csv: str) -> list:
    """Resolve comma-separated source IDs to names."""
    if not source_ids_csv:
        return []
    conn = get_db_connection()
    ids = [int(x.strip()) for x in source_ids_csv.split(',') if x.strip().isdigit()]
    if not ids:
        conn.close()
        return []
    placeholders = ','.join('?' * len(ids))
    rows = conn.execute(
        f"SELECT id, name FROM sources WHERE id IN ({placeholders})", ids
    ).fetchall()
    conn.close()
    name_map = {row['id']: row['name'] for row in rows}
    return [name_map.get(sid, f"Fuente {sid}") for sid in ids]


def calculate_cluster_bias(source_ids_csv: str) -> float:
    """Calculate bias from source avg_bias values."""
    if not source_ids_csv:
        return 0.0
    conn = get_db_connection()
    ids = [int(x.strip()) for x in source_ids_csv.split(',') if x.strip().isdigit()]
    if not ids:
        conn.close()
        return 0.0
    placeholders = ','.join('?' * len(ids))
    rows = conn.execute(
        f"SELECT avg_bias FROM sources WHERE id IN ({placeholders}) AND avg_bias IS NOT NULL", ids
    ).fetchall()
    conn.close()
    biases = [row['avg_bias'] for row in rows if row['avg_bias'] is not None]
    if biases:
        return sum(biases) / len(biases)
    return 0.0


def format_news_card(row) -> dict:
    """Format a news card row for the API response."""
    source_ids = row['source_ids'] or ''
    source_names = resolve_source_names(source_ids)
    sources_count = len([x for x in source_ids.split(',') if x.strip()]) if source_ids else 1

    # Use real bias or calculate from sources
    bias_score = row['bias_score'] or 0.0
    if bias_score == 0.0:
        bias_score = calculate_cluster_bias(source_ids)

    return {
        'id': row['id'],
        'location_id': row['location_id'],
        'title': row['title'],
        'summary': row['summary'],
        'body': row.get('body') or row['summary'],
        'image_url': row['image_url'],
        'bias_score': bias_score,
        'is_gacetilla': row['is_gacetilla'] or 0,
        'cluster_id': row['cluster_id'],
        'category': row['category'],
        'source_ids': source_ids,
        'source_names': source_names[:3],  # Top 3 sources
        'source_name': source_names[0] if source_names else None,
        'location_name': None,  # Will be populated if location_id exists
        'location_province': None,
        'published_at': row['published_at'],
        'created_at': row['created_at'],
        'sources_count': sources_count,
        'quality_score': row.get('quality_score'),
    }
```

- [ ] **Step 1.2: Agregar endpoint GET /api/news/feed**

```python
@app.get("/api/news/feed")
async def get_news_feed(
    category: str = None,
    location_id: int = None,
    limit: int = 20,
    offset: int = 0
):
    """Paginated news feed with filters."""
    conn = get_db_connection()

    query = """
        SELECT nc.*, l.name as location_name, l.province as location_province
        FROM news_cards nc
        LEFT JOIN locations l ON l.id = nc.location_id
        WHERE 1=1
    """
    params = []

    if category:
        query += " AND nc.category = ?"
        params.append(category)
    if location_id:
        query += " AND nc.location_id = ?"
        params.append(location_id)

    # Count total
    count_query = query.replace("SELECT nc.*", "SELECT COUNT(*) as count")
    total = conn.execute(count_query, params).fetchone()['count']

    # Fetch page
    query += " ORDER BY nc.created_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    rows = conn.execute(query, params).fetchall()
    conn.close()

    news = []
    for row in rows:
        card = format_news_card(row)
        card['location_name'] = row['location_name']
        card['location_province'] = row['location_province']
        news.append(card)

    return {
        'news': news,
        'total': total,
        'page': (offset // limit) + 1 if limit > 0 else 1,
        'per_page': limit,
        'location': None,
        'category': category,
    }
```

- [ ] **Step 1.3: Agregar endpoint GET /api/news/:id**

```python
@app.get("/api/news/{news_id}")
async def get_news_by_id(news_id: str):
    """Single news card by ID."""
    conn = get_db_connection()
    row = conn.execute("""
        SELECT nc.*, l.name as location_name, l.province as location_province
        FROM news_cards nc
        LEFT JOIN locations l ON l.id = nc.location_id
        WHERE nc.id = ?
    """, (news_id,)).fetchone()
    conn.close()

    if not row:
        return {'error': 'Not found'}

    card = format_news_card(row)
    card['location_name'] = row['location_name']
    card['location_province'] = row['location_province']
    return card
```

- [ ] **Step 1.4: Agregar endpoint GET /api/news/:id/cluster**

```python
@app.get("/api/news/{news_id}/cluster")
async def get_news_cluster(news_id: str):
    """All news cards in the same cluster."""
    conn = get_db_connection()

    # Get cluster_id first
    news_row = conn.execute("SELECT cluster_id FROM news_cards WHERE id = ?", (news_id,)).fetchone()
    if not news_row or not news_row['cluster_id']:
        conn.close()
        return {'error': 'Not found or no cluster'}

    cluster_id = news_row['cluster_id']

    # Get all news in cluster
    rows = conn.execute("""
        SELECT nc.*, l.name as location_name, l.province as location_province
        FROM news_cards nc
        LEFT JOIN locations l ON l.id = nc.location_id
        WHERE nc.cluster_id = ?
        ORDER BY nc.created_at DESC
    """, (cluster_id,)).fetchall()
    conn.close()

    news = []
    for row in rows:
        card = format_news_card(row)
        card['location_name'] = row['location_name']
        card['location_province'] = row['location_province']
        news.append(card)

    return {
        'cluster_id': cluster_id,
        'news': news,
    }
```

- [ ] **Step 1.5: Agregar endpoint GET /api/locations/tree**

```python
@app.get("/api/locations/tree")
async def get_locations_tree():
    """All locations ordered by type, province, name."""
    conn = get_db_connection()
    rows = conn.execute("SELECT * FROM locations ORDER BY type, province, name").fetchall()
    conn.close()
    return [dict(r) for r in rows]
```

- [ ] **Step 1.6: Agregar endpoint GET /api/categories**

```python
@app.get("/api/categories")
async def get_categories():
    """All categories with icons."""
    category_icons = {
        'generales': 'article',
        'sociedad': 'groups',
        'deportes': 'sports_soccer',
        'tecnología': 'devices',
        'judiciales': 'gavel',
        'política': 'gavel',
        'internacional': 'public',
        'economía': 'trending_up',
        'culturales': 'theater_comedy',
    }

    conn = get_db_connection()
    rows = conn.execute("""
        SELECT DISTINCT category, COUNT(*) as count
        FROM news_cards
        WHERE category IS NOT NULL AND category != ''
        GROUP BY category
        ORDER BY count DESC
    """).fetchall()
    conn.close()

    categories = []
    for i, row in enumerate(rows):
        cat_name = row['category']
        categories.append({
            'id': i + 1,
            'slug': cat_name.lower().replace(' ', '-'),
            'name': cat_name.capitalize(),
            'icon': category_icons.get(cat_name.lower(), 'article'),
        })

    return categories
```

- [ ] **Step 1.7: Agregar endpoint GET /api/stats/health**

```python
@app.get("/api/stats/health")
async def get_stats_health():
    """Pipeline health stats."""
    conn = get_db_connection()

    total_news = conn.execute("SELECT COUNT(*) as count FROM news_cards").fetchone()['count']
    active_sources = conn.execute("SELECT COUNT(*) as count FROM sources WHERE is_active = 1").fetchone()['count']
    total_locations = conn.execute("SELECT COUNT(*) as count FROM locations").fetchone()['count']
    news_last_hour = conn.execute(
        "SELECT COUNT(*) as count FROM news_cards WHERE created_at > datetime('now', '-1 hour')"
    ).fetchone()['count']

    conn.close()

    return {
        'status': 'ok',
        'stats': {
            'total_news': total_news,
            'active_sources': active_sources,
            'total_locations': total_locations,
            'news_last_hour': news_last_hour,
        },
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
    }
```

- [ ] **Step 1.8: Agregar endpoint GET /api/sources**

```python
@app.get("/api/sources")
async def get_sources():
    """List all active sources with bias info."""
    conn = get_db_connection()
    rows = conn.execute("""
        SELECT id, name, url, domain, avg_bias, news_count, is_active, reliability_score
        FROM sources
        WHERE is_active = 1
        ORDER BY news_count DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]
```

---

## Task 2: Conectar Antena a AKIRA

**Files:**
- Modify: `packages/antena/src/lib/api.ts`

- [ ] **Step 2.1: Cambiar API_BASE para apuntar a AKIRA**

En `src/lib/api.ts`, cambiar:

```typescript
const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as any).env?.PUBLIC_API_BASE) || 'http://localhost:5000';
```

Cambiar de `8787` a `5000` (AKIRA directo).

- [ ] **Step 2.2: Agregar fallback para fetchStats**

En `src/lib/api.ts`, modificar `fetchStats`:

```typescript
export async function fetchStats(): Promise<StatsResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/stats/health`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
  } catch {
    return {
      status: 'ok',
      stats: { total_news: 0, active_sources: 0, total_locations: 0, news_last_hour: 0 },
    };
  }
}
```

---

## Task 3: Fix mappers para usar datos reales

**Files:**
- Modify: `packages/antena/src/lib/mappers.ts`
- Modify: `packages/antena/src/lib/api.ts` (ApiNewsCard interface)

- [ ] **Step 3.1: Agregar campos a ApiNewsCard interface**

En `src/lib/api.ts`, agregar a `ApiNewsCard`:

```typescript
export interface ApiNewsCard {
  id: string;
  location_id: number;
  title: string;
  summary: string;
  body?: string;
  image_url: string | null;
  bias_score: number | null;
  is_gacetilla: number;
  cluster_id: string | null;
  category: string | null;
  source_ids: string | null;
  source_names?: string[];
  source_name?: string | null;
  location_name?: string | null;
  location_province?: string | null;
  published_at: string | null;
  created_at: string;
  sources_count?: number;
  quality_score?: number | null;
}
```

- [ ] **Step 3.2: Fix mapNewsCard para usar source_names**

En `src/lib/mappers.ts`, modificar `mapNewsCard`:

```typescript
export function mapNewsCard(card: ApiNewsCard): NewsItem {
  const bias = mapBias(card.bias_score);
  const sourceCount = card.sources_count || (card.source_ids ? card.source_ids.split(',').filter(Boolean).length : 1);
  const signalLevel = computeSignalLevel(card.source_ids);

  // Use source_names from API, fallback to source_name, fallback to ID
  let sourceName = 'Fuente';
  if (card.source_names && card.source_names.length > 0) {
    sourceName = card.source_names[0];
  } else if (card.source_name) {
    sourceName = card.source_name;
  } else if (card.source_ids) {
    const srcId = card.source_ids.split(',')[0].trim();
    sourceName = SOURCE_NAMES[srcId] || `Fuente ${srcId}`;
  }

  // Use location from API
  let location = '';
  if (card.location_name) {
    location = card.location_province
      ? `${card.location_name}, ${card.location_province}`
      : card.location_name;
  }

  const category = card.category || extractCategory(card.title);

  return {
    id: card.id,
    title: card.title,
    summary: stripHtml(card.summary),
    body: stripHtml(card.body || card.summary),
    category,
    source: sourceName,
    time: formatTime(card.published_at || card.created_at),
    location,
    bias: bias.label,
    biasColor: bias.color,
    signalLevel,
    isGacetilla: card.is_gacetilla === 1,
    gacetillaConf: card.is_gacetilla === 1 ? 70 : undefined,
    isClickbait: false,
    clusterId: card.cluster_id || '',
    sourcesCount: sourceCount,
    imageUrl: card.image_url || undefined,
    publishedAt: card.published_at || card.created_at,
    voices: computeVoices(card.bias_score, sourceCount),
    propagation: [],
  };
}
```

---

## Task 4: Fix Header y Sidebar para usar categorías de API

**Files:**
- Modify: `packages/antena/src/components/layout/Header.tsx`
- Modify: `packages/antena/src/components/layout/Sidebar.tsx`

- [ ] **Step 4.1: Header usa categorías de API**

En `Header.tsx`, cambiar las categorías hardcodeadas para que acepte props:

```typescript
interface HeaderProps {
  activeCategory: string;
  onCategoryChange: (cat: string) => void;
  onSearch: (query: string) => void;
  categories?: { name: string; icon: string; slug: string }[];
}
```

Y en el render, usar `props.categories` si existe, sino fallback a hardcodeadas.

- [ ] **Step 4.2: Sidebar usa categorías de API**

En `Sidebar.tsx`, agregar prop `categories` y usarla en la sección "Temas" en lugar de importar `CATEGORIES` de types.ts.

---

## Task 5: Fix NewsCard para mostrar bias bar real

**Files:**
- Modify: `packages/antena/src/components/common/NewsCard.tsx`

- [ ] **Step 5.1: NewsCard muestra bias bar con datos reales**

El NewsCard ya tiene la bias bar. Verificar que usa `props.news.voices` correctamente y que muestra los porcentajes reales del cluster.

---

## Task 6: Test end-to-end

- [ ] **Step 6.1: Iniciar AKIRA**

```bash
cd packages/akira && python -m uvicorn main:app --host 0.0.0.0 --port 5000
```

- [ ] **Step 6.2: Verificar endpoints**

```bash
curl http://localhost:5000/api/news/feed?limit=3 | jq '.news[0].source_names'
curl http://localhost:5000/api/stats/health | jq .
curl http://localhost:5000/api/categories | jq .
```

- [ ] **Step 6.3: Iniciar Antena**

```bash
cd packages/antena && pnpm dev
```

- [ ] **Step 6.4: Verificar en browser**

- Fuentes muestran nombres reales (no "1")
- Stats del sidebar muestran datos reales
- Categorías coinciden con las de la DB
- Bias bar muestra distribución real

---

## Métricas de Éxito

| Antes | Después |
|-------|---------|
| "Fuente 1" o ID numérico | "Sitio Andino, MDZ Online" |
| 0.3% con bias real | Bias calculado desde sources |
| Stats vacíos | Datos reales de AKIRA |
| Categorías hardcodeadas | De la DB |

---

## Deuda Técnica Identificada

| # | Item | Solución futura |
|---|------|-----------------|
| TD-01 | bias_score = 0.0 para 99.7% | Pipeline de Analyst debe calcularlo |
| TD-02 | body vacío en todas las noticias | Extractores deben guardar body completo |
| TD-03 | avg_bias en sources está vacío | Calcular al procesar noticias |
| TD-04 | No hay clickbait detection | Feature nueva en AKIRA |
| TD-05 | No hay propagation data | Requiere tracking de cuándo cada fuente publica |

---

*Plan generado el 2026-04-05. 6 tasks, ~25 steps.*