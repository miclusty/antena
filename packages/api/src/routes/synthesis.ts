import { Hono } from "hono";
import type { Env } from "../lib/types";

import { getAkiraBaseUrl } from "../lib/akira-url";

// Helper: 200 with synthesis=null when AKIRA isn't
// configured. Lets the frontend skip silently and
// keeps the Network tab clean. The 404 we used to
// return surfaced as a red error in devtools and
// made the page look broken even though the UI was
// already falling back to the raw news card.
const notConfigured = (c: { json: (b: unknown, s?: number) => Response }) =>
  c.json({ synthesis: null, reason: "not_configured" }, 200);

export const synthesisRoutes = new Hono<{ Bindings: Env }>();

synthesisRoutes.get("/master/:cluster_id", async (c) => {
  const cluster_id = c.req.param("cluster_id");
  const akiraBase = getAkiraBaseUrl(c.env);
  if (!akiraBase) return notConfigured(c);
  try {
    const res = await fetch(`${akiraBase}/synthesis/master/${cluster_id}`);
    if (!res.ok) {
      // AKIRA reachable but the master article for
      // this cluster doesn't exist yet (or 5xx).
      // Distinguish: a 5xx upstream is a server
      // problem; 404 means the article hasn't been
      // generated. Return 404 in both cases so the
      // frontend's safeFetch(null on 404) path is
      // uniform. 5xx at AKIRA means it generated a
      // bad master or hit a rate-limit, both of which
      // are equivalent to "no master available" for
      // the frontend.
      return c.json({ synthesis: null, reason: "not_found" }, 404);
    }
    const data = await res.json();
    return c.json(data);
  } catch {
    return c.json({ synthesis: null, reason: "akira_unreachable" }, 503);
  }
});

synthesisRoutes.get("/stats", async (c) => {
  const akiraBase = getAkiraBaseUrl(c.env);
  if (!akiraBase) return c.json({ available: false, reason: "not_configured" }, 200);
  try {
    const res = await fetch(`${akiraBase}/synthesis/stats`);
    if (!res.ok) return c.json({ available: false, reason: "akira_error" }, 502);
    const data: Record<string, unknown> = await res.json();
    return c.json({ available: true, ...data });
  } catch {
    return c.json({ available: false, reason: "akira_unreachable" }, 503);
  }
});
