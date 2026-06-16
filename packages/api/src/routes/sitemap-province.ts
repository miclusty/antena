import { Hono } from "hono";
import type { Env } from "../lib/types";
import { withCache } from "../lib/cache";

/**
 * Sitemap for a single province.
 *
 * Returns an XML sitemap listing all articles that belong to
 * the given province (via the `locations.province` join). Used
 * by Antena Astro's per-province static pages.
 *
 * Province name is matched case-insensitively against
 * `locations.province` (e.g. "Buenos Aires", "Córdoba").
 *
 * Cache: 1 hour TTL. Province sitemaps change every harvest
 * cycle (every 2h), so 1h is a good balance between freshness
 * and Cloudflare Workers read budget.
 */
export const provinceSitemapRoutes = new Hono<{ Bindings: Env }>();

const SITE = "https://www.antena.com.ar";

provinceSitemapRoutes.get("/sitemap-province/:province", async (c) => {
  const raw = c.req.param("province") || "";
  const province = decodeURIComponent(raw).trim();
  if (!province) {
    return c.text("missing province", 400);
  }

  return withCache(async () => {
    const result = await c.env.DB.prepare(
      `SELECT nc.id, nc.slug, nc.slug_date, nc.published_at
       FROM news_cards nc
       JOIN locations l ON nc.location_id = l.id
       WHERE nc.slug != '' AND nc.slug_date != ''
         AND LOWER(l.province) = LOWER(?)
       ORDER BY nc.published_at DESC
       LIMIT 5000`,
    )
      .bind(province)
      .all<{
        id: string;
        slug: string;
        slug_date: string;
        published_at: string;
      }>();

    const items = result.results ?? [];
    const now = new Date().toISOString();

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    for (const a of items) {
      const [y, m, d] = (a.slug_date || "").split("-");
      const url = y && m && d
        ? `${SITE}/${y}/${m}/${d}/${a.slug}`
        : `${SITE}/noticia/${a.id}`;
      xml += `  <url>
    <loc>${url}</loc>
    <lastmod>${a.published_at || now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>\n`;
    }
    xml += `</urlset>`;

    return c.text(xml, 200, {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    });
  }, { ttl: 3600, swr: 600 })(c.req.raw);
});
