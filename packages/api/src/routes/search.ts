import { Hono } from "hono";
import type { Env } from "../lib/types";
import { searchQuerySchema, formatZodError } from "../lib/schemas";
import { withCache } from "../lib/cache";

interface FtsRow {
  id: string;
  title: string;
  summary: string;
  image_url: string | null;
  source_name: string | null;
  category: string | null;
  published_at: string | null;
  rank: number;
}

export const searchRoutes = new Hono<{ Bindings: Env }>();

searchRoutes.get("/", async (c) => {
  const parsed = searchQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }

  const { q, limit, category, source_id, time } = parsed.data;

  // Build the WHERE clause. FTS5 is on news_cards_fts which
  // doesn't have category/source_id columns directly, so we
  // join against news_cards when filters are active. Without
  // filters, we stay on the virtual table for speed.
  const hasFilters = !!(category || source_id || (time && time !== "all"));
  const timeClause = time && time !== "all" ? ` AND nc.created_at >= datetime('now', ?)` : "";
  const filterSql = hasFilters
    ? `SELECT nc.id, nc.title, nc.summary, nc.image_url,
             nc.source_name, nc.category, nc.published_at,
             f.rank
        FROM news_cards_fts f
        INNER JOIN news_cards nc ON nc.id = f.id
        WHERE f.news_cards_fts MATCH ?
        ${category ? " AND nc.category = ?" : ""}
        ${source_id ? " AND nc.source_id = ?" : ""}
        ${timeClause}
        ORDER BY f.rank
        LIMIT ?`
    : `SELECT id, title, summary, image_url, source_name, category, published_at, rank
        FROM news_cards_fts
        WHERE news_cards_fts MATCH ?
        ORDER BY rank
        LIMIT ?`;

  return withCache(async () => {
    let ftsResults: FtsRow[] = [];
    try {
      const params: (string | number)[] = [q];
      if (category) params.push(category);
      if (source_id) params.push(source_id);
      if (time && time !== "all") params.push(`-${time === "hour" ? "1 hour" : time === "today" ? "1 day" : "7 days"}`);
      params.push(limit);
      const result = await c.env.DB.prepare(filterSql).bind(...params).all<FtsRow>();
      ftsResults = result.results ?? [];
    } catch (e) {
      if ((c.env as { ENVIRONMENT?: string }).ENVIRONMENT === "development") {
        console.warn("FTS5 query failed (table may not exist yet):", e);
      }
      ftsResults = [];
    }

    let vectorResults: unknown[] = [];
    try {
      const queryVec = { data: [[] as number[]] };
      const vector = (queryVec as { data?: number[][] }).data?.[0] ?? [];
      if (vector.length > 0) {
        const matches = await c.env.VECTORS.query(vector, {
          topK: limit,
          returnMetadata: "all",
        });
        vectorResults = matches.matches ?? [];
      }
    } catch (e) {
      if ((c.env as { ENVIRONMENT?: string }).ENVIRONMENT === "development") {
        console.warn("Vectorize search unavailable:", e);
      }
    }

    return c.json({
      q,
      results: ftsResults,
      vectorResults,
      total: ftsResults.length,
    });
  }, { ttl: 60, swr: 300 })(c.req.raw);
});
