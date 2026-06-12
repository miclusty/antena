import { Hono } from "hono";
import type { Env } from "../lib/types";
import { getCategories } from "../lib/d1";
import { withCache } from "../lib/cache";

export const categoriesRoutes = new Hono<{ Bindings: Env }>();

categoriesRoutes.get("/", async (c) => {
  return withCache(async () => {
    const categories = await getCategories(c.env.DB);
    return c.json(categories);
  }, { ttl: 3600, swr: 86_400 })(c.req.raw);
});
