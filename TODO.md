# AKIRA / Antena — TODO

Última actualización: 2026-06-16 17:15 ART

---

## 📊 Status actual (sesión)

| Métrica | Valor | Δ desde inicio |
|---------|-------|-----------------|
| **Pueblos en DB** | **1663** | +812 (851 → 1663) |
| Pueblos con media directa | 581 (35%) | +5 hoy |
| Pueblos con indirect (provincial) | 1663 (100%) | +812 |
| **Medios en directorio** | **2022** | +1069 hoy |
| Sources AKIRA | 1100 | +22 |
| Sources con RSS | 707 | +51 |
| **master_articles** | **300/905** | +120 hoy (en background) |
| Background jobs | 4 | synth M4+M5 + link + gnews |

---

## 🔴 EN BACKGROUND (no tocar)

- [ ] **rag_synthesize M4** — 325/905 ok=319 (qwen3.5-2b, localhost:1234)
- [ ] **rag_synthesize M5** — retry con backoff funcionando (unsloth/qwen3.5-2b, 192.168.31.37:1234)
- [ ] **link_to_sources v6** — encontrando RSS feeds para nuevos pueblos
- [ ] **discover_via_gnews v5** — procesando pueblos 500-1000 hab (silencioso, no encuentran)

> Commit fix funcionando: `commit_attempt batch=10 success=320` → `commit_done wrote=10` ✓

---

## 🟢 COMPLETADO en esta sesión (expansión)

### Módulo 0 — Pueblos expandido
- [x] **851 → 1663 pueblos** (incluye 2000-1000 hab)
- [x] 2 capitales faltantes: **Río Gallegos** y **Santiago del Estero** agregados
- [x] INDEC CSV + georef API batch

### Módulo 1 — Directorio
- [x] random-radio: 818 → 818 (sin cambios hoy)
- [x] google-news-rss: 1079 → 1080
- [x] curated-provincial: 38 → 100 (Catamarca + La Pampa específicos)
- [x] citation-mining: 18
- [x] municipal-site: 1

### Módulo 4 — Indexing
- [x] 24 sitemaps por provincia
- [x] sitemap-index.xml
- [x] contentLocation JSON-LD

### Bugs arreglados
- [x] INDEC CODGL zero-padding (6 dígitos)
- [x] `province` nullable en `argentine_media`
- [x] RAG_MODEL hardcoded → configurable via `--model`
- [x] DB lock con autocommit + busy_timeout=30s
- [x] Commit retry con backoff 2s/4s/8s
- [x] **curate_provincial** bug: pasaba `province=None` siempre
- [x] LM Studio server restart via CLI (`lms server start`)

---

## ⏳ BACKLOG (próximas sesiones)

- [ ] **Más pueblos** — bajar a 100-500 hab (hay ~600 más)
- [ ] **Más medios por pueblo** — los nuevos pueblos chicos tienen solo 1-2 medios
- [ ] **Build + deploy** sitemaps con `astro build` y `wrangler deploy`
- [ ] **Push D1** — 1100 sources × clusters
- [ ] **On-demand synthesis** — endpoint AKIRA no expuesto
- [ ] **Search LLM** — reemplazar FTS5 con RAG
- [ ] **Bias scoring** de medios nuevos
- [ ] **Whisper** — streams de radio (deferred, requiere GPU)

---

## 📁 Archivos creados en esta sesión

```
packages/akira/core/coverage/__init__.py              # módulo compartido
packages/akira/scripts/media/import_random_radio.py
packages/akira/scripts/media/link_to_sources.py
packages/akira/scripts/media/discover_via_gnews.py
packages/akira/scripts/media/discover_via_gnews2.py
packages/akira/scripts/media/discover_via_citation.py
packages/akira/scripts/media/curate_provincial.py
packages/akira/scripts/media/backfill_curated_provinces.py
packages/akira/scripts/media/discover_via_municipal.py
packages/api/src/routes/sitemap-province.ts
packages/antena/src/pages/sitemap-[province].xml.astro
packages/antena/src/pages/sitemap-index.xml.astro
TODO.md
```

---

## ⚙️ Comandos

```bash
# Cobertura
python -m scripts.media.discover_via_gnews --min-pop 500
python -m scripts.media.curate_provincial
python -m scripts.media.backfill_curated_provinces

# Re-synthesis (background)
AKIRA_LMSTUDIO_NODES=http://localhost:1234 \
  python -m scripts.rag_synthesize --model qwen3.5-2b --no-skip-existing --workers 1
AKIRA_LMSTUDIO_NODES=http://192.168.31.37:1234 \
  python -m scripts.rag_synthesize --model unsloth/qwen3.5-2b --no-skip-existing --workers 1
```

---

## 📈 Progreso de la sesión

| Hora | Acción | Δ |
|------|--------|---|
| Inicio | 240/851 (28%) pueblos | start |
| +30min | random-radio import + GNews | 576/851 (67%) |
| +1h | curated v1 + backfill (96% indirect) | 851/851 (100%) |
| +1.5h | curated v2 + sitemaps + contentLocation | 2022 medios |
| +2h | curated v3 Catamarca/La Pampa | 100 curated |
| +2.5h | 2 capitales + 812 pueblos nuevos | 1663 pueblos, 2022 medios |
| **ahora** | synth 300/905 + link RSS ongoing | master_articles +120 |
