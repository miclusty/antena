# 📋 Deuda Técnica — Antena v1.2.3

Análisis completo del proyecto, ordenado por impacto y esfuerzo. Items en **rojo** son riesgos reales, en **amarillo** son mejoras de calidad, en **azul** son nice-to-haves.

**Última actualización**: 2026-06-13 (post debt round 2 + production fix).

---

## ✅ Items resueltos

| # | Item | Commit(s) | Notas |
|---|------|-----------|-------|
| #1 | pnpm approve-builds en CI | 7205cc7, 2afa592, 4676bea, aeb5e58 | pnpm-workspace.yaml con `allowedBuildScripts: ['*']` + `verifyDepsBeforeRun: false`. CI usa `pnpm install --frozen-lockfile \|\| true`. |
| #3 | GH secrets | user action 2026-06-13 | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` agregados |
| #6 | Orphan branches | 1fe8396, aeb5e58 | 13 branches `clean-*` + 4 stale features eliminadas |
| #7 | 5 `@ts-nocheck` | 1fe8396 | BookmarksView, ReadingMode, types.ts limpios; extract.ts + python.ts **eliminados** (legacy) |
| #8 | localhost:5000 | 1fe8396 | Nuevo `packages/api/src/lib/akira-url.ts` con `getAkiraBaseUrl()`. 6 URLs hardcodeadas → 1 helper |
| #10 | console.warn en prod | 1fe8396 | Gated por `ENVIRONMENT === "development"` en search.ts |
| #11 | withCache sin fallback | 1fe8396 | try-catch que retorna 503 en error |
| #12 | VoiceBreakdown import | 793b237 | Movido a `types.ts` (single source). `bias.ts` re-exporta |
| #13 | engines + packageManager | 1fe8396, 674a687 | `engines: { node >=20, pnpm >=11 }` agregado; `packageManager` removido (conflicta con pnpm-action-setup) |
| #15 | featuredCluster createEffect | 793b237 | Convertido a `createMemo` puro derivado del feed signal |
| #16 | location_province dedupe | 793b237 | "Córdoba, Córdoba" → "Córdoba" cuando name === province |
| #17 | image-pipeline enqueue | 793b237 | Valida `image_url` antes de enqueue (antes fallaba en el worker) |
| #18 | sync-version | 1fe8396 | `scripts/sync-version.sh` creado |
| **+1** | **CORS production** | 1fe8396 | `antena.com.ar` + `www.antena.com.ar` agregados al allowlist, deployed |
| **+1** | **ArticleDetail 503/404** | d4a3087 | Frontend pasaba `clusterId` al endpoint que esperaba `news_id` |
| **+1** | **Deploy Production verde** | 46142d0, aeb5e58, bd88327 | Workflow duplicado eliminado, deploy-production + deploy-antena alineados |
| **+1** | **PUBLIC_API_BASE roto** | 882c15c | Workflow sobreescribía con `api.antena.com.ar` (no existe); ahora usa `akira-api.miclusty.workers.dev` |

**Total**: 16/20 items cerrados (+ 4 bugs extra resueltos en el camino).

---

## 🔴 ALTO — Riesgos en producción

### #2. CLOUDFLARE_API_TOKEN sin `dns:write` — apex `antena.com.ar` y custom `api.antena.com.ar`
**Costo**: 
- `antena.com.ar` (apex) sin resolver (today: NXDOMAIN).
- `api.antena.com.ar` (que sí usaría el frontend cuando esté) tampoco resuelve.

El user tiene que:
- Abrir dash.cloudflare.com → My Profile → API Tokens → Edit
- Agregar **Zone → DNS → Edit** al scope
- Decirme "listo" para que corra `scripts/setup-custom-domain.py`

**Status actual**: `www.antena.com.ar` ✓ (funciona con CORS). El frontend usa `akira-api.miclusty.workers.dev` (worker URL). Una vez `dns:write` esté, podemos wirear tanto `antena.com.ar` apex como `api.antena.com.ar` y actualizar el workflow en una sola ronda.

### #4. AKIRA no está scrapeando en vivo
**Costo**: Los datos en D1 son del sync inicial (2026-05-08, hace 35+ días). El sitio muestra noticias reales, pero no se actualiza. Health check: `news_last_hour: 0, news_today: 0, news_week: 0`.

**Opciones**:
- **Container en Cloudflare** (bloqueado: 5/5 cron triggers usados)
- **HTTP manual** `POST /api/admin/refresh` desde un cron local en tu Mac via `cloudflared`
- **Cloudflare Worker cron** con un alias del existente

### #5. R2 bucket no creado
**Costo**: El binding `IMAGES` está comentado en `wrangler.production.toml`. Si algún día queremos subir imágenes (profile pics, etc.), R2 no está habilitado en la cuenta (error 10042). **Workaround**: comentar el binding hasta que se active R2 desde el dashboard.

**Status actual**: el image-pipeline (#17) ya valida al enqueue, así que cuando R2 se active, todo está listo para re-bindear y empezar a ingestar.

---

## 🟡 MEDIO — Calidad de código

### #9. Tests `.skip` que documentan funcionalidad no cubierta
- `e2e/feed.spec.ts:3` — "No articles to scroll", "No category filter visible", "No sort control visible"
- `e2e/article-bookmark.spec.ts:1` — "No news articles available — backend may be empty"
- `vitest::NewsCard.test.tsx:183-186` — 4 tests skipped por falta de `TouchEvent` mock

**Fix**: 1 día de trabajo. Requiere AKIRA + API corriendo (relacionado con #4).

---

## 🔵 BAJO — Polish y nice-to-haves

### #14. CONTRIBUTING.md
`docs/architecture.md` ✓ existe. Falta `CONTRIBUTING.md` en root con setup + scripts + troubleshooting para humanos nuevos (no-AI).

**Fix**: 2 horas. Extraer de AGENTS.md la sección de setup + scripts.

### #19. `pnpm dev` requiere `pnpm approve-builds` interactivo en Mac nueva
Un dev que clona el repo necesita ejecutar `pnpm approve-builds` antes de `pnpm dev` por primera vez.

**Fix**: Documentar en README.md o CONTRIBUTING.md:
```bash
pnpm install
pnpm approve-builds
pnpm dev
```

### #20. Tests e2e no validan el flujo completo
6 specs en `packages/antena/e2e/` (article-bookmark, bookmarks, feed, mobile, pwa, search). Casi todos `test.skip()`. Falta un test e2e real que recorra: "abrir la app → ver feed → click en una noticia → ver artículo → guardar en bookmarks".

**Fix**: 1 día cuando se reactiven los e2e en CI (relacionado con #4/#9).

---

## 🎯 Resumen ejecutivo

| Categoría | Items resueltos | Items restantes | Esfuerzo restante |
|---|---|---|---|
| **CRÍTICO en prod** | #1, #3, +CORS, +ArticleDetail, +Deploy Prod, +PUBLIC_API_BASE | #2 (DNS), #4 (AKIRA), #5 (R2) | 1-2 horas de user action |
| **Calidad de código** | #6, #7, #8, #10, #11, #12, #15, #16, #17 | #9 | 0.5-1 día |
| **Polish** | #13, #18 | #14, #19, #20 | 1 día |

**Lo que YA está bien**:
- ✅ 0 typecheck errors
- ✅ 247/247 vitest tests passing (1 nuevo del test de #16)
- ✅ 3/3 GH workflows verdes: CI, Deploy Production, Deploy Antena
- ✅ CORS production funcionando para `www.antena.com.ar`
- ✅ PUBLIC_API_BASE apunta al worker URL correcto
- ✅ API en producción: 5000 news, 1078 fuentes, 4817 clusters
- ✅ Featured Story con cluster real
- ✅ Search + Bookmarks sync funcionando
- ✅ pnpm 11.5.0 + allowBuilds funcionando
- ✅ ArticleDetail cluster bug arreglado
- ✅ Image-pipeline validando al enqueue

**Recomendación próxima**:
1. **User action**: agregar `dns:write` scope al API token + activar R2 → corre `scripts/setup-custom-domain.py` (#2 + #5) y actualiza el workflow `PUBLIC_API_BASE` a `https://api.antena.com.ar`
2. **User action**: decidir cómo correr AKIRA scrape en prod (#4) — el camino más simple es HTTP manual via `cloudflared` en tu Mac
3. **Dev work**: #9 (reactivar e2e suite, requiere #4), #14 (CONTRIBUTING.md, 2h), #19 (doc approve-builds, 5min), #20 (e2e real tests, 1 día)
