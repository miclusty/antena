# Arquitectura PWA: Astro + Solid.js + Cloudflare FREE Tier

## Tabla de Contenidos

1. [Configuración de Astro](#1-configuración-de-astro)
2. [Solid.js Islands](#2-solidjs-islands)
3. [Configuración PWA](#3-configuración-pwa)
4. [Modo Offline con IndexedDB](#4-modo-offline-con-indexeddb)
5. [Despliegue en Cloudflare](#5-despliegue-en-cloudflare)
6. [Limitaciones del FREE Tier](#6-limitaciones-del-free-tier)
7. [Best Practices Mobile](#7-best-practices-para-mobile)
8. [Haptic Feedback](#8-haptic-feedback)
9. [Web Speech API](#9-web-speech-api)

---

## 1. Configuración de Astro

### astro.config.mjs

```js
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import solidJs from '@astrojs/solid-js';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  output: 'server', // SSR para rutas dinámicas, con prerender para estáticas
  adapter: cloudflare({
    imageService: { build: 'compile', runtime: 'cloudflare-binding' },
    sessionKVBindingName: 'SESSION',
    // prerenderEnvironment: 'node', // Descomentar si usás node:fs en prerender
  }),
  integrations: [
    solidJs(),
  ],
  vite: {
    plugins: [
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
        manifest: {
          name: 'Antena - Noticias Hiperlocales',
          short_name: 'Antena',
          description: 'Noticias hiperlocales de Argentina',
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'portrait-primary',
          scope: '/',
          start_url: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/api\..*\/api\/news.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'news-api-cache',
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^https:\/\/.*\.(png|jpg|jpeg|svg|gif|webp)$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'image-cache',
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
        devOptions: { enabled: true },
      }),
    ],
    build: {
      minify: false, // Para debugging local; true en producción
    },
  },
});
```

### tsconfig.json

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"],
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-js"
  }
}
```

### package.json scripts

```json
{
  "scripts": {
    "dev": "wrangler types && astro dev",
    "start": "wrangler types && astro dev",
    "build": "wrangler types && astro check && astro build",
    "preview": "astro preview",
    "deploy": "astro build && wrangler deploy",
    "astro": "astro"
  }
}
```

### Estrategia de renderizado híbrido

```
Rutas prerender (SSG):
  - /                    → Home page (prerender)
  - /ciudad/[slug]       → Prerender con getStaticPaths
  - /categorias/[slug]   → Prerender con getStaticPaths
  - /noticia/[slug]      → Prerender con getStaticPaths (generar top N)

Rutas on-demand (SSR):
  - /api/news            → Endpoint dinámico
  - /api/news/:id        → Endpoint dinámico
  - /search?q=...        → Búsqueda en tiempo real
  - /api/extract         → Proxy a AKIRA
```

En cada página `.astro`, controlar con:
```astro
---
// Prerender (SSG)
export const prerender = true;

// O on-demand (SSR)
export const prerender = false;
---
```

---

## 2. Solid.js Islands

### Configuración

Ya incluida en astro.config.mjs con `solidJs()`. No se necesita configuración adicional si es el único framework JSX.

### Patrones de hidratación

```astro
<!-- Hidratación inmediata -->
<Navigation client:load />

<!-- Hidratación al ser visible (mejor para mobile) -->
<NewsCard client:visible />
<InfiniteScroll client:visible />

<!-- Hidratación al interactuar (mejor performance) -->
<SearchBar client:only="solid" />
<TTSSpeaker client:visible />

<!-- Hidratación media (después de idle) -->
<CommentSection client:media="(min-width: 50em)" />
```

### Ejemplo: Componente Solid para TTS

```tsx
// src/components/TTSSpeaker.tsx
import { createSignal, createEffect } from 'solid-js';

interface TTSSpeakerProps {
  text: string;
  lang?: string;
}

export default function TTSSpeaker(props: TTSSpeakerProps) {
  const [speaking, setSpeaking] = createSignal(false);
  const [supported, setSupported] = createSignal(true);

  createEffect(() => {
    if (!('speechSynthesis' in globalThis)) {
      setSupported(false);
    }
  });

  const speak = () => {
    if (!supported()) return;

    // Haptic feedback antes de hablar
    if ('vibrate' in navigator) {
      navigator.vibrate(15);
    }

    const utterance = new SpeechSynthesisUtterance(props.text);
    utterance.lang = props.lang || 'es-AR';
    utterance.rate = 1;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  };

  const stop = () => {
    speechSynthesis.cancel();
    setSpeaking(false);
  };

  return (
    <button
      onClick={speaking() ? stop : speak}
      class="tts-button"
      aria-label={speaking() ? 'Detener lectura' : 'Escuchar noticia'}
    >
      {speaking() ? '⏹ Detener' : '🔊 Escuchar'}
    </button>
  );
}
```

### Ejemplo: Infinite Scroll con Solid

```tsx
// src/components/InfiniteScroll.tsx
import { createSignal, createEffect, onCleanup } from 'solid-js';
import { openDB } from 'idb';

interface InfiniteScrollProps {
  apiUrl: string;
  renderItem: (item: any) => JSX.Element;
}

export default function InfiniteScroll(props: InfiniteScrollProps) {
  const [items, setItems] = createSignal<any[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [page, setPage] = createSignal(1);
  const [hasMore, setHasMore] = createSignal(true);
  let containerRef: HTMLDivElement | undefined;

  const loadMore = async () => {
    if (loading() || !hasMore()) return;
    setLoading(true);

    try {
      const res = await fetch(`${props.apiUrl}?page=${page()}`);
      const data = await res.json();

      setItems(prev => [...prev, ...data.news]);
      setHasMore(data.hasMore);
      setPage(prev => prev + 1);

      // Cache en IndexedDB para offline
      const db = await openDB('antena-cache', 1, {
        upgrade(db) { db.createObjectStore('news', { keyPath: 'id' }); }
      });
      const tx = db.transaction('news', 'readwrite');
      await Promise.all(data.news.map(item => tx.store.put(item)));
    } catch (e) {
      // Fallback a IndexedDB si no hay red
      const db = await openDB('antena-cache', 1);
      const cached = await db.getAll('news');
      setItems(cached);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  // IntersectionObserver para scroll infinito
  createEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { root: containerRef, rootMargin: '200px' }
    );
    const sentinel = document.getElementById('scroll-sentinel');
    if (sentinel) observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div ref={containerRef}>
      {items().map(props.renderItem)}
      {loading() && <div class="loader">Cargando...</div>}
      <div id="scroll-sentinel" />
    </div>
  );
}
```

### Compartir estado entre islands

```tsx
// src/stores/newsStore.ts
import { createSignal } from 'solid-js';

const [favorites, setFavorites] = createSignal<string[]>([]);

export function useFavorites() {
  return {
    get favorites() { return favorites(); },
    add: (id: string) => setFavorites(prev => [...prev, id]),
    remove: (id: string) => setFavorites(prev => prev.filter(f => f !== id)),
    has: (id: string) => favorites().includes(id),
  };
}
```

---

## 3. Configuración PWA

### Manifest (public/manifest.json)

```json
{
  "name": "Antena - Noticias Hiperlocales de Argentina",
  "short_name": "Antena",
  "description": "Noticias hiperlocales de Argentina en tiempo real",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "theme_color": "#0f172a",
  "background_color": "#0f172a",
  "categories": ["news", "magazine"],
  "lang": "es-AR",
  "dir": "ltr",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-maskable-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/icon-1024x1024.png",
      "sizes": "1024x1024",
      "type": "image/png",
      "purpose": "any"
    }
  ],
  "screenshots": [
    {
      "src": "/screenshots/home-mobile.png",
      "sizes": "540x720",
      "type": "image/png",
      "form_factor": "narrow"
    },
    {
      "src": "/screenshots/home-desktop.png",
      "sizes": "1280x720",
      "type": "image/png",
      "form_factor": "wide"
    }
  ],
  "shortcuts": [
    {
      "name": "Últimas noticias",
      "url": "/ultimas",
      "icons": [{ "src": "/icons/shortcut-latest.png", "sizes": "96x96" }]
    },
    {
      "name": "Mi ciudad",
      "url": "/mi-ciudad",
      "icons": [{ "src": "/icons/shortcut-city.png", "sizes": "96x96" }]
    }
  ]
}
```

### Service Worker personalizado

`@vite-pwa/astro` genera el service worker automáticamente con Workbox. Para control total, usar strategy `injectManifest`:

```js
// En astro.config.mjs, dentro de VitePWA:
{
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.ts',
}
```

```ts
// src/sw.ts
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { BackgroundSyncPlugin } from 'workbox-background-sync';

declare let self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// API de noticias: NetworkFirst con fallback a cache
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/news'),
  new NetworkFirst({
    cacheName: 'api-news',
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 86400 }),
    ],
  })
);

// Imágenes de R2: CacheFirst
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'images-r2',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 2592000 }),
    ],
  })
);

// Páginas HTML: StaleWhileRevalidate
registerRoute(
  ({ request }) => request.destination === 'document',
  new StaleWhileRevalidate({
    cacheName: 'pages',
    plugins: [
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 604800 }),
    ],
  })
);

// Background sync para acciones offline (favoritos, lectura después)
const bgSyncPlugin = new BackgroundSyncPlugin('offlineQueue', {
  maxRetentionTime: 24 * 60,
});

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/user/'),
  new NetworkFirst({
    cacheName: 'user-actions',
    plugins: [bgSyncPlugin],
  }),
  'POST'
);

// Offline fallback page
self.addEventListener('fetch', (event) => {
  if (event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/offline.html'))
    );
  }
});
```

### Iconos requeridos

```
public/
├── icons/
│   ├── icon-192x192.png        # Android Chrome home screen
│   ├── icon-512x512.png        # Splash screen
│   ├── icon-maskable-512x512.png  # Android adaptive icon
│   ├── icon-1024x1024.png      # App stores
│   └── shortcut-*.png          # App shortcuts
├── apple-touch-icon.png        # iOS home screen (180x180)
├── favicon.ico
└── offline.html                # Página offline
```

### iOS Safari meta tags (en layout.astro)

```html
<head>
  <link rel="manifest" href="/manifest.json" />
  <meta name="theme-color" content="#0f172a" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Antena" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="apple-touch-startup-image" href="/splash/apple-splash-2048-2732.png"
        media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" />
</head>
```

---

## 4. Modo Offline con IndexedDB

### Wrapper con idb (wrapper promise-based de IndexedDB)

```ts
// src/lib/db.ts
import { openDB, type DBSchema } from 'idb';

interface AntenaDB extends DBSchema {
  news: {
    key: string;
    value: {
      id: string;
      title: string;
      excerpt: string;
      url: string;
      image_url: string;
      source: string;
      published_at: string;
      cached_at: number;
      content?: string;
    };
  };
  settings: {
    key: string;
    value: { theme: string; city: string; tts_rate: number };
  };
  readLater: {
    key: string;
    value: { newsId: string; savedAt: number };
  };
}

const DB_NAME = 'antena-db';
const DB_VERSION = 1;

export async function getDB() {
  return openDB<AntenaDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('news')) {
        const store = db.createObjectStore('news', { keyPath: 'id' });
        store.createIndex('published_at', 'published_at');
        store.createIndex('source', 'source');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('readLater')) {
        db.createObjectStore('readLater', { keyPath: 'newsId' });
      }
    },
  });
}

export async function cacheNews(news: AntenaDB['news']['value'][]) {
  const db = await getDB();
  const tx = db.transaction('news', 'readwrite');
  await Promise.all(news.map(item => tx.store.put({ ...item, cached_at: Date.now() })));
  await tx.done;
}

export async function getCachedNews(limit = 20) {
  const db = await getDB();
  return db.getAllFromIndex('news', 'published_at', IDBKeyRange.upperBound(Date.now()), limit);
}

export async function getOfflineNews() {
  const db = await getDB();
  const all = await db.getAll('news');
  return all.sort((a, b) => b.published_at.localeCompare(a.published_at));
}
```

### Estrategia de cache

```
1. Online:
   - Fetch desde API → renderizar → cachear en IndexedDB
   - Service Worker cachea assets estáticos

2. Offline:
   - Service Worker intercepta request → responde con HTML cacheado
   - Solid.js island detecta offline → carga datos desde IndexedDB
   - UI muestra banner "Modo offline"

3. Reconexión:
   - Background Sync reenvía acciones pendientes
   - Auto-refresh de noticias
```

### Detector de conectividad (Solid.js)

```tsx
// src/components/ConnectionStatus.tsx
import { createSignal, createEffect, onCleanup } from 'solid-js';

export default function ConnectionStatus() {
  const [online, setOnline] = createSignal(navigator.onLine);

  createEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    onCleanup(() => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    });
  });

  if (online()) return null;

  return (
    <div class="offline-banner" role="alert">
      <span>Estás sin conexión. Mostrando contenido cacheado.</span>
    </div>
  );
}
```

---

## 5. Despliegue en Cloudflare

### wrangler.jsonc

```jsonc
{
  "name": "antena",
  "compatibility_date": "2025-05-21",
  "compatibility_flags": ["nodejs_compat"],
  "main": "@astrojs/cloudflare/entrypoints/server",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "antena-db",
      "database_id": "<tu-database-id>"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "CACHE",
      "id": "<tu-kv-namespace-id>"
    }
  ],
  "r2_buckets": [
    {
      "binding": "IMAGES",
      "bucket_name": "antena-images"
    }
  ],
  "vars": {
    "AKIRA_URL": "http://localhost:5000",
    "NODE_ENV": "production"
  }
}
```

### Flujo de deploy

```bash
# 1. Crear recursos en Cloudflare
npx wrangler d1 create antena-db
npx wrangler kv:namespace create CACHE
npx wrangler r2 bucket create antena-images

# 2. Copiar IDs al wrangler.jsonc

# 3. Migrar DB
npx wrangler d1 execute antena-db --file=./schema.sql

# 4. Deploy
npm run deploy

# O desde GitHub: conectar repo en Cloudflare Dashboard
# Build command: npm run build
# Build directory: dist
```

### _headers (public/_headers)

```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/icons/*
  Cache-Control: public, max-age=31536000, immutable

/manifest.json
  Cache-Control: public, max-age=3600
  Content-Type: application/manifest+json
```

### _redirects (public/_redirects)

```
/offline    /offline.html   200
```

---

## 6. Limitaciones del FREE Tier

### Workers

| Límite | Valor | Impacto |
|--------|-------|---------|
| Requests | 100,000/día | ~2,777 req/hora. Suficiente para ~10k DAU |
| CPU time | 10 ms | **CRÍTICO** - Muy bajo para SSR complejo |
| Memory | 128 MB | OK para Astro islands |
| Subrequests | 50/request | OK si no haces muchas llamadas externas |
| Worker size | 3 MB (gzip) | Cuidado con dependencias grandes |
| Worker startup | 1 segundo | OK |

### D1

| Límite | Valor | Impacto |
|--------|-------|---------|
| Databases | 1 (Free) | Solo una DB |
| Max size | 500 MB | ~500k noticias con metadata |
| Queries/invocation | 50 | Limita batch queries |
| Max row size | 2 MB | OK para artículos |
| SQL duration | 30 segundos | OK |

### KV

| Límite | Valor | Impacto |
|--------|-------|---------|
| Reads | 100,000/día | Se comparte con Workers requests |
| Writes | 1,000/día | **CRÍTICO** - Muy bajo para writes frecuentes |
| Storage | 1 GB | OK para cache |
| Value size | 25 MiB | OK |
| Eventual consistency | 60s global | OK para cache, no para datos críticos |

### R2

| Límite | Valor | Impacto |
|--------|-------|---------|
| Storage | 10 GB | ~10,000 imágenes optimizadas |
| Reads (Class A) | 1M/mes | OK |
| Writes (Class B) | 1M/mes | OK |

### Pages (static assets)

| Límite | Valor |
|--------|-------|
| Files per version | 20,000 |
| File size | 25 MiB |

### ⚠️ Limitaciones críticas a considerar

1. **CPU time de 10ms** en Workers Free es el mayor cuello de botella. Astro SSR + Solid hydration puede exceder esto. Solución: usar `prerender = true` para la mayoría de páginas y solo SSR para endpoints API.

2. **KV writes de 1,000/día** es muy bajo. No usar KV para datos que cambien frecuentemente. Usar solo para cache de lectura y sesiones.

3. **1 sola D1 database** en free tier. Si necesitás más, hay que escalar.

4. **100k requests/día** de Workers se comparte entre todas las llamadas SSR + API. Con prefetch y cache agresivo, es manejable.

### Estrategia para mantenerse en FREE tier

```
- Prerender todo lo posible (SSG) → no consume Workers requests
- Cache agresivo en KV + Service Worker → reduce requests al Worker
- Imágenes desde R2 con CDN de Cloudflare → no consume Workers
- IndexedDB en cliente → reduce reads a D1
- Batch queries a D1 → reduce subrequests
```

---

## 7. Best Practices para Mobile

### Performance

```
1. Usar client:visible en lugar de client:load para islands no críticas
2. Minimizar JavaScript hydratable: Solid.js es ~7KB gzip (vs React ~42KB)
3. Prerender máximo contenido estático
4. Usar Astro Image con cloudflare-binding para resize on-demand
5. Lazy load imágenes con loading="lazy"
6. Font display: swap para evitar FOIT
7. Critical CSS inline, resto async
```

### Astro config para performance

```js
export default defineConfig({
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks: {
            solid: ['solid-js', 'solid-js/web', 'solid-js/store'],
          },
        },
      },
    },
  },
});
```

### Mobile-first CSS

```css
/* Viewport meta en layout */
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />

/* Safe areas para iOS */
body {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}
```

### PWA Install Prompt

```tsx
// src/components/PWAInstall.tsx
import { createSignal, createEffect } from 'solid-js';

export default function PWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = createSignal<any>(null);
  const [showInstall, setShowInstall] = createSignal(false);

  createEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
  });

  const install = async () => {
    const prompt = deferredPrompt();
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice;
    setDeferredPrompt(null);
    setShowInstall(false);
  };

  if (!showInstall()) return null;

  return (
    <button onClick={install} class="pwa-install-btn">
      Instalar Antena
    </button>
  );
}
```

---

## 8. Haptic Feedback

### navigator.vibrate - Soporte por plataforma

| Plataforma | Soporte | Notas |
|------------|---------|-------|
| Android Chrome | ✅ Completo | Todos los patrones funcionan |
| Android PWA | ✅ Completo | Mismo que Chrome |
| iOS Safari | ✅ Desde iOS 17.4 | Limitado a patrones simples |
| iOS PWA (standalone) | ✅ Desde iOS 17.4 | Mismo que Safari |
| Desktop | ❌ | navigator.vibrate no existe |

### Implementación segura

```ts
// src/lib/haptic.ts

/**
 * Vibrate con fallback seguro para plataformas sin soporte
 */
export function vibrate(pattern: number | number[] = 15): boolean {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Patrones predefinidos
 */
export const HapticPattern = {
  tap: 15,
  success: [15, 50, 15],
  error: [30, 50, 30, 50, 30],
  long: 50,
  double: [15, 100, 15],
} as const;

/**
 * Hook para Solid.js
 */
export function useHaptic() {
  const isSupported = 'vibrate' in navigator;

  return {
    isSupported,
    vibrate: (pattern: keyof typeof HapticPattern | number | number[]) => {
      if (!isSupported) return false;
      const p = typeof pattern === 'string' ? HapticPattern[pattern] : pattern;
      return vibrate(p);
    },
  };
}
```

### Uso en componentes Solid

```tsx
import { useHaptic, HapticPattern } from '../lib/haptic';

export default function NewsCard(props: { news: any }) {
  const { vibrate, isSupported } = useHaptic();

  const handleSave = () => {
    vibrate(HapticPattern.success);
    // ... save logic
  };

  const handleTTS = () => {
    vibrate(HapticPattern.tap);
    // ... TTS logic
  };

  return (
    <article>
      <h3>{props.news.title}</h3>
      <button onClick={handleSave}>Guardar</button>
      <button onClick={handleTTS}>Escuchar</button>
    </article>
  );
}
```

### Nota importante sobre iOS

iOS 17.4+ soporta `navigator.vibrate` pero con limitaciones:
- Solo patrones simples (un número o array de 2 elementos)
- No funciona en background
- El usuario debe haber interactuado con la página primero
- No hay control de intensidad (solo duración)

---

## 9. Web Speech API

### speechSynthesis (Text-to-Speech) - Soporte

| Plataforma | Soporte | Voces en español | Notas |
|------------|---------|------------------|-------|
| Android Chrome | ✅ Excelente | 3+ voces ES | Mejor soporte |
| Android PWA | ✅ Excelente | Mismo que Chrome | Funciona en standalone |
| iOS Safari | ✅ Bueno | 1-2 voces ES | Limitaciones |
| iOS PWA | ⚠️ Parcial | 1 voz ES | Ver abajo |
| Desktop Chrome | ✅ Excelente | 2+ voces ES | |
| Desktop Safari | ✅ Bueno | 1 voz ES | |

### Limitaciones iOS Safari vs Android Chrome

#### iOS Safari

```
1. speechSynthesis.speak() REQUIERE interacción del usuario (click/tap)
   - No se puede iniciar automáticamente al cargar la página
   - No funciona en response a timers sin interacción previa

2. speechSynthesis.pause() / resume() tienen bugs conocidos
   - En iOS 17.x, pause/resume no funciona consistentemente
   - Workaround: usar cancel() + speak() desde el offset

3. speechSynthesis.getVoices() es ASÍNCRONO en iOS
   - Las voces no están disponibles inmediatamente
   - Escuchar evento 'voiceschanged'

4. Límite de duración: ~15 segundos por utterance en background
   - En foreground funciona bien

5. PWA standalone: funciona pero con las mismas restricciones

6. No hay soporte para SpeechRecognition en iOS Safari (solo macOS)
```

#### Android Chrome

```
1. speechSynthesis funciona sin restricciones de interacción
   - Puede iniciar automáticamente

2. Múltiples voces en español disponibles
   - Google español (España)
   - Google español (Latinoamérica)
   - Voces del sistema

3. SpeechRecognition también disponible
   - No necesario para este proyecto (solo TTS)

4. PWA standalone: funciona igual que en browser

5. No hay límite de duración conocido
```

### Implementación robusta de TTS

```tsx
// src/components/RobustTTS.tsx
import { createSignal, createEffect, onCleanup } from 'solid-js';

interface RobustTTSProps {
  text: string;
  lang?: string;
  rate?: number;
}

export default function RobustTTS(props: RobustTTSProps) {
  const [speaking, setSpeaking] = createSignal(false);
  const [paused, setPaused] = createSignal(false);
  const [voices, setVoices] = createSignal<SpeechSynthesisVoice[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [userInteracted, setUserInteracted] = createSignal(false);
  let utterance: SpeechSynthesisUtterance | null = null;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const supported = 'speechSynthesis' in globalThis;

  // Cargar voces
  createEffect(() => {
    if (!supported) return;

    const loadVoices = () => {
      const v = speechSynthesis.getVoices();
      if (v.length > 0) setVoices(v);
    };

    loadVoices();
    speechSynthesis.addEventListener('voiceschanged', loadVoices);
    onCleanup(() => speechSynthesis.removeEventListener('voiceschanged', loadVoices));
  });

  // Track user interaction (necesario para iOS)
  createEffect(() => {
    const handler = () => setUserInteracted(true);
    document.addEventListener('click', handler, { once: true });
    document.addEventListener('touchstart', handler, { once: true });
    onCleanup(() => {
      document.removeEventListener('click', handler);
      document.removeEventListener('touchstart', handler);
    });
  });

  const getSpanishVoice = () => {
    const allVoices = voices();
    // Preferir voz latinoamericana
    return allVoices.find(v => v.lang.startsWith('es-AR')) ||
           allVoices.find(v => v.lang.startsWith('es-MX')) ||
           allVoices.find(v => v.lang.startsWith('es-')) ||
           allVoices.find(v => v.lang.startsWith('es')) ||
           null;
  };

  const speak = () => {
    if (!supported) {
      setError('TTS no soportado en este navegador');
      return;
    }

    if (isIOS && !userInteracted()) {
      setError('Tocá la pantalla primero para activar la voz');
      return;
    }

    // Haptic feedback
    if ('vibrate' in navigator) {
      navigator.vibrate(15);
    }

    // Cancelar cualquier speech anterior
    speechSynthesis.cancel();

    utterance = new SpeechSynthesisUtterance(props.text);
    utterance.lang = props.lang || 'es-AR';
    utterance.rate = props.rate || 1;
    utterance.pitch = 1;

    const voice = getSpanishVoice();
    if (voice) utterance.voice = voice;

    utterance.onstart = () => {
      setSpeaking(true);
      setPaused(false);
      setError(null);
    };

    utterance.onend = () => {
      setSpeaking(false);
      setPaused(false);
    };

    utterance.onerror = (e) => {
      setSpeaking(false);
      setPaused(false);
      setError(`Error: ${e.error}`);
    };

    speechSynthesis.speak(utterance);
  };

  const pause = () => {
    if (isIOS) {
      // iOS workaround: cancel y guardar posición
      speechSynthesis.cancel();
      setPaused(true);
    } else {
      speechSynthesis.pause();
      setPaused(true);
    }
  };

  const resume = () => {
    if (isIOS) {
      // iOS: re-start desde el beginning (no hay resume confiable)
      if (utterance) speechSynthesis.speak(utterance);
    } else {
      speechSynthesis.resume();
    }
    setPaused(false);
  };

  const stop = () => {
    speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
  };

  // Cleanup
  onCleanup(() => {
    speechSynthesis.cancel();
  });

  if (!supported) return null;

  return (
    <div class="tts-control">
      {!speaking() && !paused() && (
        <button onClick={speak} aria-label="Escuchar noticia">
          🔊 Escuchar
        </button>
      )}
      {speaking() && !paused() && (
        <>
          <button onClick={pause}>⏸ Pausar</button>
          <button onClick={stop}>⏹ Detener</button>
        </>
      )}
      {paused() && (
        <button onClick={resume}>▶ Continuar</button>
      )}
      {error() && <span class="tts-error">{error()}</span>}
    </div>
  );
}
```

### Workaround para iOS pause/resume

```ts
/**
 * iOS no soporta pause/resume correctamente.
 * Esta función trackea el progreso y permite "resume" manual.
 */
function createIOSSpeechTracker() {
  let charIndex = 0;
  let fullText = '';

  return {
    start(text: string) {
      fullText = text;
      charIndex = 0;
    },
    getRemaining(): string {
      return fullText.substring(charIndex);
    },
    updateBoundary(charIdx: number) {
      charIndex = charIdx;
    },
  };
}
```

---

## Resumen de Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare CDN (edge)                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Cloudflare Pages (static)                 │  │
│  │  HTML prerendered + CSS + JS + icons + manifest       │  │
│  │  Service Worker (workbox) → cache assets + API        │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Cloudflare Worker (SSR)                   │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────────────────┐  │  │
│  │  │ D1 DB   │  │ KV      │  │ R2 Images           │  │  │
│  │  │ (noticias│  │ (cache  │  │ (imágenes de       │  │  │
│  │  │  fuentes)│  │  sesión)│  │  noticias)         │  │  │
│  │  └─────────┘  └─────────┘  └─────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────────┐
│                    Cliente (PWA)                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Astro (SSG shell) + Solid.js Islands                 │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │  │
│  │  │ IndexedDB│  │ Service  │  │ Web Speech API   │   │  │
│  │  │ (offline │  │ Worker   │  │ (TTS en español) │   │  │
│  │  │  cache)  │  │ (cache)  │  │                  │   │  │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Dependencias

```json
{
  "dependencies": {
    "astro": "^6.0.0",
    "@astrojs/cloudflare": "^13.0.0",
    "@astrojs/solid-js": "^6.0.0",
    "solid-js": "^1.9.0",
    "idb": "^8.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0"
  },
  "devDependencies": {
    "vite-plugin-pwa": "^1.0.0",
    "workbox-window": "^7.0.0",
    "wrangler": "^4.0.0",
    "@astrojs/check": "^0.9.0",
    "typescript": "^5.6.0"
  }
}
```

## Checklist de lanzamiento

- [ ] Generar iconos PWA (192, 512, maskable, apple-touch-icon)
- [ ] Configurar wrangler.jsonc con bindings reales
- [ ] Crear D1 database y ejecutar migraciones
- [ ] Crear KV namespace para cache/sesión
- [ ] Crear R2 bucket para imágenes
- [ ] Configurar _headers y _redirects
- [ ] Testear PWA install en iOS Safari
- [ ] Testear PWA install en Android Chrome
- [ ] Testear modo offline (airplane mode)
- [ ] Testear TTS en iOS y Android
- [ ] Testear haptic feedback en Android
- [ ] Verificar CPU time < 10ms en Workers
- [ ] Verificar KV reads < 100k/día
- [ ] Verificar Workers requests < 100k/día
- [ ] Configurar GitHub → Cloudflare Pages CI/CD
