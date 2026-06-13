import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env } from "./lib/types";
import { newsRoutes } from "./routes/news";
import { locationsRoutes } from "./routes/locations";
import { categoriesRoutes } from "./routes/categories";
import { ingestRoutes } from "./routes/ingest";
import { imagesRoutes } from "./routes/images";
import { imageRoutes } from "./routes/image";
import { searchRoutes } from "./routes/search";
import { trackRoutes } from "./routes/track";
import { sitemapRoutes } from "./routes/sitemap";
import { rssRoutes } from "./routes/rss";
import { statsRoutes } from "./routes/stats";
import { extractUnifiedRoutes } from "./routes/extract-unified";
import { healthRoutes } from "./routes/health";
import { synthesisRoutes } from "./routes/synthesis";
import { handleRefreshCron } from "./crons/refresh";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({
  origin: (origin) => {
    const allowed = [
      "http://localhost:4321",
      "http://localhost:4322",
      "http://localhost:4324",
      "http://localhost:4400",
      /^http:\/\/192\.168\.\d+\.\d+:(4321|4400)$/,
      "https://akira.ar",
      "https://www.akira.ar",
      "https://akira.pages.dev",
      // Custom domains (production)
      "https://antena.com.ar",
      "https://www.antena.com.ar",
    ];
    if (!origin) return "*";
    if (allowed.includes(origin)) return origin;
    if (allowed.some(a => a instanceof RegExp && a.test(origin))) return origin;
    return null;
  },
  credentials: true,
}));
app.use("*", logger());

// Routes
app.route("/api/news", newsRoutes);
app.route("/api/locations", locationsRoutes);
app.route("/api/categories", categoriesRoutes);
app.route("/api/news", ingestRoutes);
app.route("/api/images", imagesRoutes);
app.route("/api/img", imageRoutes);
app.route("/api/search", searchRoutes);
app.route("/api/track", trackRoutes);
app.route("/api/rss", rssRoutes);
app.route("/api/stats", statsRoutes);
app.route("/api/extract", extractUnifiedRoutes);
app.route("/health", healthRoutes);
app.route("/api/synthesis", synthesisRoutes);
app.route("/", sitemapRoutes);

// Simple health endpoint
app.get("/api/health", (c) => c.json({
  status: "ok",
  version: "1.0.0",
  features: [
    "python_extractor",
    "newspaper3k",
    "goose3",
    "feedparser",
    "playwright",
    "google_news"
  ],
  timestamp: new Date().toISOString()
}));

app.get("/__cron/refresh", async (c) => {
  await handleRefreshCron(c.env);
  return c.json({ ok: true });
});

export default app;

export async function scheduled(
  _event: ScheduledController,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  await handleRefreshCron(env);
}
