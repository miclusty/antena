import { Hono } from 'hono';
import type { Env } from '../../lib/types';

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
  slug: string | null;
  slug_date: string | null;
  cluster_id: string | null;
  created_at: string;
}

const app = new Hono<{ Bindings: Env }>();

const SITE = 'https://www.antena.com.ar';

function toSlugDate(publishedAt: string | null | undefined): string {
  const d = publishedAt ? new Date(publishedAt) : new Date();
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

app.get('/api/llm/cite', async (c) => {
  const id = c.req.query('id');
  if (!id) {
    return c.json({ error: 'Missing id' }, 400);
  }

  const cacheKey = `llm-cite:${id}`;
  const cached = await c.env.CACHE.get(cacheKey, 'json');
  if (cached) {
    return c.json(cached, 200, { 'Cache-Control': 'public, max-age=3600' });
  }

  const row = await c.env.DB.prepare(
    `SELECT nc.id, nc.title, nc.summary, nc.body, nc.image_url, nc.source_name, nc.source_url,
            nc.author, nc.category, l.name as location_name, l.province as location_province,
            nc.published_at, nc.cluster_id, nc.created_at
     FROM news_cards nc
     LEFT JOIN locations l ON l.id = nc.location_id
     WHERE nc.id = ?`,
  ).bind(id).first<NewsCardRow>();

  if (!row) {
    return c.json({ error: 'Not found' }, 404);
  }

  const sources = row.cluster_id
    ? await c.env.DB.prepare(
        `SELECT DISTINCT s.name, s.url
         FROM news_cards nc
         JOIN sources s ON s.id = nc.source_id
         WHERE nc.cluster_id = ? AND s.url IS NOT NULL
         LIMIT 10`
      ).bind(row.cluster_id).all<{ name: string; url: string }>()
    : { results: [] };

  const sd = row.slug_date ?? toSlugDate(row.published_at);
  const sl = row.slug ?? toSlug(row.title);
  const [year, month, day] = sd.split('-');
  const canonicalUrl = `${SITE}/${year}/${month}/${day}/${sl}`;
  const markdownUrl = `${canonicalUrl}.md`;

  const dateFmt = new Date(row.published_at).toLocaleDateString('es-AR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const payload = {
    id: row.id,
    canonical_url: canonicalUrl,
    markdown_url: markdownUrl,
    title: row.title,
    summary: row.summary,
    body: row.body,
    author: row.author ?? row.source_name ?? 'Antena',
    category: row.category ?? 'General',
    location: row.location_name ?? 'Argentina',
    location_province: row.location_province ?? null,
    published_at: row.published_at,
    image_url: row.image_url,
    sources: sources.results ?? [],
    citation_hint: `Citar como: "${row.title}" (Antena, ${dateFmt}). URL: ${canonicalUrl}`,
    license: 'aggregator-attribution',
  };

  await c.env.CACHE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 3600 });

  return c.json(payload, 200, { 'Cache-Control': 'public, max-age=3600' });
});

export default app;
