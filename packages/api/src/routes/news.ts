import { Hono } from "hono";
import { z } from "zod";
import type { Env, FeedResponse, NewsCard } from "../lib/types";
import { getNewsFeed, getNewsById, getNewsByCluster, getFeaturedStory } from "../lib/d1";
import {
  articleIdSchema,
  feedParamsSchema,
  formatZodError,
} from "../lib/schemas";
import { withCache } from "../lib/cache";

/**
 * Local HTML stripper (also lives in d1.ts but importing from there
 * creates a circular type-only dep we don't need to debug right now).
 */
function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  let text = String(html);
  text = text.replace(/<img\b[^>]*\/?>/gi, "");
  text = text.replace(/\[(Facebook|Twitter|Instagram|LinkedIn|YouTube|TikTok)[^\]]*\]\([^)]*\)/gi, "");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const postIdx = text.indexOf("The post");
  if (postIdx !== -1) text = text.slice(0, postIdx);
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

export const newsRoutes = new Hono<{ Bindings: Env }>();

const trendingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  hours: z.coerce.number().int().min(1).max(8760).default(4380),  // 6 months default
});

const breakingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  hours: z.coerce.number().int().min(1).max(8760).default(2160),  // 90 days default
});

newsRoutes.get("/feed", async (c) => {
  const parsed = feedParamsSchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }
  const params = parsed.data;

  // Resolve the device id (if any) for the `following=true` filter.
  // Same precedence as the follows API: header first, then query.
  const deviceId =
    c.req.header("X-Device-Id") ??
    c.req.query("device_id") ??
    undefined;
  const followingDeviceId = params.following && deviceId ? deviceId : undefined;
  // Parse comma-separated source_ids into a number array.
  const sourceIds = params.source_ids
    ? params.source_ids
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    : undefined;

  return withCache(async () => {
    const { news, total } = await getNewsFeed(c.env.DB, {
      location_id: params.location_id,
      category: params.category,
      limit: params.limit,
      offset: params.offset,
      followingDeviceId,
      sourceIds,
    });
    const response: FeedResponse = {
      news,
      location: null,
      category: params.category ?? null,
      total,
      page: Math.floor(params.offset / params.limit) + 1,
      per_page: params.limit,
    };
    return c.json(response);
  }, {
    // Skip cache when the feed is personalized (following=true
    // or source_ids=…). Both produce per-device results that
    // should never be served to another user.
    ttl: followingDeviceId || sourceIds ? 0 : 60,
    swr: followingDeviceId || sourceIds ? 0 : 300,
  })(c.req.raw);
});

newsRoutes.get("/breaking", async (c) => {
  const parsed = breakingQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }
  const { limit, hours } = parsed.data;

  return withCache(async () => {
    const results = await c.env.DB.prepare(`
      SELECT nc.*, s.name as source_name, l.name as location_name, l.province as location_province
      FROM news_cards nc
      LEFT JOIN sources s ON s.id = nc.source_id
      LEFT JOIN locations l ON l.id = nc.location_id
      WHERE nc.created_at >= datetime('now', ?)
      ORDER BY nc.sources_count DESC, nc.created_at DESC
      LIMIT ?
    `).bind(`-${hours} hours`, limit).all<NewsCard>();

    const news = results.results ?? [];
    return c.json({
      news,
      total: news.length,
      lastUpdated: new Date().toISOString(),
    });
  }, { ttl: 30, swr: 0 })(c.req.raw);
});

newsRoutes.get("/trending", async (c) => {
  const parsed = trendingQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }
  const { limit, hours } = parsed.data;

  return withCache(async () => {
    const results = await c.env.DB.prepare(`
      SELECT nc.*, s.name as source_name, l.name as location_name, l.province as location_province
      FROM news_cards nc
      LEFT JOIN sources s ON s.id = nc.source_id
      LEFT JOIN locations l ON l.id = nc.location_id
      WHERE nc.created_at >= datetime('now', ?)
      ORDER BY nc.sources_count DESC, nc.created_at DESC
      LIMIT ?
    `).bind(`-${hours} hours`, limit).all<NewsCard>();

    const news = results.results ?? [];
    return c.json({ news, total: news.length });
  }, { ttl: 300, swr: 0 })(c.req.raw);
});

newsRoutes.get("/featured", async (c) => {
  return withCache(async () => {
    const featured = await getFeaturedStory(c.env.DB, 8760);
    if (!featured) {
      return c.json({ featured: null, message: "No multi-source cluster found" });
    }
    return c.json({ featured });
  }, { ttl: 300, swr: 600 })(c.req.raw);
});

newsRoutes.get("/:id", async (c) => {
  const parsed = articleIdSchema.safeParse(c.req.param());
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }
  const { id } = parsed.data;

  return withCache(async () => {
    const news = await getNewsById(c.env.DB, id);
    if (!news) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(news);
  }, { ttl: 300, swr: 3600 })(c.req.raw);
});

newsRoutes.get("/:id/cluster", async (c) => {
  const parsed = articleIdSchema.safeParse(c.req.param());
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }
  const { id } = parsed.data;

  return withCache(async () => {
    const news = await getNewsById(c.env.DB, id);
    if (!news || !news.cluster_id) {
      return c.json({ error: "Not found or no cluster" }, 404);
    }
    const cluster = await getNewsByCluster(c.env.DB, news.cluster_id);
    return c.json({ cluster_id: news.cluster_id, news: cluster });
  }, { ttl: 300, swr: 0 })(c.req.raw);
});
# Cache-bust: 2026-06-14T11:43:41Z
