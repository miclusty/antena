import { Hono } from "hono";
import { z } from "zod";
import type { Env, FeedResponse, NewsCard } from "../lib/types";
import { getNewsFeed, getNewsById, getNewsByCluster, getFeaturedStory, getBlindspot } from "../lib/d1";
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
      foryou: params.foryou,
    });
    const response: FeedResponse & { served_at: string } = {
      news,
      location: null,
      category: params.category ?? null,
      total,
      page: Math.floor(params.offset / params.limit) + 1,
      per_page: params.limit,
      // `served_at` lets the frontend detect when the response
      // was cached and surface a "Updated X ago" hint. Also a
      // useful marker for the D1 sync pipeline to know when
      // a given cache hit happened.
      served_at: new Date().toISOString(),
    };
    return c.json(response);
  }, {
    // Skip cache when the feed is personalized (following=true,
    // source_ids=…, or foryou=true). foryou uses a RANDOM() tie-
    // breaker so caching it would defeat the variety goal.
    ttl: followingDeviceId || sourceIds || params.foryou ? 0 : 30,
    swr: followingDeviceId || sourceIds || params.foryou ? 0 : 300,
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

const blindspotQuerySchema = z.object({
  device_id: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  hours: z.coerce.number().int().min(1).max(8760).default(168),
});

newsRoutes.get("/blindspot", async (c) => {
  const parsed = blindspotQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }
  const { device_id, limit, hours } = parsed.data;
  // Cache key depends on device_id since the result is per-user.
  // Per-user requests skip the edge cache to avoid leaking one
  // user's blindspot to another; unpersonalized (no device_id)
  // results can be cached for 5min.
  return withCache(async () => {
    const items = await getBlindspot(c.env.DB, {
      deviceId: device_id,
      limit,
      hours,
    });
    return c.json({ items, total: items.length });
  }, {
    ttl: device_id ? 0 : 300,
    swr: device_id ? 0 : 600,
  })(c.req.raw);
});

newsRoutes.get("/map", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 500), 1000);
  return withCache(async () => {
    const rows = await c.env.DB.prepare(`
      SELECT nc.id, nc.title, nc.category, nc.published_at,
             l.id as location_id, l.name as location_name, l.lat, l.lng
      FROM news_cards nc
      INNER JOIN locations l ON l.id = nc.location_id
      WHERE l.lat IS NOT NULL AND l.lng IS NOT NULL
        AND nc.published_at >= datetime('now', '-1 day')
      ORDER BY nc.published_at DESC
      LIMIT ?
    `).bind(limit).all<{
      id: string; title: string; category: string | null;
      published_at: string | null;
      location_id: number; location_name: string;
      lat: number; lng: number;
    }>();
    return c.json({ items: rows.results });
  }, { ttl: 300, swr: 0 })(c.req.raw);
});

newsRoutes.get("/:id", async (c) => {
  const parsed = articleIdSchema.safeParse(c.req.param());
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }
  const { id } = parsed.data;

  // No withCache: this endpoint has two response shapes (JSON for
  // API clients, 301 redirect for HTML clients) and the cache key
  // doesn't vary on Accept. If we cache the JSON response, the
  // next HTML request gets the stale JSON instead of the 301.
  // Performance is fine without cache — getNewsById is a single
  // indexed D1 lookup (~5ms).
  const news = await getNewsById(c.env.DB, id);
  if (!news) {
    return c.json({ error: "Not found" }, 404);
  }
  // Phase 3 Task 28: if the card has a slug, redirect to the
  // canonical /<y>/<m>/<d>/<slug> URL. We 301 (permanent) so
  // crawlers and the redirect cache converge on the new URL
  // and we stop indexing the UUID. Locked decision (AGENTS.md):
  // the canonical host is https://www.antena.com.ar (with www).
  //
  // BUT: only 301 when the client looks like a browser/crawler
  // (Accept: text/html). The frontend's fetch() hits this same
  // endpoint and expects JSON — a 301 to a different origin
  // (workers.dev → www.antena.com.ar) would make the browser
  // follow cross-origin, get HTML, then `await res.json()` would
  // throw "string did not match expected pattern" because the
  // body is HTML, not JSON. So: 301 only for HTML clients,
  // JSON for everyone else.
  const accept = c.req.header("accept") || "";
  const isHtmlClient = accept.includes("text/html");
  if (news.slug && news.slug_date && isHtmlClient) {
    const [y, m, d] = news.slug_date.split("-");
    return c.redirect(`https://www.antena.com.ar/${y}/${m}/${d}/${news.slug}`, 301);
  }
  return c.json(news);
});

// ─── Engagement: votes + reposts ────────────────────────────────
// Per-device anonymous signals. The count columns on news_cards
// are the materialized projection; these tables are the source
// of truth for "did THIS device vote" and idempotency.

const voteBodySchema = z.object({
  device_id: z.string().min(1).max(128),
  /** 1 = upvote, -1 = downvote, 0 = clear vote. */
  vote: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});

newsRoutes.post("/:id/vote", async (c) => {
  const parsed = articleIdSchema.safeParse(c.req.param());
  if (!parsed.success) return c.json(formatZodError(parsed.error), 400);
  const body = voteBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json(formatZodError(body.error), 400);
  const { id } = parsed.data;
  const { device_id, vote } = body.data;

  // Verify the article exists. We don't 404 if missing — we just
  // return the current count (which is 0). Prevents a race where
  // a deleted article's votes linger in the per-device table.
  const article = await getNewsById(c.env.DB, id);
  if (!article) return c.json({ error: "Not found" }, 404);

  // Read the previous vote (if any) so we can compute the delta.
  const prev = await c.env.DB.prepare(
    "SELECT vote FROM news_votes WHERE device_id = ? AND news_id = ?"
  ).bind(device_id, id).first<{ vote: number }>();
  const prevVote = prev?.vote ?? 0;

  if (vote === 0) {
    // Clear the vote.
    await c.env.DB.prepare(
      "DELETE FROM news_votes WHERE device_id = ? AND news_id = ?"
    ).bind(device_id, id).run();
  } else if (prevVote === 0) {
    // New vote — insert.
    await c.env.DB.prepare(
      "INSERT INTO news_votes (device_id, news_id, vote) VALUES (?, ?, ?)"
    ).bind(device_id, id, vote).run();
  } else if (prevVote !== vote) {
    // Flip — update.
    await c.env.DB.prepare(
      "UPDATE news_votes SET vote = ?, updated_at = CURRENT_TIMESTAMP WHERE device_id = ? AND news_id = ?"
    ).bind(vote, device_id, id).run();
  }
  // else: prevVote === vote → no-op (idempotent re-send).

  // Update the materialized counters. We compute the delta from
  // prev→new so an upvote→downvote flip subtracts one from each.
  const upvoteDelta = (vote === 1 ? 1 : 0) - (prevVote === 1 ? 1 : 0);
  const downvoteDelta = (vote === -1 ? 1 : 0) - (prevVote === -1 ? 1 : 0);
  if (upvoteDelta !== 0 || downvoteDelta !== 0) {
    await c.env.DB.prepare(
      "UPDATE news_cards SET upvotes = MAX(0, upvotes + ?), downvotes = MAX(0, downvotes + ?) WHERE id = ?"
    ).bind(upvoteDelta, downvoteDelta, id).run();
  }

  // Read back the new counts + this device's vote.
  const counts = await c.env.DB.prepare(
    "SELECT upvotes, downvotes FROM news_cards WHERE id = ?"
  ).bind(id).first<{ upvotes: number; downvotes: number }>();

  return c.json({
    upvotes: counts?.upvotes ?? 0,
    downvotes: counts?.downvotes ?? 0,
    myVote: vote,
  });
});

const repostBodySchema = z.object({
  device_id: z.string().min(1).max(128),
});

newsRoutes.post("/:id/repost", async (c) => {
  const parsed = articleIdSchema.safeParse(c.req.param());
  if (!parsed.success) return c.json(formatZodError(parsed.error), 400);
  const body = repostBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json(formatZodError(body.error), 400);
  const { id } = parsed.data;
  const { device_id } = body.data;

  const article = await getNewsById(c.env.DB, id);
  if (!article) return c.json({ error: "Not found" }, 404);

  // Idempotent insert. If a row already exists for (device, news)
  // the INSERT OR IGNORE silently no-ops, the counter doesn't
  // double, and the response says "you already reposted".
  const ins = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO news_reposts (device_id, news_id) VALUES (?, ?)"
  ).bind(device_id, id).run();
  const wasNew = ins.meta.changes > 0;
  if (wasNew) {
    await c.env.DB.prepare(
      "UPDATE news_cards SET reposts = reposts + 1 WHERE id = ?"
    ).bind(id).run();
  }

  const counts = await c.env.DB.prepare(
    "SELECT reposts FROM news_cards WHERE id = ?"
  ).bind(id).first<{ reposts: number }>();

  return c.json({ reposts: counts?.reposts ?? 0, alreadyReposted: !wasNew });
});

// ─── Article feedback + reports (S3.5 + S3.6) ────────────────────

const feedbackBodySchema = z.object({
  device_id: z.string().min(1).max(128),
  /** 1 = useful, 0 = not useful. */
  useful: z.union([z.literal(0), z.literal(1)]),
});

newsRoutes.post("/:id/feedback", async (c) => {
  const parsed = articleIdSchema.safeParse(c.req.param());
  if (!parsed.success) return c.json(formatZodError(parsed.error), 400);
  const body = feedbackBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json(formatZodError(body.error), 400);
  const { id } = parsed.data;
  const { device_id, useful } = body.data;

  const article = await getNewsById(c.env.DB, id);
  if (!article) return c.json({ error: "Not found" }, 404);

  // Read previous vote so we can compute the counter delta.
  const prev = await c.env.DB.prepare(
    "SELECT useful FROM article_feedback WHERE device_id = ? AND news_id = ?"
  ).bind(device_id, id).first<{ useful: number }>();
  const prevUseful = prev?.useful ?? -1;

  if (prevUseful === -1) {
    // First-time feedback.
    await c.env.DB.prepare(
      "INSERT INTO article_feedback (device_id, news_id, useful) VALUES (?, ?, ?)"
    ).bind(device_id, id, useful).run();
  } else if (prevUseful !== useful) {
    // User changed their mind.
    await c.env.DB.prepare(
      "UPDATE article_feedback SET useful = ?, updated_at = CURRENT_TIMESTAMP WHERE device_id = ? AND news_id = ?"
    ).bind(useful, device_id, id).run();
  }
  // else: same vote → no-op.

  // Counter delta: only the change matters. Flipping
  // useful=1 → useful=0 decrements useful_yes and increments
  // useful_no (and vice versa).
  const yesDelta = (useful === 1 ? 1 : 0) - (prevUseful === 1 ? 1 : 0);
  const noDelta = (useful === 0 ? 1 : 0) - (prevUseful === 0 ? 1 : 0);
  if (yesDelta !== 0 || noDelta !== 0) {
    await c.env.DB.prepare(
      "UPDATE news_cards SET useful_yes = MAX(0, useful_yes + ?), useful_no = MAX(0, useful_no + ?) WHERE id = ?"
    ).bind(yesDelta, noDelta, id).run();
  }

  const counts = await c.env.DB.prepare(
    "SELECT useful_yes, useful_no FROM news_cards WHERE id = ?"
  ).bind(id).first<{ useful_yes: number; useful_no: number }>();

  return c.json({
    useful_yes: counts?.useful_yes ?? 0,
    useful_no: counts?.useful_no ?? 0,
    myUseful: useful,
  });
});

const reportBodySchema = z.object({
  device_id: z.string().min(1).max(128),
  reason: z.enum(["incorrect", "clickbait", "duplicate", "spam", "other"]),
  note: z.string().max(500).optional(),
});

newsRoutes.post("/:id/report", async (c) => {
  const parsed = articleIdSchema.safeParse(c.req.param());
  if (!parsed.success) return c.json(formatZodError(parsed.error), 400);
  const body = reportBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json(formatZodError(body.error), 400);
  const { id } = parsed.data;
  const { device_id, reason, note } = body.data;

  const article = await getNewsById(c.env.DB, id);
  if (!article) return c.json({ error: "Not found" }, 404);

  // Reports are append-only (no idempotent counter). The
  // is_reported flag is set once and stays — manual review is
  // the response to a high report count.
  await c.env.DB.prepare(
    "INSERT INTO article_reports (device_id, news_id, reason, note) VALUES (?, ?, ?, ?)"
  ).bind(device_id, id, reason, note ?? null).run();
  await c.env.DB.prepare(
    "UPDATE news_cards SET is_reported = 1 WHERE id = ?"
  ).bind(id).run();

  return c.json({ ok: true });
});

newsRoutes.delete("/:id/repost", async (c) => {
  const parsed = articleIdSchema.safeParse(c.req.param());
  if (!parsed.success) return c.json(formatZodError(parsed.error), 400);
  const deviceId = c.req.query("device_id");
  if (!deviceId) return c.json({ error: "device_id required" }, 400);
  const { id } = parsed.data;

  const del = await c.env.DB.prepare(
    "DELETE FROM news_reposts WHERE device_id = ? AND news_id = ?"
  ).bind(deviceId, id).run();
  const wasDeleted = del.meta.changes > 0;
  if (wasDeleted) {
    await c.env.DB.prepare(
      "UPDATE news_cards SET reposts = MAX(0, reposts - 1) WHERE id = ?"
    ).bind(id).run();
  }

  const counts = await c.env.DB.prepare(
    "SELECT reposts FROM news_cards WHERE id = ?"
  ).bind(id).first<{ reposts: number }>();

  return c.json({ reposts: counts?.reposts ?? 0, removed: wasDeleted });
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

// Note: the /api/news/feed endpoint has a 60s TTL + 300s SWR
// cache. After syncing new clusters to D1, callers may need
// to wait ~5 min for the edge cache to expire. We do not
// bypass the cache because the D1 reads are slow enough
// to merit caching for normal traffic.
