import { Hono } from "hono";
import { z } from "zod";
import type { Env, FeedResponse, NewsCard } from "../lib/types";
import { getNewsFeed, getNewsById, getNewsByCluster } from "../lib/d1";
import {
  articleIdSchema,
  feedParamsSchema,
  formatZodError,
} from "../lib/schemas";
import { withCache } from "../lib/cache";

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

  return withCache(async () => {
    const { news, total } = await getNewsFeed(c.env.DB, params);
    const response: FeedResponse = {
      news,
      location: null,
      category: params.category ?? null,
      total,
      page: Math.floor(params.offset / params.limit) + 1,
      per_page: params.limit,
    };
    return c.json(response);
  }, { ttl: 60, swr: 300 })(c.req.raw);
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
