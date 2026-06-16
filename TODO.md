# AKIRA / Antena — TODO

Última actualización: 2026-06-16 15:30 ART

---

## 📊 Status actual (sesión)

| Métrica | Valor | Δ desde inicio |
|---------|-------|-----------------|
| Pueblos +4000 hab | 851 | — |
| **Pueblos con media** | **576 (67%)** | +336 |
| Medios en directorio | 1953 | +1135 |
| Sources AKIRA | 1100 | +22 |
| Sources con RSS | 707 | +51 |
| master_articles | 181/905 | +1 hoy (commit fix funciona) |
| Background jobs | 3 | synth M4+M5 + link_sources |

---

## 🔴 EN PROGRESO (background, no tocar)

- [ ] **rag_synthesize M4** — M4:60/905 ok=58 (qwen3.5-2b, localhost:1234)
- [ ] **rag_synthesize M5** — M5:85/905 ok=84 (unsloth/qwen3.5-2b, 192.168.31.37:1234)
- [ ] **link_to_sources** — descubriendo RSS para 500 radios restantes (en background)

> Commits funcionando: `commit_attempt batch=10` → `commit_done wrote=10` ✓

---

## 🟡 PENDIENTE — COBERTURA (foco)

### Módulo 1 expansión
- [ ] **ENACOM scraping** — registro público de radios AM/FM licenciadas. URL: enacom.gob.ar/busqueda/radio (HTML, no API — necesita scraper)
- [ ] **Wikipedia API discovery** — buscar en español "Radio X" / "Diario X" por pueblo. **API funciona, queries confiables**
- [ ] **Facebook public search** — pueblos chicos tienen páginas FB; limitada sin Graph API
- [ ] **datos.gob.ar radio dataset** — JSON no disponible, buscar CSV

### Módulo 2 — extractores de contenido
- [ ] **Whisper transcribe** — streams de radio (audio en vivo → texto). Deferred: requiere GPU
- [ ] **Facebook Graph** — posts de páginas públicas. Requiere app + token
- [ ] **Instagram public** — scraping básico de posts

### Módulo 3 — descubrimiento de fuentes
- [ ] **Citation mining v2** — parsear HTML de las 22 fuentes linkeadas para descubrir diarios citados
- [ ] **Recursive crawl** — nueva fuente → crawl su sitio → descubrir más fuentes

### Módulo 4 — indexing
- [ ] **Astro build** con sitemaps nuevos (24 + index)
- [ ] **Deploy a Pages**
- [ ] **Validar Search Console**

---

## 🟢 COMPLETADO hoy

### Módulo 0 — Pueblos
- [x] 851 pueblos de INDEC 2022 +4000 hab en `argentine_towns`

### Módulo 1 — Directorio
- [x] random-radio import: 818 radios → 240 pueblos
- [x] CITY_ALIASES: GBA partidos + aglomerados
- [x] GNews RSS: 1079 nuevos medios
- [x] GNews2 paralelo: 200x speedup, confirmó techo ~67% (pueblos chicos no tienen local media)

### Módulo 2 — Extractores
- [x] 22 fuentes linkeadas con RSS auto-discovery
- [x] link_to_sources.py con HTML link + path probe (40% éxito RSS)

### Módulo 3 — Citation
- [x] citation-mining: 18 medios (agencias, TV nacional)

### Módulo 4 — Sitemaps
- [x] sitemap-province endpoint en API
- [x] 24 sitemaps Astro por provincia
- [x] sitemap-index.xml agregado
- [x] contentLocation JSON-LD en artículos
- [x] robots.txt con sitemap-index

### Módulo 5 — Provincial
- [x] curate_provincial.py: 38 radios/diarios provinciales hand-picked

### Bugs arreglados
- [x] INDEC CODGL zero-padding (6 dígitos)
- [x] `province` nullable en `argentine_media`
- [x] RAG_MODEL hardcoded → ahora configurable via `--model`
- [x] DB lock con autocommit + busy_timeout=30s
- [x] Commit retry con backoff 2s/4s/8s
- [x] LM Studio server restart via CLI (`lms server start`)

---

## ⏳ BACKLOG (próximas sesiones)

- [ ] **Re-cosechar fuentes** con `harvest_run.py` para las 1100 sources
- [ ] **Push a D1** (`sync_to_d1.py` + `sync_to_d1_remote.py`) — 1100 sources × clusters
- [ ] **Astro build + deploy**
- [ ] **Search LLM** — reemplazar FTS5-only con RAG sobre news_cards
- [ ] **On-demand synthesis endpoint** — ya existe en AKIRA, no expuesto vía API
- [ ] **Bias scoring de medios** — usar `bias-analyzer.ts` con los 1953 medios

---

## 📁 Archivos creados en esta sesión

```
packages/akira/core/coverage/__init__.py               # módulo compartido
packages/akira/scripts/media/import_random_radio.py   # import radios
packages/akira/scripts/media/link_to_sources.py       # RSS auto-discovery
packages/akira/scripts/media/discover_via_gnews.py    # GNews RSS
packages/akira/scripts/media/discover_via_gnews2.py   # parallel pass
packages/akira/scripts/media/discover_via_citation.py # regex mining
packages/akira/scripts/media/curate_provincial.py     # hand-picked
packages/akira/scripts/rag_synthesize.py              # +autocommit +retry fix
packages/api/src/routes/sitemap-province.ts           # XML endpoint
packages/antena/src/pages/sitemap-[province].xml.astro # 24 pages
packages/antena/src/pages/sitemap-index.xml.astro      # index
TODO.md                                                 # este archivo
```

---

## ⚙️ Comandos útiles

```bash
# Cobertura: descubrir medios por pueblo
python -m scripts.media.discover_via_gnews        # 1ra pasada
python -m scripts.media.discover_via_gnews2       # 2da paralela

# Linkear media a sources (RSS discovery)
python -m scripts.media.link_to_sources --limit 500

# Re-synthesis (background)
AKIRA_LMSTUDIO_NODES=http://localhost:1234 \
  python -m scripts.rag_synthesize --model qwen3.5-2b --no-skip-existing --workers 1
AKIRA_LMSTUDIO_NODES=http://192.168.31.37:1234 \
  python -m scripts.rag_synthesize --model unsloth/qwen3.5-2b --no-skip-existing --workers 1

# Harvest (background)
python harvest_run.py

# Push a D1
python scripts/sync_to_d1.py && python scripts/sync_to_d1_remote.py
```

---

## 🧭 Plan sugerido — próximas 2 horas

1. **Cobertura**: Wikipedia API discovery → expandir a los 275 pueblos sin media
2. **Curated v2**: +30 radios/diarios provinciales que faltan
3. **Verify**: Astro build con sitemaps nuevos funciona
4. **Background**: synth + link_to_sources + harvest siguen
