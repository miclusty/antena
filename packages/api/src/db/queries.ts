import type { D1Database } from "@cloudflare/workers-types";

export interface StatsResult {
  total_news: number;
  active_sources: number;
  news_today: number;
  news_week: number;
  total_locations: number;
  total_clusters: number;
}

export async function getStats(db: D1Database): Promise<StatsResult> {
  const [news, sources, today, week, locs, clusters] = await Promise.all([
    db.prepare("SELECT COUNT(*) as c FROM news_cards").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) as c FROM sources WHERE is_active = 1").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) as c FROM news_cards WHERE created_at >= datetime('now', '-1 day')").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) as c FROM news_cards WHERE created_at >= datetime('now', '-7 days')").first<{ c: number }>(),
    db.prepare("SELECT COUNT(*) as c FROM locations").first<{ c: number }>(),
    // D1 schema has no separate `clusters` table — clusters are derived from
    // distinct cluster_id values in news_cards.
    db.prepare("SELECT COUNT(DISTINCT cluster_id) as c FROM news_cards WHERE cluster_id IS NOT NULL").first<{ c: number }>(),
  ]);
  return {
    total_news: news?.c ?? 0,
    active_sources: sources?.c ?? 0,
    news_today: today?.c ?? 0,
    news_week: week?.c ?? 0,
    total_locations: locs?.c ?? 0,
    total_clusters: clusters?.c ?? 0,
  };
}

export interface CityResult {
  id: number;
  name: string;
  province: string;
  count: number;
}

export async function getCities(db: D1Database, limit = 12): Promise<CityResult[]> {
  // Include both `state` (provinces) and `city` — AKIRA's source/news_card
  // location_id often points to the province, not the city, so a city-only
  // filter returns an empty list. We surface the top regions with content.
  const result = await db.prepare(`
    SELECT l.id, l.name, l.province, COUNT(nc.id) as count
    FROM locations l
    LEFT JOIN news_cards nc ON nc.location_id = l.id
    WHERE l.type IN ('state', 'city')
    GROUP BY l.id
    HAVING count > 0
    ORDER BY count DESC
    LIMIT ?
  `).bind(limit).all();
  return ((result.results ?? []) as unknown) as CityResult[];
}
