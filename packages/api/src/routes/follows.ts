// ═══════════════════════════════════════════════════════════════
// Source-follows API
//
// Until we have real auth, a user is identified by an anonymous
// device_id (a UUID generated client-side and stored in
// localStorage). The (device_id, source_id) pair is unique —
// a device can only follow a source once.
//
// Endpoints:
//   GET    /api/me/follows           list followed sources
//   POST   /api/sources/:id/follow    follow a source
//   DELETE /api/sources/:id/follow    unfollow a source
//
// The header `X-Device-Id` (or ?device_id=… query param fallback)
// carries the device id. We accept both because some browsers
// can't set custom headers on cross-origin fetches without
// `mode: "cors"` and a CORS-allowlisted header — so the query
// param is the safe default and the header is the upgrade.
// ═══════════════════════════════════════════════════════════════

import { Hono } from "hono";
import type { Env } from "../lib/types";

export const followsRoutes = new Hono<{ Bindings: Env }>();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getDeviceId(c: { req: { header: (k: string) => string | undefined; query: (k: string) => string | undefined } }): string | null {
  const headerId = c.req.header("X-Device-Id");
  if (headerId && UUID_RE.test(headerId)) return headerId;
  const queryId = c.req.query("device_id");
  if (queryId && UUID_RE.test(queryId)) return queryId;
  return null;
}

followsRoutes.get("/me/follows", async (c) => {
  const deviceId = getDeviceId(c);
  if (!deviceId) {
    return c.json({ error: "Missing or invalid X-Device-Id" }, 400);
  }

  const rows = await c.env.DB.prepare(
    `SELECT sf.id, sf.source_id as sourceId, sf.created_at as createdAt,
            s.name as sourceName, s.url as sourceUrl, s.domain as sourceDomain
     FROM source_follows sf
     LEFT JOIN sources s ON s.id = sf.source_id
     WHERE sf.device_id = ?
     ORDER BY sf.created_at DESC`
  )
    .bind(deviceId)
    .all();

  return c.json({ follows: rows.results ?? [] });
});

followsRoutes.post("/sources/:id/follow", async (c) => {
  const deviceId = getDeviceId(c);
  if (!deviceId) {
    return c.json({ error: "Missing or invalid X-Device-Id" }, 400);
  }
  const sourceId = parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(sourceId) || sourceId <= 0) {
    return c.json({ error: "Invalid source id" }, 400);
  }

  // Verify the source exists (and is active) before following.
  const src = await c.env.DB.prepare(
    "SELECT id, name, url, domain FROM sources WHERE id = ? AND is_active = 1"
  )
    .bind(sourceId)
    .first<{ id: number; name: string; url: string; domain: string | null }>();
  if (!src) {
    return c.json({ error: "Source not found or inactive" }, 404);
  }

  // INSERT OR IGNORE because (device_id, source_id) is unique.
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO source_follows (device_id, source_id) VALUES (?, ?)"
  )
    .bind(deviceId, sourceId)
    .run();

  return c.json({ following: true, source: src }, 201);
});

followsRoutes.delete("/sources/:id/follow", async (c) => {
  const deviceId = getDeviceId(c);
  if (!deviceId) {
    return c.json({ error: "Missing or invalid X-Device-Id" }, 400);
  }
  const sourceId = parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(sourceId) || sourceId <= 0) {
    return c.json({ error: "Invalid source id" }, 400);
  }

  await c.env.DB.prepare(
    "DELETE FROM source_follows WHERE device_id = ? AND source_id = ?"
  )
    .bind(deviceId, sourceId)
    .run();

  return c.json({ following: false });
});
