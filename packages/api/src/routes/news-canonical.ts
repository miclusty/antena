import { Hono } from "hono";
import type { Env } from "../lib/types";
import { withCache } from "../lib/cache";

/**
 * Local HTML stripper (also lives in news.ts and d1.ts; importing
 * from either creates a circular type-only dep we don't need to
 * debug right now).
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

/**
 * Canonical article endpoint.
 *
 * GET /api/news/:year/:month/:day/:slug
 *
 * Returns the full NewsCard (with body) plus a `sources` list
 * for the cluster. Used by the Astro `<year>/<month>/<day>/<slug>`
 * static page at build time (getStaticPaths) and at runtime via
 * the SSR Pages Function.
 *
 * Phase 3 Task 27. Locked decision (AGENTS.md): the canonical
 * URL host is `https://www.antena.com.ar` (with www).
 */
interface NewsCardRow {
  id: string;
  title: string;
  summary: string;
  body: string | null;
  image_url: string | null;
  source_name: string | null;
  source_url: string | null;
  author: string | null;
  category: string | null;
  location_name: string | null;
  location_province: string | null;
  published_at: string;
  slug: string;
  slug_date: string;
  cluster_id: string | null;
  source_id: string | null;
  bias_score: number | null;
}

export const newsCanonicalRoutes = new Hono<{ Bindings: Env }>();

newsCanonicalRoutes.get("/:year/:month/:day/:slug", async (c) => {
  const year = c.req.param("year");
  const month = c.req.param("month");
  const day = c.req.param("day");
  const slug = c.req.param("slug");

  if (
    !/^\d{4}$/.test(year) ||
    !/^\d{2}$/.test(month) ||
    !/^\d{2}$/.test(day) ||
    !/^[a-z0-9-]{1,200}$/.test(slug)
  ) {
    return c.json({ error: "Invalid date or slug format" }, 400);
  }

  const slug_date = `${year}-${month}-${day}`;

  return withCache(async () => {
    const row = await c.env.DB.prepare(
      `SELECT nc.id, nc.title, nc.summary, nc.body, nc.image_url, nc.source_name, nc.source_url,
              nc.author, nc.category, l.name as location_name, l.province as location_province,
              nc.published_at, nc.slug, nc.slug_date,
              nc.cluster_id, nc.source_id, nc.bias_score
       FROM news_cards nc
       LEFT JOIN locations l ON l.id = nc.location_id
       WHERE nc.slug_date = ? AND nc.slug = ?`,
    )
      .bind(slug_date, slug)
      .first<NewsCardRow>();

    if (!row) {
      return c.json({ error: "Not found" }, 404);
    }

    // Same cluster → list of distinct source names + URLs so the
    // frontend can render "Otras versiones" with attribution links.
    const sources = row.cluster_id
      ? await c.env.DB.prepare(
          `SELECT DISTINCT s.name, s.url
           FROM news_cards nc
           JOIN sources s ON s.id = nc.source_id
           WHERE nc.cluster_id = ? AND s.url IS NOT NULL
           LIMIT 10`,
        )
          .bind(row.cluster_id)
          .all<{ name: string; url: string }>()
      : { results: [] };

    return c.json({
      news: {
        id: row.id,
        title: stripHtml(row.title) || row.title,
        summary: stripHtml(row.summary),
        body: row.body ? stripHtml(row.body) : null,
        image_url: row.image_url,
        source_name: row.source_name,
        source_url: row.source_url,
        author: row.author,
        category: row.category,
        location_name: row.location_name,
        location_province: row.location_province,
        published_at: row.published_at,
        slug: row.slug,
        slug_date: row.slug_date,
        bias_score: row.bias_score,
        cluster_id: row.cluster_id,
        sources: sources.results ?? [],
      },
    });
  }, { ttl: 600, swr: 0 })(c.req.raw);
});
