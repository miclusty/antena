import { Hono } from "hono";
import type { Env } from "../lib/types";

const AKIRA_BASE = "http://localhost:5000";

export const synthesisRoutes = new Hono<{ Bindings: Env }>();

synthesisRoutes.get("/master/:cluster_id", async (c) => {
  const cluster_id = c.req.param("cluster_id");
  try {
    const res = await fetch(`${AKIRA_BASE}/synthesis/master/${cluster_id}`);
    if (!res.ok) return c.json({ error: "Not found" }, 404);
    const data = await res.json();
    return c.json(data);
  } catch {
    return c.json({ error: "Synthesis service unavailable" }, 503);
  }
});

synthesisRoutes.get("/stats", async (c) => {
  try {
    const res = await fetch(`${AKIRA_BASE}/synthesis/stats`);
    if (!res.ok) return c.json({ error: "Not found" }, 404);
    return c.json(await res.json());
  } catch {
    return c.json({ error: "Synthesis service unavailable" }, 503);
  }
});
