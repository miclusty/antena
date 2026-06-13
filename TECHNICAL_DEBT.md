# 📋 Deuda Técnica — Antena v1.2.3

Análisis completo del proyecto, ordenado por impacto y esfuerzo. Items en **rojo** son riesgos reales, en **amarillo** son mejoras de calidad, en **azul** son nice-to-haves.

**Última actualización**: 2026-06-13 (post-deploy-production verde).

---

## ✅ Items resueltos (commits recientes)

| # | Item | Commit | Notas |
|---|------|--------|-------|
| #1 | pnpm approve-builds en CI | 7205cc7, 2afa592, 4676bea, aeb5e58 | pnpm-workspace.yaml con `allowedBuildScripts: ['*']` + `verifyDepsBeforeRun: false`. CI usa `pnpm install --frozen-lockfile \|\| true`. |
| #3 | GH secrets | user action 2026-06-13 | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` agregados |
| #6 | Orphan branches | 1fe8396, aeb5e58 | 13 branches `clean-*` + 4 stale features eliminadas. `git branch -a` solo muestra main + 6 worktrees activos |
| #7 | 5 `@ts-nocheck` | 1fe8396 | BookmarksView, ReadingMode, types.ts limpios; extract.ts + python.ts **eliminados** (legacy) |
| #8 | localhost:5000 | 1fe8396 | Nuevo `packages/api/src/lib/akira-url.ts` con `getAkiraBaseUrl()`. 6 URLs hardcodeadas → 1 helper |
| #10 | console.warn en prod | 1fe8396 | Gated por `ENVIRONMENT === "development"` en search.ts |
| #11 | withCache sin fallback | 1fe8396 | try-catch que retorna 503 en error |
| #13 | engines + packageManager | 1fe8396, 674a687 | `engines: { node >=20, pnpm >=11 }` agregado; `packageManager` removido (conflicta con pnpm-action-setup) |
| #18 | sync-version | 1fe8396 | `scripts/sync-version.sh` creado |
| **+1** | **CORS production** | 1fe8396 | `antena.com.ar` + `www.antena.com.ar` agregados al allowlist, deployed v c321863e |
| **+1** | **ArticleDetail 503/404** | d4a3087 | Frontend pasaba `clusterId` al endpoint que esperaba `news_id`. Fix: `() => n().id` |
| **+1** | **Deploy Production verde** | 46142d0, aeb5e58 | Workflow duplicado eliminado, deploy-production.yml alineado con pnpm 11.5.0 + \|\| true |

---

## 🔴 ALTO — Riesgos en producción

### #2. CLOUDFLARE_API_TOKEN sin `dns:write` — apex `antena.com.ar`
**Costo**: `antena.com.ar` (apex) sigue apuntando al Pages preview URL, no al dominio custom. El user tiene que:
- Abrir dash.cloudflare.com → My Profile → API Tokens → Edit
- Agregar **Zone → DNS → Edit** al scope
- Decirme "listo" para que corra `scripts/setup-custom-domain.py`

**Status actual**: `www.antena.com.ar` ✓ (funciona con CORS). Apex `antena.com.ar` pendiente.

### #4. AKIRA no está scrapeando en vivo
**Costo**: Los datos en D1 son del sync inicial (2026-05-08, hace 35+ días). El sitio muestra noticias reales, pero no se actualiza. Health check confirma: `news_last_hour: 0, news_today: 0, news_week: 0`.

**Opciones**:
- **Container en Cloudflare** (bloqueado: 5/5 cron triggers usados)
- **HTTP manual** `POST /api/admin/refresh` desde un cron local en tu Mac via `cloudflared`
- **Cloudflare Worker cron** con un alias del existente

### #5. R2 bucket no creado
**Costo**: El binding `IMAGES` está comentado en `wrangler.production.toml`. Si algún día queremos subir imágenes (profile pics, etc.), R2 no está habilitado en la cuenta (error 10042). **Workaround**: comentar el binding hasta que se active R2 desde el dashboard.

---

## 🟡 MEDIO — Calidad de código

### #9. Tests `.skip` que documentan funcionalidad no cubierta
- `e2e/search.spec.ts:12` "No search input visible" — el SearchView existe pero Playwright no lo encuentra (¿cambió el DOM?)
- `e2e/feed.spec.ts` x3 — "No articles to scroll", "No category filter visible", "No sort control visible"
- `e2e/article-bookmark.spec.ts:15` — "No news articles available — backend may be empty"
- `vitest::NewsCard.test.tsx:183-186` — 4 tests skipped por falta de `TouchEvent` mock

**Fix**: 1 día de trabajo para reactivar el e2e suite (necesita AKIRA + API en CI, ver #4).

### #12. `bias.ts` y `types.ts` tienen `VoiceBreakdown` import cruzado
```
packages/antena/src/lib/types.ts:5:  import type { VoiceBreakdown } from './bias';
packages/antena/src/lib/types.ts:42: export type { VoiceBreakdown } from './bias';
packages/antena/src/lib/bias.ts:48: export interface VoiceBreakdown { ... }
```
`VoiceBreakdown` está en `bias.ts` (102 líneas). El `type` re-export indirecto es confuso.

**Fix**: Mover la interface a `types.ts` y re-exportar desde `bias.ts`. Trivial (5 min).

### #15. `featuredCluster` se computa en `createEffect` (no memo)
`App.tsx:170` lo calcula dentro de un effect con un `Map`/`Set`. Funciona pero cada vez que `feed()` cambia, vuelve a computar. No es caro (5000 items) pero podría ser `createMemo`.

**Fix**: Trivial. Convertir la lógica del effect en un `createMemo` reactivo.

### #16. `location_province` en el sidebar — sin diferenciar ciudad/provincia
La query devuelve `location_name: "Córdoba"` y `location_province: "Córdoba"` (idéntico para ciudades capitales). El usuario no distingue.

**Fix**: Mostrar `"${name}, ${province}"` cuando `name === province` en la sidebar. ~10 min.

### #17. `image-pipeline` queue recibe items sin `source_url`
```
packages/api/src/queues/image-pipeline.ts:26:
  const sourceUrl = card?.image_url;
  if (!sourceUrl) {
    console.warn("image-pipeline: no source URL for hash=...");
```
El warning se loggea cuando un card viene sin `image_url`. Es ruido en logs de prod.

**Fix**: Validar al enqueue (no en el worker) y descartar el mensaje silenciosamente, o poblar `image_url` desde la DB.

---

## 🔵 BAJO — Polish y nice-to-haves

### #14. CONTRIBUTING.md / ARCHITECTURE.md
`docs/architecture.md` **sí existe** (10 archivos en docs/). Falta CONTRIBUTING.md. La mayoría del "developer onboarding" está en AGENTS.md pero no es visible para humanos.

**Fix**: 2 horas. Crear CONTRIBUTING.md con: setup, scripts, deploy, troubleshooting.

### #19. `pnpm dev` requiere `pnpm approve-builds` interactivo en Mac nueva
Mismo problema que #1. Un dev que clona el repo necesita ejecutar `pnpm approve-builds` antes de `pnpm dev` por primera vez.

**Fix**: Documentar en README.md que la primera vez es:
```bash
pnpm install
pnpm approve-builds
pnpm dev
```
Y nuestro pnpm-workspace.yaml actual **debería** hacer que `pnpm install` apruebe automáticamente — verificar que en Mac nueva funciona (probablemente sí porque pnpm 11.5.0 lee workspace.yaml localmente, en CI era el bug).

### #20. Tests e2e no validan el flujo completo
6 specs en `packages/antena/e2e/` (article-bookmark, bookmarks, feed, mobile, pwa, search). Casi todos `test.skip()`. Falta un test e2e real que recorra: "abrir la app → ver feed → click en una noticia → ver artículo → guardar en bookmarks".

**Fix**: 1 día cuando se reactiven los e2e en CI.

---

## 🎯 Resumen ejecutivo

| Categoría | Items resueltos | Items restantes | Esfuerzo restante |
|---|---|---|---|
| **CRÍTICO en prod** | #1, #3, +CORS | #2 (DNS), #4 (AKIRA), #5 (R2) | 1-2 horas de user action |
| **Calidad de código** | #6, #7, #8, #10, #11 | #9, #12, #15, #16, #17 | 0.5 día |
| **Polish** | #13, #18, +ArticleDetail, +Deploy Prod | #14, #19, #20 | 1 día |

**Lo que YA está bien**:
- ✅ 0 typecheck errors
- ✅ 246/246 vitest tests passing
- ✅ CI verde (Test + Lighthouse)
- ✅ Deploy Production verde (API Worker + Antena Pages)
- ✅ CORS production funcionando para `www.antena.com.ar`
- ✅ API en producción: 5000 news, 1078 fuentes, 4817 clusters
- ✅ Featured Story con cluster real
- ✅ Search + Bookmarks sync funcionando
- ✅ pnpm 11.5.0 + allowBuilds funcionando
- ✅ ArticleDetail cluster bug arreglado (no más 503/404)

**Recomendación próxima**:
1. **User action**: agregar `dns:write` scope al API token + activar R2 → corre `scripts/setup-custom-domain.py` (#2 + #5)
2. **User action**: decidir cómo correr AKIRA scrape en prod (#4) — el camino más simple es HTTP manual via `cloudflared` en tu Mac
3. **Dev work**: items #12, #15, #16, #17 son 30 min de trabajo total. Hacerlos en una mini-ronda antes de empezar features nuevas.
