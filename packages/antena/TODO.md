# TODO — ANTENA (Frontend)

Roadmap UI/UX derivado de la auditoría de Antena v1.2.3.
**Última actualización**: 2026-06-14 (Sprint 0 completo).

**Leyenda**: 🔴 crítico · 🟠 alto · 🟡 medio · 🟢 nice-to-have · ✅ done · 🔲 pending

---

## Sprint 0 — Cablear lo que ya está a medio cable (8 items) ✅

- ✅ **Cablear upvotes al backend** — `POST /api/news/{id}/vote` con device_id, idempotente. Frontend hace optimistic update.
- ✅ **Cablear reposts al backend** — `POST/DELETE /api/news/{id}/repost` con device_id. `cmtN = Math.random()*50` reemplazado por 0 (comments a Sprint 5).
- ✅ **Implementar `/buscar` como página real** — `src/pages/buscar.astro` + `src/components/search/SearchView.tsx` con `?q=` deep-link, historial en localStorage, recent searches.
- ✅ **Usar `fetchBlindspot`** — nuevo endpoint `GET /api/news/blindspot?device_id=…`. `BlindspotSection` debajo de `TrendingSection`. Re-fetch cuando cambian los follows.
- ✅ **Cablear `activeFeedTab='foryou'` al feed** — server: `foryou=true` cambia ORDER BY a quality + RANDOM() tie-breaker. Frontend: envía el param cuando tab === 'foryou'.
- ✅ **Conectar `QualityFilters` + `TimeFilters` + `bias`** al feed — `src/lib/feed-filters.ts` (tested). UI en panel colapsable con botón "Filtros" en el feed toolbar.
- ✅ **Borrar o cablear componentes muertos** — `DensityToggle` cableado al `density` signal (persiste en localStorage via `src/lib/preferences.ts`). `ModoMate` cableado como toggle en el feed toolbar.
- ✅ **Bug: tabs `cat:*` no resetean el feed** — `src/lib/feed-controls.ts:resolveCustomTabSelection` (5 tests). Refactor en `App.tsx:onTabChange` para llamar `resetFeed()` cuando aplica.

Nuevos archivos backend:
- `packages/api/migrations/0002_news_engagement.sql` — tablas `news_votes` + `news_reposts` + contadores denormalizados
- `packages/api/src/lib/d1.ts` — `getBlindspot()`
- `packages/api/src/routes/news.ts` — `POST /vote`, `POST /repost`, `DELETE /repost`, `GET /blindspot`, `?foryou=true` en feed
- `packages/api/src/lib/schemas.ts` — `foryou` en `feedParamsSchema`, nuevos schemas de vote/repost

Nuevos archivos frontend:
- `packages/antena/src/lib/feed-controls.ts` (5 tests) — resolución de tabs
- `packages/antena/src/lib/feed-filters.ts` (7 tests) — params para feed
- `packages/antena/src/lib/preferences.ts` (5 tests) — localStorage helpers
- `packages/antena/src/components/feed/BlindspotSection.tsx` — "lo que no estás viendo"
- `packages/antena/src/components/search/SearchView.tsx` — search page
- `packages/antena/src/pages/buscar.astro` — ruta `/buscar`

**Tests añadidos**: 17 nuevos (feed-controls, feed-filters, preferences). Total: 279 passing, 4 skipped.
**Typecheck**: antena ✅ + api ✅

---



## Sprint 1 — Auth, Profile y Settings (foundational)

Cierra 4 huecos de una sola vez: "Configuración" (sin destino), "Iniciá sesión" (sin destino), tema sin toggle, y la falta de personalization.

- 🔲 **Settings page** — `src/pages/settings.astro` + `src/components/settings/SettingsView.tsx`. Tabs: Apariencia · Lectura · Privacidad · Notificaciones · Sobre.
- 🔲 **Toggle de tema visible** — `useTheme().toggleTheme()` existe en `src/lib/theme.ts:63-67` pero nadie lo invoca. Botón sol/luna en `Header.tsx`. Al primer click, cicla light → dark → auto.
- 🔲 **Tamaño de fuente** — slider en settings, persiste en `localStorage` como `--font-scale: 0.875..1.25`. Aplicar a `html { font-size: calc(16px * var(--font-scale)) }`.
- 🔲 **Modo data-saver** — toggle en settings. Cuando ON: oculta imágenes (mantiene layout), prefiere `quality=low` en image pipeline (`src/lib/image.ts`).
- 🔲 **Indicador de calidad de imagen** — selector "Auto / Alta / Media / Baja" en settings. Wirear a `?w=` y `?fmt=` del endpoint `/api/img/{hash}`.
- 🔲 **Profile/Account screen** — "Hola, visitante" + "Iniciá sesión" del `LeftSidebar.tsx:179-181` van a una página real.
  - Auth: device_id ya está (`api.ts:280-300`). Pantalla "Tu cuenta" muestra device_id, opción "vincular email" (futuro), "exportar mis datos", "borrar todo".
- 🔲 **Onboarding primera vez** (3 pasos):
  1. "¿De dónde sos?" — `CitySelector` con mapa/listado
  2. "¿Qué temas te interesan?" — chips de categorías (mínimo 3)
  3. "Seguí al menos 2 medios" — top 10 con `FollowButton`
  - Persistir en `localStorage` + crear `src/lib/onboarding.ts`. Mostrar modal fullscreen la primera vez (checar con flag `antena-onboarded`).

## Sprint 2 — Discovery y engagement

- 🔲 **Manage follows ("Tus medios")** — nueva view `src/components/follows/FollowsView.tsx`. Lista de seguidos con unfollow, mute, y "ordenar por actividad".
- 🔲 **Sugeridos para seguir** — sección "Medios para descubrir" debajo de la lista de follows. Backend: usar `sources` con `bias_score` opuesto a tus follows para diversificar.
- 🔲 **Source profile page** — click en `SourceLogo` abre ficha: bio, `bias` (gráfico), últimos 20 artículos, follow/unfollow. Ruta: `/?view=source&id={id}`. Componente: `src/components/source/SourceProfile.tsx`.
- 🔲 **Daily briefing / Resumen del día** — top 5 del día en una card especial arriba del feed. Backend: nuevo endpoint `GET /api/news/daily-briefing`.
- 🔲 **"Estás al día"** — fin del infinite scroll. Cuando `hasMore === false`, mostrar un divider "Ya leíste todo · actualizado hace 5m" en vez de seguir cargando. Reemplaza el spinner.
- 🔲 **Trending con ventana temporal** — `TrendingSection` hoy filtra por `sources_count >= 1` (todos). Cambiar a "últimas 1h" + "últimas 24h" con tabs. Backend ya existe (`/api/news/trending?hours=24`).
- 🔲 **Búsqueda con filtros** — `?q=foo&category=Política&bias=neutral&from=2026-06-01`. UI: chips arriba de los resultados.
- 🔲 **Búsquedas guardadas** — botón "guardar búsqueda" en `SearchResults.tsx`, panel lateral "Tus búsquedas".
- 🔲 **"Continuar leyendo"** — al cerrar un artículo, guardar `scroll_pct` en `db.ts:markAsRead` (ya existe). En el feed, mostrar badge "Seguí leyendo" en las cards con scroll > 50%.
- 🔲 **Recently viewed** — vista accesible desde `LeftSidebar` quitando el `dimmed={true}` de "Historial" (`LeftSidebar.tsx:236`). Conectar a `db.ts`.
- 🔲 **Mapa de noticias** — `ApiLocation` ya tiene `lat`/`lng`. Componente `NewsMap.tsx` (Leaflet o Mapbox según costo). Vista: "Cerca tuyo" o por location.
- 🔲 **"Medios por ciudad"** — quick switcher en el header, no en submenú. "Córdoba" → filtra feed a esa ciudad.

## Sprint 3 — Article UX (donde más se queda tiempo el usuario)

- 🔲 **Listen (text-to-speech)** — botón en `ArticleBottomBar`. Usar `speechSynthesis` API (gratis, multilenguaje). Highlight palabra por palabra.
- 🔲 **Translate** — botón en el bottom bar. Usar Cloudflare Workers AI (`@cf/meta/m2m100-1.2b`) o API de MiniMax. Mostrar en overlay o reemplazar.
- 🔲 **Tabla de contenidos** — auto-generar del body (h2/h3). Sticky en desktop, colapsable en mobile.
- 🔲 **Swipe entre artículos** (X.com-style) — swipe left → siguiente del cluster, swipe right → anterior. `touch-action: pan-y` + threshold.
- 🔲 **"¿Te fue útil?"** — al final del artículo, dos botones 👍 👎. POST `/api/news/{id}/feedback`. Mostrar en la card "87% encontró esto útil".
- 🔲 **Reportar contenido** — menú ⋯ en `ArticleBottomBar` → bottom-sheet con razones (incorrecto, clickbait, duplicado, otro). POST `/api/news/{id}/report`.
- 🔲 **Byline del autor** — si `news_item.author` existe, mostrar avatar + nombre. Caso contrario, oculto.
- 🔲 **"Otras voces" mejorada** — `OtrasVocesCta.tsx` queda muy escondido. Mover arriba del `BiasBreakdownBar` y mostrar tabla de headlines lado a lado (X.com style).
- 🔲 **Reading time dinámico** — actualizar al scrollear ("te quedan 2 min"). Ya se calcula, falta reactividad.
- 🔲 **Persistir "Modo lectura"** — recordar la preferencia en el artículo y aplicarla automáticamente la próxima vez que abras uno del mismo medio.
- 🔲 **Image lightbox con pinch-to-zoom** — `ImageGallery` lo tiene; el single-image en `ArticleDetail.tsx:278-289` solo hace `cursor-zoom-in` sin lightbox.
- 🔲 **"Leer después" queue** — separar bookmarks en "Guardados" y "Leer después". Al guardar, preguntar. Feed separado.

## Sprint 4 — Notificaciones reales

- 🔲 **Inbox de notificaciones** — vista `src/components/notifications/NotificationsView.tsx`. Tab en `BottomNav` o drawer.
- 🔲 **Push notifications** — pedir permission en onboarding (no antes). Settings toggle. Backend: Web Push con Cloudflare Workers.
- 🔲 **Notificaciones por fuente** — "Clarín publicó 3 noticias nuevas" si seguís ese medio y hay inactividad > 2h.
- 🔲 **Alertas de breaking news** — usa el endpoint `/api/news/breaking` existente. Settings: "Solo política", "Solo mi ciudad", "Todo".
- 🔲 **Badges reales en BottomNav** — reemplazar el `unreadCount` actual (calculado del feed) por notificaciones reales.

## Sprint 5 — PWA y native feel

- 🔲 **Install prompt** — botón "Agregar a inicio" en settings o banner. VitePWA ya está configurado.
- 🔲 **iOS install instructions** — modal específico para Safari iOS ("Compartir → Agregar a pantalla de inicio").
- 🔲 **"What's new" modal** — al subir versión (checar `localStorage` `antena-last-seen-version`), mostrar changelog resumido.
- 🔲 **Offline indicator persistente** — `ConnectionStatus.tsx` solo toastea. Agregar dot rojo en `Header` cuando `navigator.onLine === false`.
- 🔲 **Pull-to-refresh con timestamp** — `PullToRefresh.tsx` existe; al refrescar, guardar `last_refresh` y mostrar "Actualizado hace 3m" en el header.
- 🔲 **Splash screen customization** — verificar manifest.webmanifest tenga icon set completo (192, 512, maskable).
- 🔲 **Share sheet nativo ampliado** — X.com, Telegram, copiar enlace, email. Hoy solo WhatsApp en `NewsCard.tsx:308-318` y Web Share API genérico.

## Sprint 6 — Accesibilidad (a11y)

- 🔲 **Skip-to-content link** — `<a href="#main-content">` invisible hasta focus. Poner en `Layout.astro`.
- 🔲 **`prefers-reduced-motion`** — query global en `global.css` que desactiva `animate-pulse`, `animate-spin`, `transition-all`. Aplicar a todo `*` con `animation-play-state: paused`.
- 🔲 **Focus trap en modales** — `MobileDrawer`, `BottomSheet`, action sheet, `ReadingMode`. Helper `src/lib/focus-trap.ts`.
- 🔲 **Focus management** — al cerrar modal, devolver foco al trigger. Al abrir, foco al primer interactivo.
- 🔲 **Material Symbols accesibles** — reemplazar los `innerHTML` de `NewsCard.tsx:269-318` por SVGs inline con `role="img"` + `<title>` o `aria-hidden="true"`.
- 🔲 **Contraste WCAG AA** — auditar `var(--text-tertiary)` contra `var(--bg-base)` en tema claro. Si falla, agregar `--text-tertiary-accessible`.
- 🔲 **`aria-live` para toasts** — `Toast.tsx` debería tener `aria-live="polite"` o `assertive` para errores.
- 🔲 **Reduced motion para active:scale** — `@media (prefers-reduced-motion: reduce) { .active\:scale-90 { transform: none !important; } }`.

## Sprint 7 — Polish

- 🔲 **Layout desktop 1024-1799px** — `App.tsx:443` usa `min-[1800px]:justify-between` que deja un vacío grande en laptops estándar. Decidir: ¿sidebars fijos de 280px, o rediseñar el grid para 3-cols compactos?
- 🔲 **Empty state "Siguiendo"** — cuando no hay follows, el feed queda vacío sin explicación. Crear `EmptyFollowingState` con CTA "Descubrir medios".
- 🔲 **"Fuente sin enlace"** (`App.tsx:601`) — en vez de toastear, abrir modal con la fuente y el dominio. Algunos usuarios querrán escribir el URL a mano.
- 🔲 **Footer con attribution** — "Hecho con ❤️ en Argentina · Powered by AKIRA · 1075 fuentes" en el `MobileDrawer` y en el footer del sidebar desktop.
- 🔲 **About page** — `src/pages/about.astro` con: qué es Antena, qué es AKIRA, contacto, código de conducta, licencia de contenido.
- 🔲 **"Reportar bug" / "Sugerir feature"** — link en settings, abre issue template en GitHub con prefill del device_id y `localStorage` state (con consentimiento).
- 🔲 **Changelog in-app** — vista `/changelog` con highlights de cada release. Fuente: `CHANGELOG.md` parseado en build time.

---

## Backlog (sin sprint asignado)

- 🔲 **Profile pages para periodistas** — beyond `source`, byline puede ser linkeable a una página del autor.
- 🔲 **"Hoy en la historia"** — card con eventos de este día en años anteriores.
- 🔲 **Newsletter semanal** — opt-in, "los 10 más leídos de la semana en tu ciudad".
- 🔲 **"Modo lectura nocturna"** — agenda automática (ej: 22:00-7:00) que fuerza dark mode.
- 🔲 **Quick actions desde la home screen (PWA shortcuts)** — "Última noticia", "Mi ciudad", "Breaking".

---

## Métricas de éxito (medir antes y después)

- **TTI** (Time to Interactive) — Lighthouse, target < 2.5s en 3G
- **Bounce rate** en primera visita (debería bajar con onboarding)
- **DAU/MAU ratio** (debería subir con notificaciones)
- **Tiempo medio en article** (debería subir con listen + TOC + read time)
- **Bookmarks per user** (debería subir con "Leer después")
- **Filter usage** (debería subir con filtros visibles)
- **Install rate** (PWA)
- **a11y score** Lighthouse (target ≥ 95)

---

## Cómo contribuir

1. Tomá un 🔲 item. Asignátelo creando un branch `feature/antena-{slug}` (ver CONTRIBUTING.md).
2. Si requiere backend nuevo, abrí issue en el repo del API primero.
3. Tests: cualquier feature nueva en `src/components/` requiere un test en `src/tests/`. E2E con Playwright si toca flujo.
4. Al cerrar, mové el item a `✅ Done` con el SHA del commit.

## ✅ Done

_(movemos los items cerrados acá con SHA cuando se completen)_
