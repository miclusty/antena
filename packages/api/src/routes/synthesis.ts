import { Hono } from "hono";
import type { Env } from "../lib/types";

import { getAkiraBaseUrl } from "../lib/akira-url";

const AKIRA_BASE = getAkiraBaseUrl() ?? "";

export const synthesisRoutes = new Hono<{ Bindings: Env }>();

synthesisRoutes.get("/master/:cluster_id", async (c) => {
  const cluster_id = c.req.param("cluster_id");
  // If AKIRA isn't configured or reachable, treat the
  // master article as "doesn't exist" so the frontend
  // falls back to the raw news card cleanly instead of
  // surfacing a 503 in the network panel.
  if (!AKIRA_BASE) {
    return c.json({ error: "Synthesis not configured" }, 404);
  }
  try {
    const res = await fetch(`${AKIRA_BASE}/synthesis/master/${cluster_id}`);
    if (!res.ok) {
      return c.json({ error: "Not found" }, res.status === 503 ? 404 : (res.status as 404));
    }
    const data = await res.json();
    return c.json(data);
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});

synthesisRoutes.get("/stats", async (c) => {
  if (!AKIRA_BASE) return c.json({ error: "Synthesis not configured" }, 404);
  try {
    const res = await fetch(`${AKIRA_BASE}/synthesis/stats`);
    if (!res.ok) return c.json({ error: "Not found" }, 404);
    return c.json(await res.json());
  } catch {
    return c.json({ error: "Not found" }, 404);
  }
});
