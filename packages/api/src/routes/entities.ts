import { Hono } from "hono";
import type { Env } from "../lib/types";
import { withCache } from "../lib/cache";

export const entitiesRoutes = new Hono<{ Bindings: Env }>();

interface EntityRow {
  id: number;
  name: string;
  type: string;
  mention_count: number;
  recent_count?: number;
  first_seen?: string | null;
  last_seen?: string | null;
}

interface RelatedRow {
  id: number;
  name: string;
  type: string;
  card_count: number;
}

interface TimelineRow {
  day: string;
  count: number;
}

// ─── static paths (declared first so they don't get shadowed by :id) ───

// Search by name substring. Used by the entity autocomplete on the
// article-detail page (after typing 2+ chars).
entitiesRoutes.get("/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "10", 10) || 10, 1), 50);
  if (q.trim().length < 2) {
    return c.json({ q, results: [], total: 0 });
  }
  return withCache(async () => {
    const result = await c.env.DB
      .prepare(
        `SELECT id, name, type, mention_count
         FROM entities
         WHERE name LIKE ? COLLATE NOCASE
         ORDER BY mention_count DESC, name ASC
         LIMIT ?`,
      )
      .bind(`%${q}%`, limit)
      .all<EntityRow>();
    const rows = (result.results ?? []) as EntityRow[];
    return c.json({ q, results: rows, total: rows.length });
  }, { ttl: 300, swr: 600 })(c.req.raw);
});

// Top entities by mention count. Powers the "Personas más mencionadas"
// leaderboard on the home page and the source profile ("Personas que
// más cubre este medio").
//
// Query params:
//   limit: int 1..50 (default 20)
//   days:  int 1..365 (default 7) — restrict to mentions created in the last N days; pass 0 for all-time
//   type:  'person' | 'place' | 'org' | 'event' (optional)
entitiesRoutes.get("/top", async (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "20", 10) || 20, 1), 50);
  const daysRaw = parseInt(c.req.query("days") ?? "7", 10);
  const days = Number.isFinite(daysRaw) && daysRaw >= 0 ? daysRaw : 7;
  const type = c.req.query("type") ?? null;

  if (type && !["person", "place", "org", "event"].includes(type)) {
    return c.json({ error: "type must be one of person|place|org|event" }, 400);
  }

  return withCache(async () => {
    const bindings: (string | number)[] = [];
    const where: string[] = [];
    if (type) {
      where.push("e.type = ?");
      bindings.push(type);
    }
    // `days=0` → all-time: no created_at filter.
    if (days > 0) {
      where.push("em.created_at >= datetime('now', ?)");
      bindings.push(`-${days} day`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sql = `
      SELECT e.id, e.name, e.type, e.mention_count,
             COUNT(em.id) AS recent_count
      FROM entities e
      LEFT JOIN entity_mentions em ON em.entity_id = e.id
      ${whereSql}
      GROUP BY e.id
      ORDER BY recent_count DESC, e.mention_count DESC
      LIMIT ?
    `;
    bindings.push(limit);
    const result = await c.env.DB
      .prepare(sql)
      .bind(...bindings)
      .all<EntityRow>();
    return c.json({
      entities: (result.results ?? []) as EntityRow[],
      days,
      type,
      total: (result.results ?? []).length,
    });
  }, { ttl: 300, swr: 600 })(c.req.raw);
});

// ─── :id paths (after static paths so /search and /top don't collide) ─

// Entities mentioned in a specific card (the "Personas/entidades
// mencionadas" panel on the article page). Joins entity_mentions
// against entities for human-readable names; orders by mention
// confidence DESC so an LLM's strongest matches surface first.
entitiesRoutes.get("/by-card/:newsId", async (c) => {
  const newsId = c.req.param("newsId");
  if (!newsId || newsId.length > 128) {
    return c.json({ error: "newsId required" }, 400);
  }
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") ?? "10", 10) || 10, 1),
    50,
  );
  return withCache(async () => {
    const result = await c.env.DB
      .prepare(
        `SELECT e.id, e.name, e.type, e.mention_count, em.confidence
         FROM entity_mentions em
         JOIN entities e ON e.id = em.entity_id
         WHERE em.card_id = ?
         ORDER BY em.confidence DESC, e.mention_count DESC
         LIMIT ?`,
      )
      .bind(newsId, limit)
      .all<EntityRow & { confidence: number }>();
    return c.json({
      newsId,
      entities: (result.results ?? []) as (EntityRow & { confidence: number })[],
      total: (result.results ?? []).length,
    });
  }, { ttl: 600, swr: 1800 })(c.req.raw);
});

// Top entities covered by a single source (the "Personas que más
// cubre este medio" panel on the source profile page).
entitiesRoutes.get("/by-source/:sourceId", async (c) => {
  const sourceIdRaw = c.req.param("sourceId");
  const sourceId = parseInt(sourceIdRaw, 10);
  if (!Number.isFinite(sourceId) || sourceId <= 0) {
    return c.json({ error: "sourceId must be a positive integer" }, 400);
  }
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") ?? "10", 10) || 10, 1),
    50,
  );
  return withCache(async () => {
    const result = await c.env.DB
      .prepare(
        `SELECT e.id, e.name, e.type, e.mention_count,
                COUNT(DISTINCT em.card_id) AS card_count
         FROM entities e
         JOIN entity_mentions em ON em.entity_id = e.id
         JOIN news_cards nc ON nc.id = em.card_id
         WHERE nc.source_id = ?
         GROUP BY e.id
         ORDER BY card_count DESC, e.mention_count DESC
         LIMIT ?`,
      )
      .bind(sourceId, limit)
      .all<EntityRow & { card_count: number }>();
    return c.json({
      sourceId,
      entities: (result.results ?? []) as (EntityRow & { card_count: number })[],
      total: (result.results ?? []).length,
    });
  }, { ttl: 900, swr: 3600 })(c.req.raw);
});

// Entity detail (name, type, counts, last_seen). Optionally includes
// the top co-occurrence neighbors via ?include=related (default 5).
entitiesRoutes.get("/:id", async (c) => {
  const idRaw = c.req.param("id");
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }
  const includeRelated = c.req.query("include") === "related";
  const relatedLimit = Math.min(
    Math.max(parseInt(c.req.query("related_limit") ?? "5", 10) || 5, 1),
    20,
  );

  return withCache(async () => {
    const row = await c.env.DB
      .prepare(
        `SELECT id, name, type, mention_count, first_seen, last_seen
         FROM entities WHERE id = ?`,
      )
      .bind(id)
      .first<EntityRow>();
    if (!row) return c.json({ error: "not found" }, 404);

    const payload: EntityRow & { related?: RelatedRow[] } = { ...row };
    if (includeRelated) {
      const related = await c.env.DB
        .prepare(
          `SELECT e.id, e.name, e.type, c.card_count
           FROM entity_co_occurrences c
           JOIN entities e ON (
             e.id = CASE WHEN c.entity_a_id = ? THEN c.entity_b_id ELSE c.entity_a_id END
           )
           WHERE c.entity_a_id = ? OR c.entity_b_id = ?
           ORDER BY c.card_count DESC, c.last_seen DESC
           LIMIT ?`,
        )
        .bind(id, id, id, relatedLimit)
        .all<RelatedRow>();
      payload.related = (related.results ?? []) as RelatedRow[];
    }
    return c.json(payload);
  }, { ttl: 600, swr: 1800 })(c.req.raw);
});

// Daily mention counts for an entity, for the sparkline on the
// entity profile page.
entitiesRoutes.get("/:id/timeline", async (c) => {
  const idRaw = c.req.param("id");
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }
  const days = Math.min(
    Math.max(parseInt(c.req.query("days") ?? "30", 10) || 30, 1),
    365,
  );
  return withCache(async () => {
    const result = await c.env.DB
      .prepare(
        `SELECT substr(em.created_at, 1, 10) AS day, COUNT(*) AS count
         FROM entity_mentions em
         WHERE em.entity_id = ?
           AND em.created_at >= datetime('now', ?)
         GROUP BY day
         ORDER BY day ASC`,
      )
      .bind(id, `-${days} day`)
      .all<TimelineRow>();
    const rows = (result.results ?? []) as TimelineRow[];
    return c.json({ id, days, timeline: rows });
  }, { ttl: 600, swr: 1800 })(c.req.raw);
});

// Co-occurrence graph neighbors (the "also mentioned alongside X"
// panel on the entity profile page).
entitiesRoutes.get("/:id/related", async (c) => {
  const idRaw = c.req.param("id");
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "id must be a positive integer" }, 400);
  }
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") ?? "10", 10) || 10, 1),
    50,
  );
  return withCache(async () => {
    const result = await c.env.DB
      .prepare(
        `SELECT e.id, e.name, e.type, c.card_count
         FROM entity_co_occurrences c
         JOIN entities e ON (
           e.id = CASE WHEN c.entity_a_id = ? THEN c.entity_b_id ELSE c.entity_a_id END
         )
         WHERE c.entity_a_id = ? OR c.entity_b_id = ?
         ORDER BY c.card_count DESC, c.last_seen DESC
         LIMIT ?`,
      )
      .bind(id, id, id, limit)
      .all<RelatedRow>();
    return c.json({ id, related: (result.results ?? []) as RelatedRow[] });
  }, { ttl: 600, swr: 1800 })(c.req.raw);
});
