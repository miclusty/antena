import { Hono } from "hono";
import type { Env } from "../lib/types";
import { getLocationsTree, getCategories } from "../lib/d1";

export const sitemapRoutes = new Hono<{ Bindings: Env }>();

sitemapRoutes.get("/sitemap.xml", async (c) => {
  const locations = await getLocationsTree(c.env.DB);
  const categories = await getCategories(c.env.DB);
  const baseUrl = "https://www.antena.com.ar";
  const now = new Date().toISOString();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
  xml += `  <url><loc>${baseUrl}/</loc><lastmod>${now}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>\n`;

  // Pages
  for (const path of ['/buscar/', '/medios/', '/radios/']) {
    xml += `  <url><loc>${baseUrl}${path}</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq><priority>0.6</priority></url>\n`;
  }

  // Locations
  for (const loc of locations.filter((l: any) => l.type === "provincia" || l.type === "ciudad")) {
    const slug = (loc.name as string).toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    xml += `  <url><loc>${baseUrl}/ciudad/${slug}</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>\n`;
  }

  // Categories
  for (const cat of categories) {
    xml += `  <url><loc>${baseUrl}/categoria/${cat.slug}</loc><lastmod>${now}</lastmod><changefreq>hourly</changefreq><priority>0.7</priority></url>\n`;
  }

  // Articles: top 1000 most recent (sitemap limit is 50k, but
  // keeping it under ~5MB keeps the file fast to crawl).
  // D1 schema has no updated_at/created_at, so we use
  // published_at as the date signal.
  //
  // Skip "pagina-no-encontrada" (404-page) slugs that the
  // harvest captured by mistake — they degrade crawl quality.
  const articles = await c.env.DB.prepare(`
    SELECT slug, slug_date, published_at
    FROM news_cards
    WHERE slug != '' AND slug_date != ''
      AND slug NOT LIKE '%pagina-no-encontrada%'
      AND slug NOT LIKE '%no-encontrado%'
      AND slug NOT LIKE '%404%'
      AND LOWER(title) NOT LIKE '%encontrad%'
      AND LOWER(title) NOT LIKE '%404%'
    ORDER BY COALESCE(published_at, slug_date) DESC
    LIMIT 1000
  `).all<{ slug: string; slug_date: string; published_at: string | null }>();
  for (const a of articles.results ?? []) {
    const [y, m, d] = a.slug_date.split('-');
    const lastmod = a.published_at ?? a.slug_date ?? now;
    if (y && m && d) {
      xml += `  <url><loc>${baseUrl}/${y}/${m}/${d}/${a.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
    }
  }

  xml += "</urlset>";
  return c.text(xml, 200, { "Content-Type": "application/xml", "Cache-Control": "public, max-age=900" });
});
