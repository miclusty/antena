import type { NewsCard, Location, Category, Source } from "./types";

export async function getNewsFeed(
  db: D1Database,
  options: { location_id?: number; category?: string; limit?: number; offset?: number }
): Promise<{ news: NewsCard[]; total: number }> {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  let query = `
    SELECT nc.*, s.name as source_name, l.name as location_name, l.province as location_province
    FROM news_cards nc
    LEFT JOIN sources s ON s.id = nc.source_id
    LEFT JOIN locations l ON l.id = nc.location_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (options.location_id) { query += " AND nc.location_id = ?"; params.push(options.location_id); }
  if (options.category) { query += " AND nc.category = ?"; params.push(options.category); }

  const countQuery = query.replace(/SELECT.*?FROM/, "SELECT COUNT(*) as count FROM");
  const countResult = await db.prepare(countQuery).bind(...params).first<{ count: number }>();
  const total = countResult?.count ?? 0;

  query += " ORDER BY nc.created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const results = await db.prepare(query).bind(...params).all<NewsCard>();
  return { news: results.results ?? [], total };
}

export async function getNewsById(db: D1Database, id: string): Promise<NewsCard | null> {
  const result = await db.prepare(`
    SELECT nc.*, s.name as source_name, l.name as location_name, l.province as location_province
    FROM news_cards nc
    LEFT JOIN sources s ON s.id = nc.source_id
    LEFT JOIN locations l ON l.id = nc.location_id
    WHERE nc.id = ?
  `).bind(id).first<NewsCard>();
  return result ?? null;
}

export async function getNewsByCluster(db: D1Database, cluster_id: string): Promise<NewsCard[]> {
  const results = await db.prepare(`
    SELECT nc.*, s.name as source_name, l.name as location_name, l.province as location_province
    FROM news_cards nc
    LEFT JOIN sources s ON s.id = nc.source_id
    LEFT JOIN locations l ON l.id = nc.location_id
    WHERE nc.cluster_id = ?
    ORDER BY nc.created_at DESC
  `).bind(cluster_id).all<NewsCard>();
  return results.results ?? [];
}

export async function getLocationById(db: D1Database, id: number): Promise<Location | null> {
  return await db.prepare("SELECT * FROM locations WHERE id = ?").bind(id).first<Location>() ?? null;
}

export async function getLocationsTree(db: D1Database): Promise<Location[]> {
  const results = await db.prepare("SELECT * FROM locations ORDER BY type, province, name").all<Location>();
  return results.results ?? [];
}

export async function getCategories(db: D1Database): Promise<Category[]> {
  const results = await db.prepare("SELECT * FROM categories ORDER BY id").all<Category>();
  return results.results ?? [];
}

export async function insertNewsCard(db: D1Database, card: {
  id: string; location_id: number; title: string; summary: string;
  image_url?: string; bias_score?: number; is_gacetilla?: boolean;
  cluster_id?: string; category?: string; source_ids?: string; published_at?: string;
}): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO news_cards (id, location_id, title, summary, image_url, bias_score, is_gacetilla, cluster_id, category, source_ids, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    card.id, card.location_id, card.title, card.summary,
    card.image_url ?? null, card.bias_score ?? null,
    card.is_gacetilla ? 1 : 0, card.cluster_id ?? null,
    card.category ?? null, card.source_ids ?? null, card.published_at ?? null
  ).run();
}

export async function insertSource(db: D1Database, source: { name: string; url: string; location_id?: number }): Promise<void> {
  await db.prepare("INSERT OR IGNORE INTO sources (name, url, location_id) VALUES (?, ?, ?)")
    .bind(source.name, source.url, source.location_id ?? null).run();
}
