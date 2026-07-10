import { Hono } from "hono";
import type { Env } from "../lib/types";

export const clusterRoutes = new Hono<{ Bindings: Env }>();

clusterRoutes.get("/:id/bias-narrative", async (c) => {
  const clusterId = c.req.param("id");
  if (!clusterId) return c.json({ error: "cluster id required" }, 400);

  const row = await c.env.DB
    .prepare(
      "SELECT bias_narrative, bias_key_quotes, bias_narrative_at, bias_narrative_model " +
      "FROM clusters WHERE id = ?"
    )
    .bind(clusterId)
    .first<{
      bias_narrative: string | null;
      bias_key_quotes: string | null;
      bias_narrative_at: string | null;
      bias_narrative_model: string | null;
    }>();

  if (!row || !row.bias_narrative) {
    return c.json({ error: "no narrative for this cluster" }, 404);
  }

  return c.json({
    cluster_id: clusterId,
    narrative: row.bias_narrative,
    key_quotes: row.bias_key_quotes ? JSON.parse(row.bias_key_quotes) : [],
    source: row.bias_narrative_model ?? "unknown",
    generated_at: row.bias_narrative_at,
  }, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=86400",
    },
  });
});