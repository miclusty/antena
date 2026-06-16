// /rss.xml — RSS 2.0 feed.
//
// Pre-renders the 50 most recent articles. Astro static output
// would default to text/html, so we serve via a Pages Function
// to set Content-Type: application/rss+xml.

interface FeedArticle {
  id: string;
  title: string;
  summary: string;
  image_url: string | null;
  source_name: string | null;
  author?: string | null;
  category: string | null;
  published_at: string | null;
  source_url?: string | null;
}

const SITE = "https://www.antena.com.ar";
const FEED_TITLE = "Antena — Noticias hiperlocales de Argentina";
const FEED_DESC = "Síntesis de noticias de múltiples fuentes argentinas, organizadas por ciudad y región.";

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface PagesContextLite {
  request: Request;
  env: { API_BASE?: string };
}

export const onRequestGet = async (ctx: PagesContextLite): Promise<Response> => {
  const apiBase = ctx.env.API_BASE || "https://akira-api.miclusty.workers.dev";
  let articles: FeedArticle[] = [];
  try {
    const res = await fetch(`${apiBase}/api/news/feed?limit=50&offset=0`, {
      headers: { "User-Agent": "AntenaRSSProxy/1.0" },
    });
    if (res.ok) {
      const data = await res.json() as { news: FeedArticle[] };
      articles = data.news ?? [];
    }
  } catch {
    articles = [];
  }

  const buildTime = new Date().toUTCString();
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">\n`;
  xml += `  <channel>\n`;
  xml += `    <title>${FEED_TITLE}</title>\n`;
  xml += `    <link>${SITE}</link>\n`;
  xml += `    <description>${FEED_DESC}</description>\n`;
  xml += `    <language>es-AR</language>\n`;
  xml += `    <lastBuildDate>${buildTime}</lastBuildDate>\n`;
  xml += `    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />\n`;
  for (const a of articles) {
    xml += `    <item>\n`;
    xml += `      <title>${xmlEscape(a.title)}</title>\n`;
    xml += `      <link>${SITE}/noticia/${a.id}</link>\n`;
    xml += `      <guid isPermaLink="true">${SITE}/noticia/${a.id}</guid>\n`;
    xml += `      <pubDate>${a.published_at ? new Date(a.published_at).toUTCString() : buildTime}</pubDate>\n`;
    xml += `      <category>${a.category ?? "General"}</category>\n`;
    xml += `      <dc:creator>${xmlEscape(a.author || a.source_name || "Antena")}</dc:creator>\n`;
    xml += `      <description>${xmlEscape(stripHtml(a.summary).slice(0, 300))}</description>\n`;
    if (a.image_url) {
      xml += `      <enclosure url="${a.image_url}" type="image/jpeg" />\n`;
    }
    if (a.source_url) {
      xml += `      <atom:link href="${a.source_url}" rel="related" />\n`;
    }
    xml += `    </item>\n`;
  }
  xml += `  </channel>\n`;
  xml += `</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600",
    },
  });
};
