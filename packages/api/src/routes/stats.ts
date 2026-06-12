import { Hono } from "hono";
import type { Env } from "../lib/types";
import { getStats } from "../db/queries";
import { withCache } from "../lib/cache";

export const statsRoutes = new Hono<{ Bindings: Env }>();

// Pipeline health and stats
statsRoutes.get("/health", async (c) => {
  return withCache(async () => {
    const stats = await getStats(c.env.DB);
    const recentNews = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM news_cards WHERE created_at > datetime('now', '-1 hour')"
    ).first<{ count: number }>();

    return c.json({
      status: "ok",
      version: "1.0.0",
      stats: {
        total_news: stats.total_news,
        active_sources: stats.active_sources,
        total_locations: stats.total_locations,
        total_clusters: stats.total_clusters,
        news_last_hour: recentNews?.count ?? 0,
        news_today: stats.news_today,
        news_week: stats.news_week,
      },
      timestamp: new Date().toISOString(),
    });
  }, { ttl: 60, swr: 300 })(c.req.raw);
});

// News by location stats
statsRoutes.get("/by-location", async (c) => {
  const db = c.env.DB;
  const limit = Number(c.req.query("limit") ?? 20);
  
  const results = await db.prepare(`
    SELECT 
      l.id,
      l.name,
      l.province,
      COUNT(nc.id) as news_count,
      MAX(nc.published_at) as latest_news
    FROM locations l
    LEFT JOIN news_cards nc ON l.id = nc.location_id
    GROUP BY l.id
    ORDER BY news_count DESC
    LIMIT ?
  `).bind(limit).all();

  return c.json(results.results ?? []);
});

// News by category stats
statsRoutes.get("/by-category", async (c) => {
  const db = c.env.DB;
  
  const results = await db.prepare(`
    SELECT 
      category,
      COUNT(*) as count,
      MAX(published_at) as latest
    FROM news_cards
    WHERE category IS NOT NULL
    GROUP BY category
    ORDER BY count DESC
  `).all();

  return c.json(results.results ?? []);
});

// Source reliability report
statsRoutes.get("/sources", async (c) => {
  const db = c.env.DB;
  
  const results = await db.prepare(`
    SELECT 
      s.id,
      s.name,
      s.url,
      s.type,
      s.reliability_score,
      s.is_active,
      s.last_fetch,
      s.news_count,
      l.name as location_name,
      l.province
    FROM sources s
    LEFT JOIN locations l ON s.location_id = l.id
    ORDER BY s.news_count DESC
  `).all();

  return c.json(results.results ?? []);
});
