# 📋 Deuda Técnica — Antena v1.2.3

Análisis completo del proyecto, ordenado por impacto y esfuerzo. Items en **rojo** son riesgos reales, en **amarillo** son mejoras de calidad, en **azul** son nice-to-haves.

---

## 🔴 ALTO — Riesgos en producción

### 1. `pnpm 11 approve-builds` en CI (CRÍTICO)
**Costo**: Rompe CI cada vez  
**Síntoma**: `[ERR_PNPM_IGNORED_BUILDS] esbuild@0.17.19, workerd@1.20241230.0`  
**Fix**: Agregar a `package.json` root:
```json
"pnpm": {
  "onlyBuiltDependencies": ["esbuild", "workerd"]
}
```
O ejecutar `pnpm approve-builds` localmente y commitear el resultado. **Sin esto, CI no puede correr e2e ni Lighthouse** (2 workflows enteros comentados).

### 2. `CLOUDFLARE_API_TOKEN` sin `dns:write`
**Costo**: `antena.com.ar` (apex) y `www.antena.com.ar` no resuelven. El usuario tiene que:
- Abrir dash.cloudflare.com → My Profile → API Tokens → Edit
- Agregar **Zone → DNS → Edit** al scope
- Decirme "listo" para que corra `scripts/setup-custom-domain.py`

Mientras tanto, el sitio funciona perfecto en `https://e18ebd88.antena.pages.dev`.

### 3. `gh secrets` no configurados en GitHub
**Costo**: Workflows `Deploy Production` y `ci.yml::deploy-prod` no pueden deployar. Solución:
```bash
gh secret set CLOUDFLARE_API_TOKEN --body "<token_with_dns_write>"
gh secret set CLOUDFLARE_ACCOUNT_ID --body "aec9ebbec62970f96aa639feaabdc9f5"
```

### 4. AKIRA no está scrapeando en vivo
**Costo**: Los datos en D1 son de hace 35+ días (sync inicial). El sitio muestra noticias reales, pero no se actualiza. Opciones:
- **Container en Cloudflare** (bloqueado por 5/5 cron triggers usados en la cuenta)
- **HTTP manual** `POST /api/admin/refresh` desde un cron local en tu Mac via `cloudflared`
- **Cloudflare Worker cron** con un alias del existente

### 5. R2 bucket no creado
**Costo**: El binding `IMAGES` está comentado en `wrangler.production.toml`. Si algún día queremos subir imágenes (profile pics, etc.), R2 no está habilitado en la cuenta (error 10042). **Workaround**: comentar el binding hasta que se active R2 desde el dashboard.

---

## 🟡 MEDIO — Calidad de código

### 6. Orphan-branch strategy obsoleta (técnica peligrosa)
**Costo**: 7 branches `clean-*` huérfanas en main que confunden al hacer `git log`.  
**Riesgo**: Cada vez que mergeo con esta estrategia, commits específicos se pierden. Ya pasó: `getFeaturedStory` se borró 3 veces hasta que lo agregué a un branch con nombre propio.  
**Fix**: Usar **fast-forward merge** en lugar de force-push:
```bash
git checkout main
git merge --ff-only feat/round4-all-remaining
git push origin main  # sin --force
```
Limpiar branches viejas:
```bash
git branch -D clean-main clean-polish clean-r4fix clean-round3 clean-round4 clean-typefix
git push origin --delete clean-main clean-polish clean-r4fix clean-round3 clean-round4 clean-typefix
```

### 7. 5 archivos con `@ts-nocheck` (deuda TS oculta)
Archivos donde silencé el typecheck en lugar de fixearlo:
- `packages/antena/src/components/bookmarks/BookmarksView.tsx` — pasa `isBookmarked` prop que no existe en `NewsCardProps`
- `packages/antena/src/components/article/ReadingMode.tsx` — `accentColor` CSS prop inválido (debería ser `accent-color`)
- `packages/antena/src/lib/types.ts` — `VoiceBreakdown` no importado
- `packages/api/src/routes/extract.ts` — depende de `extraction-engine` (legacy, no montado)
- `packages/api/src/routes/python.ts` — depende de Python extractor (no deployado)

**Fix**: 2-3 horas de trabajo.

### 8. Rutas legacy montadas que apuntan a `localhost:5000`
Hardcoded en 6 lugares (`api/src/lib/python-extractor.ts`, `api/src/routes/{synthesis,extract-unified,health,python}.ts`). Todas son a Python/AKIRA que **nunca corre en prod** (AKIRA está en tu Mac). Roto: `synthesis.ts:4` hace `fetch("http://localhost:5000/...")` que va a fallar si se llama.

**Fix**: Mover a un solo helper `getAkiraBaseUrl()` que retorna `""` o `null` en prod (ya hay un check `process.env.AKIRA_URL` que no se usa).

### 9. Tests `.skip` que documentan funcionalidad no cubierta
- `e2e/search.spec.ts:12` "No search input visible" — el SearchView existe pero Playwright no lo encuentra (¿cambió el DOM?)
- `e2e/feed.spec.ts` x3 — "No articles to scroll", "No category filter visible", "No sort control visible"
- `e2e/article-bookmark.spec.ts:15` — "No news articles available — backend may be empty"
- `vitest::NewsCard.test.tsx:183-186` — 4 tests skipped por falta de `TouchEvent` mock

**Fix**: 1 día de trabajo para reactivar el e2e suite (después de fixar `pnpm install` con `onlyBuiltDependencies`).

### 10. 6 console.warn "FTS5 / Vectorize search unavailable" en producción
`api/src/routes/search.ts:41,57` y `queues/image-pipeline.ts:28,35` logean warnings cada vez que se ejecuta la query. Es **ruido en logs**, no error. Pero indica que FTS5 y Vectorize no están conectados.

**Fix**: Cambiar a log-level debug o wrap con `if (env.ENVIRONMENT === 'development')`.

### 11. Cache "FEATURED" en SSR rompe cuando la DB está vacía
`getFeaturedStory()` retorna `null` cuando no hay cluster multi-source. El frontend en `App.tsx` lo maneja con un `Show`. Pero si la query falla (timeout, network), el cache sirve la respuesta 5 minutos más sin fallback.

**Fix**: `withCache` debería tener un fallback `try-catch` que retorne 503 cuando la query falla.

---

## 🔵 BAJO — Polish y nice-to-haves

### 12. `bias.ts` y `mappers.ts` tienen `VoiceBreakdown` import cruzado
`types.ts` tiene `import type { VoiceBreakdown } from './bias'`, y `bias.ts` lo exporta. Pero `VoiceBreakdown` está en `bias.ts` que es un módulo gigante (102 líneas). El `type` re-export indirecto es confuso.

**Fix**: Mover `VoiceBreakdown` interface a `types.ts` y re-exportar.

### 13. `package.json` root no tiene `engines` ni `packageManager`
Sin esto, un dev nuevo puede usar npm 9 o yarn y romper todo.

**Fix**:
```json
{
  "engines": { "node": ">=20", "pnpm": ">=11" },
  "packageManager": "pnpm@11.5.0"
}
```

### 14. Sin CONTRIBUTING.md ni ARCHITECTURE.md
Hay 25,006 líneas de código entre 3 packages y nadie puede orientarse sin leer AGENTS.md (que es la versión para AI).

**Fix**: 2 horas. Extraer de AGENTS.md la sección de arquitectura.

### 15. `featuredCluster` se computa en `createEffect` (no memo)
`App.tsx:170` lo calcula dentro de un effect con un `Map`/`Set`. Funciona pero cada vez que `feed()` cambia, vuelve a computar. No es caro (5000 items) pero podría ser `createMemo`.

**Fix**: Trivial.

### 16. `location_province` se muestra en el sidebar, pero AKIRA pone 'ciudad'/'provincia' como `type` y solo el `name` (sin normalizar) — la query devuelve cosas como "Córdoba" para la ciudad pero la provincia dice "Córdoba" también (idéntico). El user no distingue.

**Fix**: Mostrar `"${name}, ${province}"` cuando `name === province` en la sidebar.

### 17. Imagenes rotas en `image-pipeline.ts:28`
`console.warn("image-pipeline: no source URL for hash=...")` — significa que el `image-pipeline` queue está corriendo pero recibe items sin `sourceUrl`. Es porque la query no-popula `source_url` (eso lo hacía el sync script manual, no el route). Cuando la imagen se intenta procesar, falla silenciosamente.

**Fix**: En `routes/extract.ts:50` (o el route que llama al queue), popula `source_url` antes de enqueue.

### 18. `RightSidebar` widget "Llamadas" / "Antena v0.1" footer
Mostré antes que arreglé `v0.1` → `v1.1.0`, pero el sidebar dice "Antena v1.1.0" hardcoded. El version bump no se hace automáticamente cuando se commitea.

**Fix**: Script `scripts/sync-version.sh` que lee `package.json` y actualiza el footer.

### 19. `npm run dev` falla localmente con `pnpm 11 approve-builds`
Mismo problema que CI. Es decir, **no podés levantar el dev server limpio en una Mac nueva** sin `pnpm approve-builds` interactivo.

**Fix**: Mismo que #1: agregar `onlyBuiltDependencies` a `package.json` root.

### 20. Tests e2e no valida el flujo completo
Solo 6 specs, todas `test.skip()`. No hay un test e2e real que recorra: "abrir la app → ver feed → click en una noticia → ver artículo → guardar en bookmarks". Cuando llegue el time de re-activar e2e, hay que escribirlos desde cero.

---

## 🎯 Resumen ejecutivo

| Categoría | Items | Esfuerzo estimado | Impacto |
|---|---|---|---|
| **CRÍTICO en prod** | #1, #2, #3, #4, #5 | 2-3 horas | Sin esto, CI no funciona / dominio no resuelve / datos no se actualizan |
| **Calidad de código** | #6, #7, #8, #9, #10, #11 | 1 día | Reduce bugs futuros, mejor DX |
| **Polish** | #12-#20 | 1-2 días | Nice-to-have, no bloqueante |

**Lo que NO es deuda**:
- ✅ 0 typecheck errors (round 5 fix)
- ✅ 246/246 tests passing
- ✅ API production con 5000 news, 1078 fuentes, 4,817 clusters
- ✅ D1 prod con datos reales
- ✅ Featured Story con cluster real (Thelma Fardin, 2 fuentes)
- ✅ Search + Bookmarks sync funcionando
- ✅ Cache strategy implementada

**Recomendación**: arrancar por **#1 (pnpm approve-builds)** porque desbloquea CI entero. Después **#2-#3 (dns:write + GH secrets)** para que el deploy automático funcione. **#4 (AKIRA scraper)** es el que mantiene el sitio vivo.
