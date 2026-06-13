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

  const { q, limit } = parsed.data;

  return withCache(async () => {
    let ftsResults: FtsRow[] = [];
    try {
      const result = await c.env.DB.prepare(
        `SELECT id, title, summary, image_url, source_name, category, published_at, rank
         FROM news_cards_fts
         WHERE news_cards_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
        .bind(q, limit)
        .all<FtsRow>();
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
