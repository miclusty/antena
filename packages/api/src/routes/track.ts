import { Hono } from "hono";
import type { Env } from "../lib/types";
import { trackEventSchema, formatZodError } from "../lib/schemas";

export const trackRoutes = new Hono<{ Bindings: Env }>();

trackRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = trackEventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }

  const event = parsed.data;
  const newsId = event.newsId ?? "anon";

  if (c.env.ANALYTICS) {
    c.env.ANALYTICS.writeDataPoint({
      blobs: [event.type, newsId, event.category ?? "", event.source ?? ""],
      doubles: [event.dwellTime ?? 0, event.scrollDepth ?? 0],
      indexes: [newsId],
    });
  }

  return c.json({ ok: true });
});
