import { defineConfig } from "astro/config";
import solidJs from "@astrojs/solid-js";
import tailwind from "@astrojs/tailwind";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  integrations: [solidJs(), tailwind()],
  site: "https://www.antena.com.ar",
  output: "static",
  vite: {
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.svg", "offline.html"],
        manifest: {
          name: "Antena — Sintoniza tu realidad",
          short_name: "Antena",
          description: "Noticias hiperlocales de Argentina sintetizadas de multiples fuentes",
          theme_color: "#0F1117",
          background_color: "#F9F6F0",
          display: "standalone",
          orientation: "portrait-primary",
          scope: "/",
          start_url: "/",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
          ],
          shortcuts: [
            {
              name: "Ultimas noticias",
              short_name: "Ultimas",
              url: "/",
              icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }]
            }
          ]
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          navigateFallback: "/offline.html",
          navigateFallbackDenylist: [/^\/api\//, /\.(?:js|css|map|json)$/],
          runtimeCaching: [
            {
              urlPattern: /^https?:\/\/(localhost:\d+|akira-api\.miclusty\.workers\.dev)\/api\/news.*/i,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "news-api-cache",
                expiration: { maxEntries: 30, maxAgeSeconds: 60 * 5 },
                cacheableResponse: { statuses: [0, 200] }
              }
            },
            {
              urlPattern: /^https?:\/\/akira-api\.miclusty\.workers\.dev\/api\/img.*/i,
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "img-proxy-cache",
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
                cacheableResponse: { statuses: [0, 200] }
              }
            }
          ]
        },
        devOptions: { enabled: true }
      })
    ]
  }
});
