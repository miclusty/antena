# AKIRA + Antena — Next Steps Plan

> **Date:** 2026-04-04  
> **Status:** Draft  
> **Scope:** Production-readiness roadmap from current v3.2 state

---

## 1. What's Done

### AKIRA Extraction Engine (v3.2 — port 5000)
| Component | Status |
|-----------|--------|
| 10 extractors (RSS, WP API, Newspaper, Goose, Sitemap, Playwright, Jina, Video, Social, Google News) | ✅ All updated with db_path/source_id params |
| Intelligent cascade with method learning + weighted scoring | ✅ |
| Delta extraction (seen_urls, last_harvest_at) | ✅ |
| Source recovery / auto-healing service | ✅ |
| Rate limiting, circuit breaker, cache, GC | ✅ |
| Health monitor + auto-heal | ✅ |
| Prometheus metrics endpoint | ✅ |
| 112 tests passing | ✅ |
| Unified SQLite DB (akira.db) | ✅ |
| 1061 sources registered | ✅ (+70 from Scout v11.0) |
| 4513 news_cards | ✅ |
| 3921 localities (from official gov API data/cp.json) | ✅ |
| 1230 seen URLs tracked | ✅ |

### API Layer (Hono — port 8787)
| Component | Status |
|-----------|--------|
| News feed endpoints (feed, by id, by cluster) | ✅ |
| KV cache for feeds and articles | ✅ |
| Ingest route for AKIRA → API sync | ✅ |
| Locations + categories routes | ✅ |
| Extract-unified proxy to AKIRA | ✅ |
| Stats, images, RSS, sitemap routes | ✅ |
| CORS configured for akira.ar + localhost | ✅ |

### Antena Frontend (Astro + Solid.js — port 4321)
| Component | Status |
|-----------|--------|
| Magazine-style layout (v6) | ✅ |
| Header, Tabs, Hero, Section, Card components | ✅ |
| Solid.js islands (interactive) | ✅ |
| Static data (lib/data.ts) — **not yet connected to live API** | ⚠️ |
| Location pages (/ubicacion/) | ✅ (structure exists) |
| Noticia pages (article view) | ✅ (structure exists) |
| 404 page | ✅ |
| llm.astro (LLM-friendly page) | ✅ |

### Hermes Skills
| Skill | DB Target |
|-------|-----------|
| akira-scout | akira.db ✅ |
| akira-harvester | akira.db ✅ |
| akira-analyst | akira.db ✅ |
| akira-cleaner | akira.db ✅ |
| akira-publisher | akira.db ✅ |
| akira-supervisor | akira.db ✅ |
| akira-smart-harvester | akira.db ✅ |
| akira-d1-harvest | akira.db ✅ |

---

## 2. What's Next (Prioritized)

### Priority 1 — Connect Antena to Live Data (Highest Impact)
**Why:** Frontend currently uses static mock data. Connecting to the API is the single most impactful change — it turns the project from a demo into a working product.

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 1.1 | Replace static lib/data.ts with API fetch in index.astro | 2h | 1.2 |
| 1.2 | Ensure API `/api/news/feed` works end-to-end with akira.db data | 1h | — |
| 1.3 | Add SSR data loading to index.astro (fetch from API at build/SSR time) | 2h | 1.2 |
| 1.4 | Connect ubicacion/[slug].astro to API with location_id filter | 3h | 1.2 |
| 1.5 | Connect noticia/[slug].astro to API for article detail | 2h | 1.2 |
| 1.6 | Add loading states + error fallbacks to all pages | 2h | 1.3, 1.4, 1.5 |

**Total: ~12h**

### Priority 2 — Data Quality & Content Pipeline
**Why:** 1061 sources but only 4513 news_cards means ~4.2 articles/source. Need to improve harvest coverage and content quality.

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 2.1 | Run full harvest cycle on all 1061 sources (batch) | 4h | — |
| 2.2 | Implement scheduled harvest (cron / systemd timer / GitHub Actions) | 3h | 2.1 |
| 2.3 | Bias detection + clustering pipeline (Analyst skill) | 6h | — |
| 2.4 | Cleaner pipeline: filter press releases, obituaries, spam | 4h | — |
| 2.5 | Image pipeline: download + optimize + store in R2 (or local) | 6h | — |
| 2.6 | Source health dashboard: visualize which sources are alive/dead | 4h | — |

**Total: ~27h**

### Priority 3 — API Hardening
**Why:** API is the bridge between AKIRA and Antena. Needs to be robust for production.

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 3.1 | Add API rate limiting (Hono middleware) | 2h | — |
| 3.2 | Add request validation + error handling middleware | 2h | — |
| 3.3 | Implement pagination with cursor (not offset) for news feed | 3h | — |
| 3.4 | Add search endpoint (full-text search on D1 FTS5) | 4h | — |
| 3.5 | Add caching headers (Cache-Control, ETag) | 1h | — |
| 3.6 | API versioning (/api/v1/...) | 1h | — |

**Total: ~13h**

### Priority 4 — Antena UX & Features
**Why:** Once connected to live data, the frontend needs polish and key features.

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 4.1 | Infinite scroll / load more on news feed | 3h | 1.3 |
| 4.2 | Category filtering (politics, sports, culture, etc.) | 2h | 1.3 |
| 4.3 | City selector / geolocation | 3h | 1.4 |
| 4.4 | Dark/light theme toggle | 2h | — |
| 4.5 | SEO: meta tags, Open Graph, structured data | 3h | 1.5 |
| 4.6 | RSS feed generation per location/category | 2h | 3.4 |
| 4.7 | PWA: manifest, service worker, offline support | 6h | — |
| 4.8 | TTS (Text-to-Speech) for articles | 4h | 1.5 |

**Total: ~25h**

### Priority 5 — Infrastructure & DevOps
**Why:** Production deployment, monitoring, and automation.

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 5.1 | Docker compose for local dev (AKIRA + API + Antena) | 3h | — |
| 5.2 | CI/CD pipeline (GitHub Actions: lint, test, build) | 4h | — |
| 5.3 | Deploy AKIRA to VPS / Render / Railway | 3h | — |
| 5.4 | Deploy API to Cloudflare Workers (production) | 3h | 3.6 |
| 5.5 | Deploy Antena to Cloudflare Pages (production) | 2h | 4.5 |
| 5.6 | Monitoring: health checks, uptime alerts, logs | 4h | 5.3 |
| 5.7 | Database backup strategy for akira.db | 2h | — |

**Total: ~21h**

### Priority 6 — Scout & Source Discovery
**Why:** Scout found 70 new sources in last run. Automate and expand.

| # | Task | Effort | Dependencies |
|---|------|--------|--------------|
| 6.1 | Scout v12: auto-register discovered sources | 4h | — |
| 6.2 | Scout scheduling: run weekly per province rotation | 2h | 6.1 |
| 6.3 | Source deduplication (avoid registering same domain twice) | 2h | 6.1 |
| 6.4 | Source quality scoring (auto-deactivate low-quality sources) | 3h | 2.6 |

**Total: ~11h**

---

## 3. Quick Wins vs Major Efforts

### Quick Wins (< 4h each, high impact)

| Task | Impact | Effort | Why |
|------|--------|--------|-----|
| **1.2** API feed working with live data | 🔴 Critical | 1h | Unblocks everything else |
| **1.3** SSR data loading in Antena | 🔴 Critical | 2h | Makes frontend show real news |
| **3.5** Cache headers on API | 🟡 High | 1h | Reduces load, improves perf |
| **4.4** Dark/light theme | 🟢 Medium | 2h | User-facing polish |
| **4.2** Category filtering | 🟡 High | 2h | Core UX feature |
| **5.1** Docker compose for dev | 🟡 High | 3h | Reproducible dev environment |
| **2.6** Source health dashboard | 🟡 High | 4h | Visibility into data quality |

### Major Efforts (> 6h each)

| Task | Impact | Effort | Why |
|------|--------|--------|-----|
| **2.3** Bias detection + clustering | 🔴 Critical | 6h | Unique value proposition |
| **2.5** Image pipeline (R2) | 🟡 High | 6h | Performance + reliability |
| **3.4** Full-text search (FTS5) | 🟡 High | 4h | Core discovery feature |
| **4.7** PWA (offline support) | 🟢 Medium | 6h | Mobile-first Argentina |
| **5.2** CI/CD pipeline | 🟡 High | 4h | Quality gate |
| **2.2** Scheduled harvest automation | 🔴 Critical | 3h | Keeps data fresh |

---

## 4. Timeline Estimates

### Phase 1: "Show Real News" (Week 1 — ~15h)
```
Day 1-2:  Tasks 1.2, 1.3, 1.1 — Connect Antena to live API feed
Day 3:    Tasks 1.4, 1.5 — Location + article pages
Day 4:    Tasks 1.6, 3.5 — Error handling + cache headers
Day 5:    Task 2.1 — Run first full harvest cycle
```
**Outcome:** Antena displays real Argentine news from the database.

### Phase 2: "Data Quality" (Week 2 — ~20h)
```
Day 1-2:  Tasks 2.2, 2.4 — Scheduled harvest + content cleaner
Day 3-4:  Tasks 2.3, 2.6 — Clustering + health dashboard
Day 5:    Tasks 3.1, 3.2, 3.3 — API hardening
```
**Outcome:** Fresh, clean, well-organized news with API reliability.

### Phase 3: "UX Polish" (Week 3 — ~18h)
```
Day 1-2:  Tasks 4.1, 4.2, 4.3 — Infinite scroll, categories, city selector
Day 3:    Tasks 4.5, 4.6 — SEO + RSS feeds
Day 4-5:  Tasks 4.4, 4.8 — Theme toggle + TTS
```
**Outcome:** Polished, feature-rich frontend ready for users.

### Phase 4: "Production" (Week 4 — ~21h)
```
Day 1-2:  Tasks 5.1, 5.2 — Docker + CI/CD
Day 3:    Tasks 5.3, 5.4, 5.5 — Deploy all three services
Day 4:    Tasks 5.6, 5.7 — Monitoring + backups
Day 5:    Tasks 6.1-6.4 — Scout automation
```
**Outcome:** Fully deployed, monitored, self-maintaining system.

**Total estimated effort: ~74h over 4 weeks**

---

## 5. Dependencies Between Tasks

```
                    ┌─────────────┐
                    │  1.2 API    │
                    │  feed live  │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────────┐
              ▼            ▼                ▼
        ┌──────────┐ ┌──────────┐   ┌──────────┐
        │ 1.1, 1.3 │ │ 1.4      │   │ 1.5      │
        │ Index SSR│ │ Location │   │ Article  │
        └────┬─────┘ └────┬─────┘   └────┬─────┘
             │            │              │
             ▼            ▼              ▼
        ┌──────────────────────────────────┐
        │         1.6 Error handling       │
        └────────────────┬─────────────────┘
                         │
           ┌─────────────┼──────────────┐
           ▼             ▼              ▼
     ┌──────────┐  ┌──────────┐  ┌──────────┐
     │ 4.1, 4.2 │  │ 4.3      │  │ 4.5, 4.6 │
     │ Scroll   │  │ City     │  │ SEO/RSS  │
     │ Category │  │ selector │  │          │
     └──────────┘  └──────────┘  └──────────┘

  ┌─────────────┐     ┌─────────────┐
  │ 2.1 Harvest │────▶│ 2.2 Sched   │
  └──────┬──────┘     └──────┬──────┘
         │                   │
         ▼                   ▼
  ┌─────────────┐     ┌─────────────┐
  │ 2.4 Cleaner │────▶│ 2.3 Cluster │
  └─────────────┘     └──────┬──────┘
                             │
                             ▼
                      ┌─────────────┐
                      │ 2.6 Health  │
                      └──────┬──────┘
                             │
                             ▼
                      ┌─────────────┐
                      │ 6.4 Quality │
                      └─────────────┘

  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
  │ 3.1, 3.2    │────▶│ 3.3 Pagin   │────▶│ 3.4 Search  │
  │ Rate limit  │     │ (cursor)    │     │ (FTS5)      │
  └─────────────┘     └─────────────┘     └──────┬──────┘
                                                  │
                                                  ▼
                                           ┌─────────────┐
                                           │ 3.6 Version │
                                           └──────┬──────┘
                                                  │
                                                  ▼
                                           ┌─────────────┐
                                           │ 5.4 Deploy  │
                                           │ API prod    │
                                           └─────────────┘

  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
  │ 5.1 Docker  │────▶│ 5.2 CI/CD   │────▶│ 5.3-5.5     │
  │ compose     │     │ pipeline    │     │ Deploy all  │
  └─────────────┘     └─────────────┘     └──────┬──────┘
                                                  │
                                                  ▼
                                           ┌─────────────┐
                                           │ 5.6, 5.7    │
                                           │ Monitor     │
                                           └─────────────┘
```

### Critical Path
```
1.2 → 1.3 → 1.6 → 4.1/4.2/4.3 → 4.5 → 5.5 (deploy Antena)
2.1 → 2.2 → 2.4 → 2.3 → 2.6
3.1 → 3.3 → 3.4 → 3.6 → 5.4 (deploy API)
5.1 → 5.2 → 5.3 (deploy AKIRA)
```

### Task Independence Matrix

| Can run in parallel | Tasks |
|---------------------|-------|
| Phase 1 tasks | 1.1-1.6 (sequential within, but independent of other phases) |
| Data quality | 2.1, 2.4, 2.6 can run while frontend work happens |
| API hardening | 3.1, 3.2, 3.5, 3.6 can run in parallel with frontend |
| Scout work | 6.1-6.4 mostly independent, only depends on 2.6 |
| Infrastructure | 5.1, 5.7 can start immediately; 5.3-5.6 need 3.x and 4.x |

---

## 6. Risk Assessment

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| AKIRA harvest takes too long for 1061 sources | High | Medium | Run in batches, use delta extraction, parallelize |
| Cloudflare Workers CPU limit (10ms) exceeded | High | Medium | Prerender max pages, cache aggressively, use SSR only for API |
| D1 query limits (50 per invocation) | Medium | Low | Batch queries, use efficient indexes |
| Source URLs go stale (common in local media) | Medium | High | Source recovery service (already built), Scout auto-discovery |
| Antena SSR + Solid.js too heavy for free tier | Medium | Medium | Use `prerender = true` for static pages, islands for interactive |
| Image storage exceeds R2 free tier (10GB) | Low | Low | Optimize images, use external URLs, implement cleanup |

---

## 7. Success Metrics (Production-Ready Definition)

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Sources registered | 1061 | 1200+ | `SELECT COUNT(*) FROM sources` |
| News articles in DB | 4513 | 10,000+ | `SELECT COUNT(*) FROM news_cards` |
| Sources with successful harvest | ~60% | 80%+ | source_health table |
| API response time (p95) | N/A | < 200ms | Monitoring |
| Antena page load (LCP) | N/A | < 2.5s | Lighthouse |
| Fresh content (< 24h old) | N/A | 70%+ of feed | `published_at` analysis |
| Test coverage | 112 tests | 150+ tests | pytest count |
| Uptime (AKIRA) | N/A | 99%+ | Health check monitoring |
| Uptime (API) | N/A | 99.9%+ | Cloudflare analytics |

---

## 8. Recommended Starting Point

**Start with Task 1.2 today.** It's the highest-leverage single task:

1. Verify API `/api/news/feed` returns data from akira.db
2. If not, fix the D1 ↔ SQLite bridge (API uses D1 bindings, AKIRA uses SQLite)
3. Once API serves live data, everything else unblocks

The biggest architectural question to resolve first: **How does the API (Cloudflare D1) sync with AKIRA (local SQLite)?** The ingest route exists (`POST /api/news/ingest`) but needs to be wired into the harvest pipeline.

---

*Plan generated from live codebase inspection on 2026-04-04.*
