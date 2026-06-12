# Antena Use Cases — Test Status

**Generated:** 2026-04-07
**Testers:** DEV#1, DEV#2, QA#1 (parallel agents with agent-browser)

## Summary

| Status | Count | % |
|--------|-------|---|
| ✅ PASS | 28 | 39% |
| ⚠️ INCOMPLETE | 18 | 25% |
| ❌ FAIL | 9 | 13% |
| ⏸️ NOT TESTED | 17 | 24% |
| **Total** | **72** | **100%** |

---

## Failing Use Cases (9)

| UC | Description | Bug |
|----|-------------|-----|
| 1.8 | Infinite scroll | Observer not triggering |
| 5.1 | Sintonizar grid view | No route exists |
| 6.4 | Agregar ubicación | Button not wired |
| 10.1 | Share news | Calls bookmark instead of share API |
| 12.5 | Sidebar Cortes | Opens location selector |
| 12.6 | Sidebar Farmacias | Opens location selector |
| 12.7 | Sidebar Transporte | Opens location selector |
| 12.8 | Sidebar Alertas | Opens location selector |
| 14.1 | ErrorBoundary bad params | App ignores bad URL params |
| 15.2 | Empty category | Wrong message shown |

---

## Incomplete Features (18)

These are intentionally stubbed/placeholder features:

- Sintonizar grid view (UC 5.1) — No route exists
- Community buttons (UC 5.3–5.6, 12.5–12.8) — 8 stubs showing "coming soon" but wired to wrong actions
- Menu view (UC 6.1–6.2) — Menu overlay doesn't open reliably
- Configurar Modo Mate (UC 6.5) — Only navigates to sintonizar
- Theme cycle (UC 8.1) — Settings inaccessible from menu
- Community buttons in Sidebar (UC 12.5–12.8) — All open location picker

---

## Screenshots

45 screenshots captured in `screenshots/` directory.

See `reporte-final.md` for full details and recommendations.
