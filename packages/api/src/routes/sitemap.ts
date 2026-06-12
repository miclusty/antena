import { Hono } from "hono";
import type { Env } from "../lib/types";
import { getLocationsTree, getCategories } from "../lib/d1";

export const sitemapRoutes = new Hono<{ Bindings: Env }>();

sitemapRoutes.get("/sitemap.xml", async (c) => {
  const locations = await getLocationsTree(c.env.DB);
  const categories = await getCategories(c.env.DB);
  const baseUrl = "https://akira.ar";
  const now = new Date().toISOString();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${baseUrl}/</loc><lastmod>${now}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>`;

  for (const loc of locations.filter((l: any) => l.type === "provincia" || l.type === "ciudad")) {
    const slug = loc.name.toLowerCase().replace(/\s+/g, "-");
    xml += `\n  <url><loc>${baseUrl}/ubicacion/${slug}</loc><lastmod>${now}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`;
  }

  for (const cat of categories) {
    xml += `\n  <url><loc>${baseUrl}/categoria/${cat.slug}</loc><lastmod>${now}</lastmod><changefreq>hourly</changefreq><priority>0.7</priority></url>`;
  }

  xml += "\n</urlset>";
  return c.text(xml, 200, { "Content-Type": "application/xml", "Cache-Control": "public, max-age=900" });
});
