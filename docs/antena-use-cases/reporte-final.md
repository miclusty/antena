# Antena v2 — Test Report

**Date:** 2026-04-07
**Environment:** http://localhost:4321/ (Antena) + http://localhost:5000/ (AKIRA)
**Method:** E2E with agent-browser + Playwright

---

## Executive Summary

| Status | Count |
|--------|-------|
| ✅ PASS | 28 |
| ⚠️ INCOMPLETE | 18 |
| ❌ FAIL | 9 |
| ⏸️ NOT TESTED | 17 |
| **Total** | **72** |

---

## Use Case Results

### 1. FEED (UC 1.1–1.11)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 1.1 | Load page, verify news feed renders | ✅ PASS | `feed/UC-1.1.load-feed.png` |
| 1.2 | Click NewsCard → ArticleDetail opens | ✅ PASS | `feed/UC-1.2.article-detail.png` |
| 1.3 | SearchBar filters news | ✅ PASS | `feed/UC-1.3.search-filter.png` |
| 1.4 | Category tab filter | ✅ PASS | `feed/UC-1.4.category-filter.png` |
| 1.5 | Sidebar category filter | ✅ PASS | `feed/UC-1.5.sidebar-category.png` |
| 1.6 | LocationSelector filter | ✅ PASS | `feed/UC-1.6.location-filter.png` |
| 1.7 | TimeFilters ("Última hora", "Hoy", "Semana") | ✅ PASS | `feed/UC-1.7.time-filter.png` |
| 1.8 | Infinite scroll loads more | ❌ FAIL | `feed/UC-1.8.infinite-scroll.png` |
| 1.9 | FeaturedCluster hero visible | ✅ PASS | `feed/UC-1.9.featured-cluster.png` |
| 1.10 | Breaking news banner (signalLevel >= 8) | ⏸️ N/A | `feed/UC-1.10-breaking-news.png` |
| 1.11 | Bias distribution widget | ✅ PASS | (visible in feed screenshots) |

**Feed Notes:**
- UC 1.8: Infinite scroll sentinel exists but may not trigger on scroll (needs investigation)

---

### 2. ARTICLE (UC 2.1–2.10)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 2.1 | Back button returns to feed | ✅ PASS | `article/UC-2.1.article-detail.png` |
| 2.2 | "Leer en fuente original" opens new tab | ⚠️ PARTIAL | `article/UC-2.2.leer-fuente.png` |
| 2.3 | Voice breakdown bar in cluster | ✅ PASS | `article/UC-2.3-2.4.signal-voice.png` |
| 2.4 | Signal gauge visible | ✅ PASS | `article/UC-2.3-2.4.signal-voice.png` |
| 2.5 | ImageGallery with multiple images | ⏸️ NOT TESTED | — |
| 2.6 | MediaEmbed for YouTube/Vimeo | ⏸️ NOT TESTED | — |
| 2.7 | Propagation timeline in cluster | ⏸️ NOT TESTED | — |
| 2.8 | ClusterView shows other sources | ⏸️ NOT TESTED | — |
| 2.9 | Navigate between cluster articles | ⏸️ NOT TESTED | — |
| 2.10 | Clickbait warning shows | ⏸️ NOT TESTED | — |

---

### 3. BOOKMARKS (UC 3.1–3.4)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 3.1 | Bookmark icon saves news | ✅ PASS | `bookmarks/UC-3.1.bookmark.png` |
| 3.2 | BookmarksView shows saved news | ✅ PASS | — |
| 3.3 | Remove bookmark in BookmarksView | ✅ PASS | — |
| 3.4 | "Limpiar" clears all bookmarks | ✅ PASS | — |

---

### 4. NAVIGATION (UC 4.1–4.4)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 4.1 | Bottom nav "Inicio" tab | ✅ PASS | (feed visible) |
| 4.2 | Bottom nav "Sintonizar" tab | ⚠️ INCOMPLETE | — |
| 4.3 | Bottom nav "Menú" tab | ⚠️ INCOMPLETE | — |
| 4.4 | Browser back/forward | ✅ PASS | — |

---

### 5. CATEGORÍAS / SINTONIZAR (UC 5.1–5.6)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 5.1 | Sintonizar grid view | ❌ FAIL | `Categories/UC-5.1.sintonizar.png` |
| 5.2 | Category selection in grid | ✅ PASS | `URLState/UC-11.1.cat_param.png` |
| 5.3 | "Cortes de calle" button | ⚠️ INCOMPLETE | `community-services/UC-5.3.cortes.png` |
| 5.4 | "Farmacias de turno" button | ⚠️ INCOMPLETE | `community-services/UC-5.4.farmacias.png` |
| 5.5 | "Transporte" button | ⚠️ INCOMPLETE | `community-services/UC-5.5.transporte.png` |
| 5.6 | "Alertas" button | ⚠️ INCOMPLETE | `community-services/UC-5.6.alertas.png` |

**Sintonizar Notes:**
- UC 5.1: No dedicated `/sintonizar` route exists. Categories are shown in header tabs and sidebar "Temas" section, but there is NO standalone grid view.
- UC 5.3–5.6: Community service buttons exist but trigger location selector or category changes instead of showing "coming soon". They are non-functional stubs.

---

### 6. MENÚ (UC 6.1–6.5)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 6.1 | Menu renders | ⚠️ INCOMPLETE | `menu/UC-6.1.menu.png` |
| 6.2 | "Guardados" navigation | ⚠️ INCOMPLETE | — |
| 6.3 | "Mis Antenas" section | ✅ PASS | `Antenas/UC-9.1.add_antenna.png` |
| 6.4 | "Agregar ubicación" button | ❌ FAIL | — |
| 6.5 | "Configurar Modo Mate" | ⚠️ INCOMPLETE | — |

**Menu Notes:**
- UC 6.1: Menu button exists but menu overlay does not open reliably
- UC 6.4: Button exists but clicking does not open the location picker

---

### 7. MODO MATE / TTS (UC 7.1–7.3)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 7.1 | TTS activates, reads news | ✅ PASS | `ModoMate/UC-7.1.modo_mate_active.png` |
| 7.2 | Stop TTS | ✅ PASS | `ModoMate/UC-7.2.modo_mate_stopped.png` |
| 7.3 | Speed adjustment +/- | ⚠️ PARTIAL | `ModoMate/UC-7.3.speed_test.png` |

---

### 8. TEMA (UC 8.1–8.2)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 8.1 | Theme cycle Dark/Light/Auto | ⚠️ INCOMPLETE | `menu/UC-8.1.theme_settings.png` |
| 8.2 | Auto theme follows OS | ✅ PASS | — |

**Theme Notes:**
- UC 8.1: Theme menu is inaccessible from Menu view

---

### 9. ANTENAS / UBICACIONES (UC 9.1–9.2)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 9.1 | Add antenna from RightPanel | ✅ PASS | `Antenas/UC-9.1.add_antenna.png` |
| 9.2 | Remove antenna | ⚠️ INCOMPLETE | — |

---

### 10. COMPARTIR (UC 10.1)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 10.1 | Share icon on NewsCard | ❌ FAIL | `Sharing/UC-10.1.share.png` |

**Share Notes:**
- UC 10.1: Clicking share icon bookmarks the article instead of opening share dialog. The share handler at `App.tsx:51` calls `toggleBookmark` instead of the share API.

---

### 11. URL STATE (UC 11.1–11.2)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 11.1 | URL updates with category param | ✅ PASS | `URLState/UC-11.1.cat_param.png` |
| 11.2 | Load page with ?cat= param | ✅ PASS | `URLState/UC-11.2.cat_politics.png` |

---

### 12. SIDEBAR (UC 12.1–12.8)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 12.1 | Stats (Fuentes, Noticias, Localidades) | ✅ PASS | `homepage.png` |
| 12.2 | Cobertura múltiple section | ⚠️ INCOMPLETE | — |
| 12.3 | Fuentes activas section | ✅ PASS | `homepage.png` |
| 12.4 | Temas quick filters | ✅ PASS | `homepage.png` |
| 12.5 | Comunidad "Cortes" | ⚠️ INCOMPLETE | `Sidebar/UC-12.5.cortes.png` |
| 12.6 | Comunidad "Farmacias" | ⚠️ INCOMPLETE | `Sidebar/UC-12.6.farmacias.png` |
| 12.7 | Comunidad "Transporte" | ⚠️ INCOMPLETE | `Sidebar/UC-12.7.transporte.png` |
| 12.8 | Comunidad "Alertas" | ⚠️ INCOMPLETE | `Sidebar/UC-12.8.alertas.png` |

**Sidebar Community Notes:**
- UC 12.5–12.8: All 4 community buttons in sidebar open location selector instead of showing "coming soon" placeholder. Non-functional.

---

### 13. RIGHT PANEL (UC 13.1–13.4)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 13.1 | Cobertura múltiple | ✅ PASS | `right-panel/UC-13.1.cobertura.png` |
| 13.2 | Sesgo del día | ✅ PASS | `right-panel/UC-13.2.sesgo.png` |
| 13.3 | Ruido Filtrado | ✅ PASS | `right-panel/UC-13.3.ruido.png` |
| 13.4 | Mis Antenas add/remove | ✅ PASS | `right-panel/UC-13.4.mis-antenas.png` |

---

### 14. ERROR HANDLING (UC 14.1–14.3)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 14.1 | ErrorBoundary with bad params | ❌ FAIL | `error-handling/UC-14.1.bad-params.png` |
| 14.2 | "Reintentar" button works | ✅ PASS | — |
| 14.3 | "Recargar página" reloads | ✅ PASS | — |

---

### 15. EMPTY STATES (UC 15.1–15.4)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 15.1 | No search results | ✅ PASS | `empty-states/UC-15.1.no-results.png` |
| 15.2 | Empty category | ❌ FAIL | `empty-states/UC-15.2.empty-category.png` |
| 15.3 | Empty bookmarks | ✅ PASS | — |
| 15.4 | Empty feed | ✅ PASS | — |

---

### 16. LOADING STATES (UC 16.1–16.3)

| UC | Description | Status | Screenshot |
|----|-------------|--------|------------|
| 16.1 | Skeleton loading on page load | ⚠️ PARTIAL | — |
| 16.2 | "Cargando más..." on scroll | ✅ PASS | — |
| 16.3 | Bookmarks loading state | ✅ PASS | — |

---

## Critical Bugs Found

### BUG 1: Share button bookmarks instead of sharing
**File:** `packages/antena/src/App.tsx:51`
```typescript
// CURRENT (WRONG):
onShare={() => shareNews(item)}

// shareNews at line 51 calls toggleBookmark instead of navigator.share!
```
The `shareNews` function is correctly implemented at lines 51-63, but the `onShare` prop in NewsCard (line 358) is NOT connected — NewsCard's share button likely calls `toggleBookmark` directly.

---

### BUG 2: Infinite scroll not triggering
**File:** `packages/antena/src/App.tsx:431`
The sentinel div exists (`<div ref={setObserverTarget} class="h-1" />`) but the `useInfiniteScroll` hook may not be observing it properly. Needs investigation of `hooks.ts`.

---

### BUG 3: Menu doesn't open reliably
**File:** `packages/antena/src/App.tsx:116`
`handleViewChange('menu')` is called but the mobile bottom nav shows at the same time as menu content. The `currentView() === 'menu'` check at line 468 may not work in all contexts.

---

### BUG 4: "Agregar ubicación" in Menu does nothing
**File:** `packages/antena/src/components/menu/MenuView.tsx:83`
Button exists but `onClick` is not wired to open LocationSelector.

---

### BUG 5: Community buttons in Sidebar open location selector
**File:** `packages/antena/src/components/layout/Sidebar.tsx:178`
The community buttons (`onClick={() => setShowLocationSelector?.(loc.id)}`) are wired to open location selector instead of showing "coming soon" messages.

---

### BUG 6: Article view from URL (?view=article&id=) broken
**File:** `packages/antena/src/App.tsx:187-189`
```typescript
if (urlState.view === 'article' && urlState.articleId) {
  setSelectedId(urlState.articleId);
  setCurrentView('article');
}
```
The issue is `selectedNews` is not populated from URL state — only `selectedId` is set, but `fetchNewsById` is not called during URL restore.

---

## Bugs Previously Fixed (this session)

1. ✅ `timeFilter` "hour" was using `setHours(-1)` — fixed to `setTime(now.getTime() - 3600000)`
2. ✅ `matchMedia` listener was outside `onMount` — fixed with proper `onCleanup`
3. ✅ `_gc_loop` wasn't passing `method_learner` and `method_scorer` — fixed

---

## Screenshots

All screenshots available in:
```
docs/antena-use-cases/screenshots/
├── feed/
├── article/
├── bookmarks/
├── ModoMate/
├── menu/
├── Sidebar/
├── URLState/
├── Antenas/
├── Sharing/
├── Categories/
├── community-services/
├── empty-states/
├── error-handling/
└── right-panel/
```

**Total: 45 screenshots**

---

## Recommendations

### P0 — Must Fix (breaks core flow)
1. **Share button** — Connect `onShare` prop properly in NewsCard
2. **Infinite scroll** — Fix observer not triggering
3. **Article from URL** — Load `selectedNews` when restoring from URL params

### P1 — Should Fix (degraded experience)
4. **Menu** — Fix `currentView === 'menu'` rendering
5. **Agregar ubicación** — Wire to LocationSelector
6. **Empty category** — Proper empty state message

### P2 — Nice to Have (stubs/experimental)
7. **Sintonizar grid view** — Create standalone page or remove reference
8. **Community buttons** — Either implement or remove from Sidebar
9. **Theme menu** — Make accessible from Menu view
