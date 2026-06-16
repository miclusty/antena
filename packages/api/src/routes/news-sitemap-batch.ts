import { Hono } from "hono";
import type { Env } from "../lib/types";
import { withCache } from "../lib/cache";

/**
 * Sitemap batch endpoint.
 *
 * Returns id+slug+slug_date for Astro's `getStaticPaths()` to
 * prerender `/<year>/<month>/<day>/<slug>` pages at build time.
 * Also returns location_name + location_province so per-province
 * sitemaps can be built without a second round-trip.
 *
 * Phase 3 Task 26. AKIRA populates `slug` and `slug_date` (Task 25);
 * the canonical article URL is `/<y>/<m>/<d>/<slug>`.
 */
interface SitemapItem {
  id: string;
  slug: string;
  slug_date: string;
  published_at: string;
  location_name: string | null;
  location_province: string | null;
}

export const sitemapBatchRoutes = new Hono<{ Bindings: Env }>();

sitemapBatchRoutes.get("/sitemap-batch", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 500), 1000);
  const offset = Math.max(Number(c.req.query("offset") ?? 0), 0);

  return withCache(async () => {
    const result = await c.env.DB.prepare(
      `SELECT nc.id, nc.slug, nc.slug_date, nc.published_at,
              l.name as location_name, l.province as location_province
       FROM news_cards nc
       LEFT JOIN locations l ON nc.location_id = l.id
       WHERE nc.slug != '' AND nc.slug_date != ''
       ORDER BY nc.published_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all<SitemapItem>();

    const items = result.results ?? [];
    return c.json({
      items,
      total: items.length,
      limit,
      offset,
    });
  }, { ttl: 600, swr: 0 })(c.req.raw);
});
