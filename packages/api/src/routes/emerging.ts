import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/types";
import { formatZodError } from "../lib/schemas";
import { withCache } from "../lib/cache";

/**
 * GET /api/emerging
 *
 * Returns clusters that are gaining traction right now. Computed on
 * the fly against D1 `news_cards` (no LLM dependency, no cron
 * required). The materialized `emerging_clusters` mirror table is
 * populated by `packages/akira/scripts/update_emerging_themes.py`
 * every 15 minutes — we use it as a faster path when available and
 * fall back to live aggregation otherwise.
 *
 * Schema: D1 has `source_id INTEGER` (normalized by sync_to_d1.py)
 * and `is_gacetilla` flag, with indexes on cluster_id and published_at.
 *
 * Velocity formula (mirrors core/emerging_themes.py):
 *   articles × ln(distinct_sources + 1) × (credibility_avg / 100)
 *
 * is_emerging heuristics:
 *   - score >= query.min_score (default 2.0)
 *   - distinct_sources >= 2         (avoid echo-chamber)
 *   - new_articles >= 2             (avoid single-story noise)
 */

const emergingQuerySchema = z.object({
  window_hours: z.coerce.number().int().min(1).max(48).default(6),
  min_score: z.coerce.number().min(0).max(1000).default(2.0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const emergingRoutes = new Hono<{ Bindings: Env }>();

emergingRoutes.get("/", async (c) => {
  const parsed = emergingQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }
  const { window_hours, min_score, limit } = parsed.data;

  return withCache(async () => {
    // ── Path 1: materialized table ──────────────────────────────────
    // `emerging_clusters` is written by the AKIRA cron every 15 min
    // (cron_restart: */15 * * * *). If we have fresh rows, use them.
    // Freshness window: anything updated within 30 min is considered
    // recent enough — anything older falls back to live computation.
    const rows = await c.env.DB.prepare(
      `SELECT cluster_id, velocity_score, new_articles_in_window,
              distinct_sources_in_window, credibility_avg,
              title, first_seen_at, last_updated_at,
              (julianday('now') - julianday(last_updated_at)) * 24 * 60 AS minutes_since_update
       FROM emerging_clusters
       WHERE velocity_score >= ?
       ORDER BY velocity_score DESC, last_updated_at DESC
       LIMIT ?`
    ).bind(min_score, limit).all<EmergingRow>();

    const source: "materialized" | "live" =
      rows.results && rows.results.length > 0 && (rows.results[0] as { minutes_since_update: number }).minutes_since_update < 30
        ? "materialized"
        : "live";

    let emerging: EmergingRow[];
    if (source === "materialized") {
      emerging = rows.results ?? [];
    } else {
      // ── Path 2: live aggregation over news_cards ──────────────────
      // Used when the cron hasn't run yet (cold cache) or when we
      // want fresher-than-15-min data. Cost: a JOIN + GROUP BY over
      // news_cards filtered by published_at. The published_at index
      // makes this fast on D1.
      const liveRows = await c.env.DB.prepare(
        `WITH cluster_velocity AS (
            SELECT
              nc.cluster_id AS cluster_id,
              COUNT(*) AS new_articles,
              COUNT(DISTINCT nc.source_id) AS distinct_sources,
              COALESCE(AVG(COALESCE(s.credibility_score, 50)), 50.0) AS cred_avg
            FROM news_cards nc
            LEFT JOIN sources s ON s.id = nc.source_id
            WHERE nc.cluster_id IS NOT NULL
              AND nc.source_id IS NOT NULL
              AND nc.is_gacetilla = 0
              AND nc.published_at >= datetime('now', ?)
            GROUP BY nc.cluster_id
            HAVING COUNT(*) >= 2 AND COUNT(DISTINCT nc.source_id) >= 2
          ),
          cluster_titles AS (
            SELECT
              cluster_id,
              MIN(published_at) AS first_seen_at,
              (SELECT title FROM news_cards WHERE cluster_id = n.cluster_id ORDER BY published_at LIMIT 1) AS title
            FROM news_cards n
            WHERE cluster_id IS NOT NULL AND is_gacetilla = 0
            GROUP BY cluster_id
          )
        SELECT
          cv.cluster_id,
          (cv.new_articles * ln(cv.distinct_sources + 1) * (cv.cred_avg / 100.0)) AS velocity_score,
          cv.new_articles AS new_articles_in_window,
          cv.distinct_sources AS distinct_sources_in_window,
          ROUND(cv.cred_avg, 2) AS credibility_avg,
          COALESCE(ma.title, ct.title) AS title,
          ct.first_seen_at,
          datetime('now') AS last_updated_at
        FROM cluster_velocity cv
        LEFT JOIN master_articles ma ON ma.cluster_id = cv.cluster_id
        LEFT JOIN cluster_titles ct ON ct.cluster_id = cv.cluster_id
        WHERE (cv.new_articles * ln(cv.distinct_sources + 1) * (cv.cred_avg / 100.0)) >= ?
        ORDER BY velocity_score DESC, new_articles_in_window DESC
        LIMIT ?`
      ).bind(`-${window_hours} hours`, min_score, limit).all<EmergingRow>();

      emerging = liveRows.results ?? [];
    }

    return c.json({
      emerging: emerging.map((r) => ({
        cluster_id: r.cluster_id,
        title: r.title,
        velocity_score: typeof r.velocity_score === "number" ? r.velocity_score : Number(r.velocity_score ?? 0),
        new_articles_in_window: r.new_articles_in_window,
        distinct_sources_in_window: r.distinct_sources_in_window,
        credibility_avg: typeof r.credibility_avg === "number"
          ? r.credibility_avg
          : Number(r.credibility_avg ?? 0),
        first_seen_at: r.first_seen_at ?? null,
        last_updated_at: r.last_updated_at ?? null,
      })),
      computed_at: new Date().toISOString(),
      window_hours,
      source,
    });
  }, { ttl: 60, swr: 300 })(c.req.raw);
});

interface EmergingRow {
  cluster_id: string;
  velocity_score: number | string;
  new_articles_in_window: number;
  distinct_sources_in_window: number;
  credibility_avg: number | string;
  title: string | null;
  first_seen_at: string | null;
  last_updated_at: string | null;
  minutes_since_update?: number;
}
