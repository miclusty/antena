# ANTENA v2.0 — PLAN COMPLETO

> **Creado:** 2026-04-04
> **Visión:** Ser el mejor lector de noticias hiperlocales del mundo
> **Diferenciador:** Síntesis multi-fuente + transparencia de sesgo + Modo Mate

---

## 📊 Datos Disponibles desde AKIRA

| Dato | Fuente | Uso en Antena |
|------|--------|---------------|
| 1,061 fuentes | `sources` table | Fuentes destacadas, confiabilidad |
| 4,513 noticias | `news_cards` table | Feed, tendencias, filtros |
| 3,921 localidades | `locations` table | Mis Antenas, cobertura |
| 56 master articles | `master_articles` table | Síntesis del día |
| bias_score (-1 a 1) | `news_cards.bias_score` | Mapa de bias |
| is_gacetilla | `news_cards.is_gacetilla` | Ruido filtrado count |
| cluster_id | `news_cards.cluster_id` | Top clusters |
| source_ids | `news_cards.source_ids` | Count de fuentes por noticia |
| created_at | `news_cards.created_at` | Actividad reciente |
| extraction_stats | `extraction_stats` table | Stats de extracción |
| source_health | `source_health` table | Fuentes saludables |

---

## 🎨 Layout v2.0 — Sin Redundancia

```
┌──────────────────────────────────────────────────────────────────┐
│  antena.  [  Buscar en Antena...  ]  🔴 En vivo                 │
│  ─────────────────────────────────────────────────────────────  │
│  🏠Inicio  ⚖Política  💰Economía  ⚽Deportes  🚔Policiales  ...  │
├────────────┬───────────────────────────────┬────────────────────┤
│  SIDEBAR   │          FEED                 │   RIGHT PANEL      │
│ (260px)    │         (640px)               │    (270px)         │
│            │                               │                    │
│ 🔥 TOP     │  [News cards con accent bars] │ 🎯 SÍNTESIS DEL DÍA│
│ CLUSTERS   │                               │ Master article     │
│            │  ebcnoticias.com.ar           │ preview            │
│ 54 fuentes │  Hace 17d                     │ 11 fuentes · 3min  │
│ "El Concejo│                               │ [Leer síntesis →]  │
│  aprobó..."│  eldiariodemalvinas.com.ar    │                    │
│            │  Hace 1d                      │ 📈 BIAS DEL DÍA    │
│ 38 fuentes │  Malvinas Argentinas homenajeó│ ██████░░░░         │
│ "Cortan    │                               │ 45%N 35%O 20%Of   │
│  la RN9..."│  [Cargar más noticias]        │                    │
│            │                               │ 🛡️ RUIDO FILTRADO  │
│ 📡 FUENTES │                               │ 12 clickbats hoy   │
│ DESTACADAS │                               │ 3 gacetillas       │
│            │                               │                    │
│ ebcnoticias│                               │ 📡 MIS ANTENAS     │
│ ★★★★★     │                               │ 🟢 Córdoba        │
│ lanacion   │                               │ ⚪ Buenos Aires   │
│ ★★★★☆     │                               │ ⚪ Rosario        │
│            │                               │ + Agregar          │
│ 🏷️ FILTROS │                               │                    │
│ ⏱ Última hora                              │                    │
│ 📅 Hoy                                     │                    │
│ 📆 Esta semana                             │                    │
│                                            │                    │
│ ─────────────────────                      │                    │
│ 📊 STATS (compacto)                        │                    │
│ 917 fuentes · 247 hoy                      │                    │
└────────────┴───────────────────────────────┴────────────────────┘
```

---

## 📋 Plan de Implementación

### FASE 3.5: Navegación y Menú (3h)

| # | Task | Detalle | Effort |
|---|------|---------|--------|
| 3.5.1 | **Article click desktop** | En desktop, al hacer click en card → abre article inline (reemplaza feed) | 1h |
| 3.5.2 | **Menú View** | Componente con: Guardados, Mis Antenas, Modo Mate settings, Tema, Acerca de | 1.5h |
| 3.5.3 | **Sintonizar navigation** | Bottom nav "Sintonizar" → navega a SintonizarView | 0.5h |

### FASE 3.6: Sidebar Redesign (3h)

| # | Task | Detalle | Effort |
|---|------|---------|--------|
| 3.6.1 | **Top Clusters** | Fetch clusters con más fuentes, mostrar top 3 con título truncado | 1h |
| 3.6.2 | **Fuentes Destacadas** | Top 5 fuentes por cantidad de noticias, con star rating | 1h |
| 3.6.3 | **Filtros de Tiempo** | Última hora / Hoy / Esta semana / Todas → filtra feed | 0.5h |
| 3.6.4 | **Stats compacto abajo** | Mover stats al fondo del sidebar, formato compacto | 0.5h |

### FASE 3.7: Right Panel Redesign (3h)

| # | Task | Detalle | Effort |
|---|------|---------|--------|
| 3.7.1 | **Síntesis del Día** | Mostrar master article más reciente con preview | 1h |
| 3.7.2 | **Bias del Día** | Calcular distribución de bias de las últimas 50 noticias | 1h |
| 3.7.3 | **Ruido Filtrado** | Count de is_gacetilla + clickbait de hoy | 0.5h |
| 3.7.4 | **Mis Antenas** | Ubicaciones guardadas en localStorage con toggle | 0.5h |

### FASE 3.8: Features de Interacción (3h)

| # | Task | Detalle | Effort |
|---|------|---------|--------|
| 3.8.1 | **Infinite scroll** | Reemplazar "Cargar más" con IntersectionObserver | 1h |
| 3.8.2 | **Guardar/bookmarks** | localStorage para artículos favoritos | 0.5h |
| 3.8.3 | **Compartir noticia** | Web Share API + fallback copy link | 0.5h |
| 3.8.4 | **Reading time** | Calcular "X min de lectura" en cards | 0.5h |
| 3.8.5 | **Source credibility** | Badge de confiabilidad basado en source_health | 0.5h |

### FASE 3.9: Polish (2h)

| # | Task | Detalle | Effort |
|---|------|---------|--------|
| 3.9.1 | **Dark mode** | Toggle en menú, CSS variables | 1h |
| 3.9.2 | **Skeletons realistas** | Que parezcan cards reales con accent bars | 0.5h |
| 3.9.3 | **Empty states** | Ilustraciones SVG para sin resultados | 0.5h |

---

## 🗓️ Timeline

| Semana | Fases | Outcome |
|--------|-------|---------|
| **Semana 1** | 3.5 + 3.6 | Navegación + Sidebar único |
| **Semana 2** | 3.7 + 3.8 | Right Panel + Interacción |
| **Semana 3** | 3.9 + Testing | Polish + QA |

**Total: ~14 horas**

---

## 🎯 Diferenciadores Únicos

| Feature | Competidores | Antena |
|---------|-------------|--------|
| Síntesis multi-fuente | ❌ | ✅ 54 fuentes → 1 neutral |
| Desglose de voces | ❌ | ✅ 45%N 35%O 20%Of |
| Potencia de señal | ❌ | ✅ 1-10 bars |
| Ruido filtrado | ❌ | ✅ Clickbait destruido |
| Modo Mate | ❌ | ✅ TTS con speed control |
| Top Clusters | ❌ | ✅ Qué es importante hoy |
| Bias del día | ❌ | ✅ Distribución visual |
| Fuentes destacadas | ❌ | ✅ Con confiabilidad |

---

*Plan creado 2026-04-04. Listo para implementar.*
