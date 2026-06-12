import { createMiddleware } from "hono/factory";
import type { Env } from "../lib/types";

export const authMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const apiKey = c.req.header("X-API-Key");
  if (!apiKey || apiKey !== c.env.API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});
