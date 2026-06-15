import { Hono } from "hono";
import type { Env, IngestRequest } from "../lib/types";
import { authMiddleware } from "../middleware/auth";
import { insertNewsCard, insertSource } from "../lib/d1";
import { invalidateFeedCache } from "../lib/kv";

export const ingestRoutes = new Hono<{ Bindings: Env }>();

ingestRoutes.post("/ingest", authMiddleware, async (c) => {
  let body: IngestRequest;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body.id || !body.title || !body.location_id) {
    return c.json({ error: "Missing required fields: id, title, location_id" }, 400);
  }
  // Sanitize: treat empty/whitespace-only summary as missing
  const summary = (body.summary || "").trim();
  const sanitizedBody = { ...body, summary: summary || `[Ver en ${body.source_ids || "fuente"}](${body.id.split("-")[0]})` };
  await insertNewsCard(c.env.DB, sanitizedBody);
  await invalidateFeedCache(c.env.CACHE, body.location_id.toString());
  return c.json({ status: "ok", id: body.id }, 201);
});

ingestRoutes.post("/sources", authMiddleware, async (c) => {
  let body: { name: string; url: string; location_id?: number };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body.name || !body.url) return c.json({ error: "Missing name or url" }, 400);
  await insertSource(c.env.DB, body);
  return c.json({ status: "ok" }, 201);
});
