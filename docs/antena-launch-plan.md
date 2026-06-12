# Antena — Plan de Lanzamiento

> **Creado:** 2026-04-05  
> **Objetivo:** Lanzar Antena como el mejor lector de noticias hiperlocales de Argentina  
> **Diferenciador:** Síntesis multi-fuente + transparencia de sesgo + cobertura local

---

## 1. Visión

Antena no es otro agregador de noticias. Es el **único** producto que:

1. **Síntesis multi-fuente** — 54 fuentes cubriendo la misma noticia → 1 visión neutral
2. **Transparencia de sesgo** — Ves el desglose: 45% Neutral, 35% Opositor, 20% Oficialista
3. **Cobertura hiperlocal** — Noticias de tu ciudad, no solo Buenos Aires
4. **Modo Mate** — Escuchá las noticias mientras tomás mate (TTS)

---

## 2. Estado Actual

### ✅ Implementado
- Layout tipo Reddit (3 columnas desktop, cards mobile)
- Feed de noticias con datos reales de AKIRA
- Featured cluster (noticia con más fuentes)
- Breaking news banner (signalLevel >= 8)
- Bias distribution widget
- Time filters (Última hora / Hoy / Esta semana / Todas)
- Article detail con multimedia (YouTube/Vimeo, galería)
- Bookmarks (localStorage)
- Share (Web Share API)
- Modo Mate (TTS)
- Infinite scroll
- Mobile bottom nav
- PWA manifest

### ⬜ Crítico para Lanzamiento
- Service Worker (PWA offline)
- SEO meta tags (Open Graph, Twitter Cards)
- Dark theme
- Error boundaries
- API URL como variable de entorno
- Loading states para article detail
- Source credibility badges
- Reading time calculation

---

## 3. Plan de Lanzamiento (3 Fases)

### Fase 1: "Funciona" (Semana 1 — ~12h)

**Objetivo:** Que un usuario pueda entrar y ver noticias reales sin bugs visibles.

| # | Tarea | Esfuerzo | Por Qué |
|---|-------|----------|---------|
| 1.1 | API URL como variable de entorno | 0.5h | Configurar dev/prod |
| 1.2 | Error boundaries en Solid.js | 2h | Previene crashes |
| 1.3 | Loading states para article detail | 1h | UX básica |
| 1.4 | Fix extracción de categorías | 2h | Filtros funcionan |
| 1.5 | SEO meta tags + Open Graph | 3h | Compartir en redes |
| 1.6 | Dark theme toggle | 2h | Expectativa moderna |
| 1.7 | Source credibility badges | 1h | Confianza del usuario |

**Outcome:** Antena es usable, compartible y no crashea.

### Fase 2: "Se Siente Bien" (Semana 2 — ~10h)

**Objetivo:** Que la experiencia sea pulida y adictiva.

| # | Tarea | Esfuerzo | Por Qué |
|---|-------|----------|---------|
| 2.1 | Service Worker (PWA offline) | 4h | Mobile-first Argentina |
| 2.2 | Reading time calculation | 0.5h | UX detail |
| 2.3 | Skeletons realistas | 1h | Percepción de velocidad |
| 2.4 | Empty states con personalidad | 1h | No frustrar al usuario |
| 2.5 | Animaciones suaves (transiciones) | 2h | Se siente premium |
| 2.6 | City selector / geolocation | 1.5h | Personalización |

**Outcome:** Antena se siente como un producto terminado, no un MVP.

### Fase 3: "Se Comparte" (Semana 3 — ~8h)

**Objetivo:** Que los usuarios quieran compartirlo y volver.

| # | Tarea | Esfuerzo | Por Qué |
|---|-------|----------|---------|
| 3.1 | Deploy a Cloudflare Pages | 2h | Accesible al mundo |
| 3.2 | Analytics básico (Plausible) | 1h | Medir uso real |
| 3.3 | RSS feed por ubicación/categoría | 2h | Usuarios power |
| 3.4 | Landing page / about | 2h | Explicar el producto |
| 3.5 | Feedback mechanism | 1h | Mejorar con usuarios |

**Outcome:** Antena está online, se puede medir y los usuarios pueden dar feedback.

---

## 4. Métricas de Éxito

### Semana 1 (Lanzamiento)
- [ ] 100 visitantes únicos
- [ ] 10 shares en redes sociales
- [ ] 0 crashes reportados
- [ ] Lighthouse score > 80

### Mes 1
- [ ] 1,000 visitantes únicos
- [ ] 30% retorno semanal
- [ ] 50 bookmarks por usuario activo
- [ ] 5 minutos tiempo promedio en sitio

### Mes 3
- [ ] 10,000 visitantes únicos
- [ ] 50% retorno semanal
- [ ] 100+ fuentes activas
- [ ] 10,000+ noticias en DB

---

## 5. Principios de Diseño

1. **Velocidad primero** — Si tarda más de 2s, el usuario se va
2. **Mobile-first** — Argentina es mobile, no desktop
3. **Menos es más** — Cada feature debe justificar su existencia
4. **Transparencia** — El usuario debe ver cómo funciona el bias
5. **Local es rey** — La cobertura de tu ciudad vale más que la nacional

---

## 6. Riesgos y Mitigación

| Riesgo | Mitigación |
|--------|------------|
| API lenta o cae | Cache agresivo, fallback a datos stale |
| PWA no funciona en iOS | Graceful degradation, web app funciona igual |
| Usuarios no entienden el bias | Tooltip explicativo, diseño intuitivo |
| Pocas noticias locales | Scout semanal, auto-registro de fuentes |
| Competencia (Google News) | Diferenciación: bias + local + síntesis |

---

## 7. Stack Técnico

| Capa | Tecnología | Por Qué |
|------|-----------|---------|
| Frontend | Astro 5 + Solid.js | SSR + interactividad mínima |
| Styling | Tailwind CSS | Rápido, consistente |
| Backend | Python/FastAPI (AKIRA) | Extracción robusta |
| API | Node/Hono | Ligero, Cloudflare-ready |
| DB | SQLite | Simple, portable |
| Deploy | Cloudflare Pages | Gratis, global, rápido |
| Analytics | Plausible | Privado, ligero |

---

## 8. Próximos Pasos Inmediatos

1. **Hoy:** Mover Antena a `packages/antena` ✅
2. **Hoy:** Fix API URL como variable de entorno
3. **Hoy:** Verificar que el feed funciona con datos reales
4. **Mañana:** Error boundaries + loading states
5. **Semana:** SEO + dark theme + PWA

---

*Plan creado el 2026-04-05. Actualizar con cada avance.*
