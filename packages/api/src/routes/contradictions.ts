import { Hono } from "hono";
import type { Env } from "../lib/types";

export const contradictionRoutes = new Hono<{ Bindings: Env }>();

// GET /api/clusters/:id/contradictions
//
// Returns the JSON payload of numerical/factual disagreements found
// by the AKIRA contradiction detector (core/contradiction_detector.py).
// The payload is stored on `clusters.contradictions_json` and is
// regenerated every time synthesis runs for the cluster.
//
// Response shape:
//   {
//     cluster_id: "...",
//     contradictions: [
//       {
//         subject: "muerto",
//         unit: null,
//         values: [5.0, 8.0],
//         entries: [{source, value, raw_text}, ...],
//         confidence: 0.85,
//       },
//       ...
//     ],
//     count: 2,
//     generated_at: "2026-07-11T...",
//   }
//
// 200 with empty array if synthesis hasn't run yet for this cluster.
// 200 with count=0 if synthesis ran but found no disagreements.
contradictionRoutes.get("/:id/contradictions", async (c) => {
  const clusterId = c.req.param("id");
  if (!clusterId) return c.json({ error: "cluster id required" }, 400);

  const row = await c.env.DB
    .prepare(
      "SELECT contradictions_json, contradictions_at, contradictions_count " +
      "FROM clusters WHERE id = ?"
    )
    .bind(clusterId)
    .first<{
      contradictions_json: string | null;
      contradictions_at: string | null;
      contradictions_count: number | null;
    }>();

  if (!row) {
    return c.json({ error: "cluster not found" }, 404);
  }

  let contradictions: unknown[] = [];
  if (row.contradictions_json) {
    try {
      const parsed = JSON.parse(row.contradictions_json);
      if (Array.isArray(parsed)) {
        contradictions = parsed;
      }
    } catch {
      // Corrupt JSON — return empty array instead of 500. The next
      // synthesis run will overwrite the bad value.
      contradictions = [];
    }
  }

  return c.json({
    cluster_id: clusterId,
    contradictions,
    count: contradictions.length,
    stored_count: row.contradictions_count ?? 0,
    generated_at: row.contradictions_at,
  }, {
    headers: {
      // Edge cache: 60s fresh, 24h SWR. Synthesis is rare (per cluster),
      // so the freshness window is generous.
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=86400",
    },
  });
});