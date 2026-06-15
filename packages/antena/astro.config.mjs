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
            { src: "/icons/icon.svg", sizes: "192x192", type: "image/svg+xml" },
            { src: "/icons/icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" }
          ],
          shortcuts: [
            {
              name: "Ultimas noticias",
              short_name: "Ultimas",
              url: "/",
              icons: [{ src: "/icons/icon.svg", sizes: "96x96" }]
            }
          ]
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          runtimeCaching: [
            {
              urlPattern: /^https?:\/\/localhost:\d+\/api\/news.*/i,
              handler: "NetworkFirst",
              options: {
                cacheName: "news-api-cache",
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
                cacheableResponse: { statuses: [0, 200] }
              }
            },
            {
              urlPattern: /^https?:\/\/.*\.(png|jpg|jpeg|svg|gif|webp)$/i,
              handler: "CacheFirst",
              options: {
                cacheName: "image-cache",
                expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 }
              }
            }
          ]
        },
        devOptions: { enabled: true }
      })
    ]
  }
});
