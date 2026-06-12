import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { discoverFeeds, validateFeed } from "../lib/rss-discovery";
import { parseFeed } from "../lib/rss-parser";
import type { Env } from "../lib/types";

export const rssRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /api/rss/discover
 * Discover RSS/Atom feeds from a URL
 * Auth required
 */
rssRoutes.post("/discover", authMiddleware, async (c) => {
  const { url } = await c.req.json<{ url: string }>();

  if (!url) {
    return c.json({ error: "url is required" }, 400);
  }

  try {
    new URL(url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const feeds = await discoverFeeds(url);

  // Validate each discovered feed
  const validated = await Promise.all(
    feeds.map(async (feed) => ({
      ...feed,
      isValid: await validateFeed(feed.url),
    }))
  );

  return c.json({
    url,
    feeds: validated,
    total: validated.length,
    valid: validated.filter((f) => f.isValid).length,
  });
});

/**
 * POST /api/rss/parse
 * Parse an RSS/Atom feed and return items
 * Auth required
 */
rssRoutes.post("/parse", authMiddleware, async (c) => {
  const { url, limit = 20 } = await c.req.json<{ url: string; limit?: number }>();

  if (!url) {
    return c.json({ error: "url is required" }, 400);
  }

  const feed = await parseFeed(url);

  if (!feed) {
    return c.json({ error: "Failed to parse feed" }, 400);
  }

  return c.json({
    feed: {
      title: feed.title,
      link: feed.link,
      description: feed.description,
    },
    items: feed.items.slice(0, limit),
    total: feed.items.length,
  });
});

/**
 * POST /api/rss/discover-and-parse
 * Discover feeds from URL and parse the first valid one
 * Auth required - Combined endpoint for convenience
 */
rssRoutes.post("/discover-and-parse", authMiddleware, async (c) => {
  const { url, limit = 20 } = await c.req.json<{ url: string; limit?: number }>();

  if (!url) {
    return c.json({ error: "url is required" }, 400);
  }

  // Step 1: Discover feeds
  const feeds = await discoverFeeds(url);

  // Step 2: Validate and find first valid feed
  for (const feed of feeds) {
    const isValid = await validateFeed(feed.url);
    if (isValid) {
      // Parse the feed
      const parsed = await parseFeed(feed.url);
      if (parsed && parsed.items.length > 0) {
        return c.json({
          discovered: feeds,
          feed: {
            title: parsed.title,
            link: parsed.link,
            description: parsed.description,
          },
          items: parsed.items.slice(0, limit),
          total: parsed.items.length,
          source_url: feed.url,
        });
      }
    }
  }

  // No valid feeds found
  return c.json({
    discovered: feeds,
    feed: null,
    items: [],
    total: 0,
    error: "No valid feeds found",
  }, feeds.length > 0 ? 200 : 404);
});
