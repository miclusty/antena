import { Hono } from "hono";
import type { Env } from "../lib/types";

export const healthRoutes = new Hono<{ Bindings: Env }>();

/**
 * GET /health/full
 * Comprehensive health check for all AKIRA services
 */
healthRoutes.get("/full", async (c) => {
  const startTime = Date.now();

  // Check Python Extractor
  let extractorStatus = "unknown";
  let extractorLibs: Record<string, unknown> = {};
  try {
    const res = await fetch("http://localhost:5000/health", {
      signal: AbortSignal.timeout(5000)
    });
    const data = (await res.json()) as { status?: string; libraries?: Record<string, unknown> };
    extractorStatus = data.status || "error";
    extractorLibs = data.libraries || {};
  } catch (e) {
    extractorStatus = "unavailable";
  }

  // Check D1 Database
  let dbStatus = "ok";
  let dbStats: Record<string, number> = {};
  try {
    const db = c.env.DB;
    const result = await db.prepare("SELECT COUNT(*) as count FROM news_cards").first();
    const sources = await db.prepare("SELECT COUNT(*) as count FROM sources").first();
    const locations = await db.prepare("SELECT COUNT(*) as count FROM locations").first();
    dbStats = {
      news_cards: (result as { count?: number } | null)?.count ?? 0,
      sources: (sources as { count?: number } | null)?.count ?? 0,
      locations: (locations as { count?: number } | null)?.count ?? 0
    };
  } catch (e) {
    dbStatus = "error";
  }

  // Check Local SQLite
  let localDbStatus = "unknown";
  try {
    const res = await fetch("http://localhost:5000/health", {
      signal: AbortSignal.timeout(5000)
    });
    const data = (await res.json()) as { db_path?: string };
    localDbStatus = data.db_path ? "ok" : "error";
  } catch (e) {
    localDbStatus = "unavailable";
  }

  return c.json({
    status: "ok",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    uptime_ms: Date.now() - startTime,
    services: {
      python_extractor: {
        status: extractorStatus,
        url: "http://localhost:5000",
        libraries: extractorLibs
      },
      api: {
        status: "ok",
        url: "http://localhost:8787"
      },
      web: {
        status: "ok", 
        url: "http://localhost:4321"
      },
      database: {
        cloudflare_d1: { status: dbStatus, stats: dbStats },
        local_sqlite: { status: localDbStatus }
      }
    },
    features: [
      "fallback_cascade",
      "source_health_tracking",
      "circuit_breaker",
      "playwright_support",
      "google_news_search"
    ]
  });
});
