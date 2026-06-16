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

// Live radio directory
// ──────────────────────────────────────────────────────────
// Powering the persistent player (/radios page + floating
// play bar in the homepage). 818+ radios with stream_url —
// most use HLS (.m3u8) or MP3/AAC over HTTPS. The page
// filters by city when the device is following a pueblo
// (via /api/follows).
//
// Response shape: [{ id, name, stream_url, website,
// city, province, codgl, tags, type, source }]
statsRoutes.get("/radios", async (c) => {
  const db = c.env.DB;
  const limit = Math.min(Number(c.req.query("limit") ?? 2000), 5000);
  const codgl = c.req.query("codgl");
  const province = c.req.query("province");

  // The radios live in a separate table (argentine_media) that
  // gets populated by media/link_sources.py and
  // media/discover_via_gnews.py. The D1 sync is best-effort;
  // until then the radios are not queryable from D1, so we
  // ship them via AKIRA's /medios endpoint instead and cache
  // the result in Cloudflare cache.
  const cache = caches.default;
  const cacheKey = new Request(`https://akira-api.miclusty.workers.dev/api/stats/radios?limit=${limit}&codgl=${codgl ?? ''}&province=${province ?? ''}`);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.json() as { items: unknown[]; cached: boolean; source: string };
    body.cached = true;
    return c.json(body);
  }

  // Try AKIRA first. If unreachable, fall back to D1 sources
  // table (where we only have ~22 radios with RSS).
  const akiraBase = c.env.AKIRA_URL;
  let items: unknown[] = [];
  let source = 'd1';
  if (akiraBase) {
    try {
      const url = new URL(`${akiraBase}/medios/radios`);
      url.searchParams.set('limit', String(limit));
      if (codgl) url.searchParams.set('codgl', codgl);
      if (province) url.searchParams.set('province', province);
      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'AntenaRadiosProxy/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json() as { items?: unknown[] };
        items = data.items ?? [];
        source = 'akira';
      }
    } catch {
      // fall through to D1
    }
  }
  if (!items.length) {
    // Fallback: D1 sources table (only the 22 with RSS).
    const where: string[] = ["type = 'radio'", "is_active = 1"];
    const params: (string | number)[] = [];
    if (province) { where.push("province = ?"); params.push(province); }
    const res = await db.prepare(`
      SELECT id, name, url, NULL as stream_url, NULL as website,
             NULL as city, province, NULL as codgl, NULL as tags,
             'radio' as type, 'sources' as source
      FROM sources
      WHERE ${where.join(' AND ')}
      ORDER BY news_count DESC
      LIMIT ?
    `).bind(...params, limit).all();
    items = res.results ?? [];
  }
  const body = { items, total: items.length, cached: false, source };
  const cacheRes = new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=900' },
  });
  await cache.put(cacheKey, cacheRes);
  return c.json(body);
});
