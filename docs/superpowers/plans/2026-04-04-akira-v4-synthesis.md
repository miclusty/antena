# AKIRA v4.0 — The Synthesis Engine

> **Date:** 2026-04-04  
> **Vision:** De 54 fuentes → 1 noticia neutral con espectro de sesgo visible  
> **Status:** In Progress

---

## 1. What's Done (v3.2)

| Component | Status |
|-----------|--------|
| 10 extractors (RSS, WP, Newspaper, Goose, Sitemap, Playwright, Jina, Video, Social, Google News) | ✅ |
| Delta extraction (seen_urls, last_harvest_at) | ✅ |
| Unified SQLite DB (akira.db) | ✅ |
| 1061 sources, 4513 news_cards, 4037 localities | ✅ |
| 112 tests passing | ✅ |
| Scout v11.0 with intelligent rotation | ✅ |
| All Hermes skills pointing to akira.db | ✅ |
| Method learning + weighted scoring | ✅ |
| Source recovery / auto-healing | ✅ |

---

## 2. What's Next

### Priority 1: AKIRA Synthesis — "La Noticia Maestra" ⭐

**El quid del proyecto.** Cuando 54 fuentes cubren la misma noticia → UNA versión neutral + espectro de sesgo.

| # | Task | Effort | Status |
|---|------|--------|--------|
| 1.1 | Nueva tabla `master_articles` | 15min | ⬜ |
| 1.2 | Fact extraction engine (sin IA, regex + conteo) | 3h | ⬜ |
| 1.3 | Synthesis endpoint (`POST /cluster/:id/synthesize`) | 3h | ⬜ |
| 1.4 | Batch synthesis para 4,019 clusters existentes | 2h | ⬜ |
| 1.5 | Auto-synthesis para nuevos clusters | 2h | ⬜ |
| 1.6 | UI: espectro de sesgo en Antena | 4h | ⬜ |

**Total: ~14.5h**

### Priority 2: Harvester con Delta Extraction

| # | Task | Effort | Status |
|---|------|--------|--------|
| 2.1 | Actualizar skill `akira-harvester` para delta extraction | 1h | ⬜ |
| 2.2 | Verificar `seen_urls` se actualiza en cada harvest | 30min | ⬜ |
| 2.3 | Verificar `last_harvest_at` se actualiza | 30min | ⬜ |
| 2.4 | Test end-to-end | 1h | ⬜ |

**Total: 3h**

### Priority 3: Monitoreo de Errores

| # | Task | Effort | Status |
|---|------|--------|--------|
| 3.1 | Endpoint `GET /admin/dashboard` | 2h | ⬜ |
| 3.2 | Endpoint `GET /admin/failed-sources` | 1h | ⬜ |
| 3.3 | Endpoint `GET /admin/stats` | 1h | ⬜ |
| 3.4 | Auto-alert: log warning cuando source_health > 5 fallos | 1h | ⬜ |
| 3.5 | Simple HTML dashboard | 2h | ⬜ |

**Total: 7h**

### Priority 4: Imágenes

| # | Task | Effort | Status |
|---|------|--------|--------|
| 4.1 | Verificar que `image_url` se extrae correctamente | 30min | ⬜ |
| 4.2 | Validar URLs de imagen (que no estén rotas) | 1h | ⬜ |

**Total: 1.5h**

---

## 3. Architecture: The Synthesis Engine

```
Cluster de 54 fuentes sobre la misma noticia
    ↓
┌─────────────────────────────────────────┐
│ 1. FACT EXTRACTION (sin IA, ~50ms)      │
│    - Hechos verificados (≥3 fuentes)    │
│    - Claims disputados (1-2 fuentes)    │
│    - Entidades clave (nombres, cifras)  │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ 2. PERSPECTIVE SUMMARY (sin IA, ~20ms)  │
│    - Qué dicen oficialistas             │
│    - Qué dicen opositores               │
│    - Qué dicen neutrales                │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ 3. SYNTHESIS (MiniMax, ~30s, ~$0.01)    │
│    Genera artículo neutral              │
│    Cita perspectivas múltiples          │
│    Marca lo disputado                   │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ 4. USER PRESENTATION (Antena)           │
│    - Artículo maestro neutral            │
│    - Espectro de sesgo visual            │
│    - "Qué dice cada lado"                │
└─────────────────────────────────────────┘
```

### Database Schema: `master_articles`

```sql
CREATE TABLE master_articles (
    id TEXT PRIMARY KEY,
    cluster_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    verified_facts TEXT,        -- JSON array
    disputed_claims TEXT,       -- JSON array
    officialist_perspective TEXT,
    opposition_perspective TEXT,
    neutral_perspective TEXT,
    sources_count INTEGER DEFAULT 0,
    bias_min REAL,
    bias_max REAL,
    bias_avg REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### User Experience (Antena)

```
┌─────────────────────────────────────────────┐
│  📰 Noticia Sintetizada por AKIRA           │
│                                             │
│  El Concejo aprobó el presupuesto 2026      │
│  con 18 votos a favor y 2 en contra         │
│                                             │
│  El presupuesto destina 40% a obra pública  │
│  y 25% a educación. La oposición cuestionó  │
│  que no incluye partidas para hospitales.   │
│                                             │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  📊 54 fuentes cubren esta noticia          │
│                                             │
│  ◀───┼────┼────┼────┼────┼────┼────▶       │
│  Anti       Neutral       Pro               │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                             │
│  🔵 19 fuentes neutrales: "Aprobación       │
│     con consenso en obra pública"           │
│                                             │
│  🔴 20 fuentes oficialistas: "Histórica     │
│     inversión en infraestructura"           │
│                                             │
│  🟡 15 fuentes opositoras: "Presupuesto     │
│     sin partidas para hospitales"           │
│                                             │
│  [Ver las 54 fuentes originales →]          │
└─────────────────────────────────────────────┘
```

---

## 4. Timeline

| Semana | Qué | Outcome |
|--------|-----|---------|
| **Semana 1** | Priority 1 (Synthesis) | Clusters existentes tienen master articles |
| **Semana 2** | Priority 2 + 3 + 4 | Harvester optimizado + monitoreo + imágenes |
| **Semana 3** | Priority 1.6 (Antena UI) | Espectro de sesgo visible en Antena |

---

*Plan created 2026-04-04. Implementation in progress.*
