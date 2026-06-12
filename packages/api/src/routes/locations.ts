import { Hono } from "hono";
import type { Env } from "../lib/types";
import { getLocationById, getLocationsTree } from "../lib/d1";
import { getCities } from "../db/queries";
import {
  locationIdParamSchema,
  locationNearSchema,
  formatZodError,
} from "../lib/schemas";
import { withCache } from "../lib/cache";

export const locationsRoutes = new Hono<{ Bindings: Env }>();

locationsRoutes.get("/cities", async (c) => {
  return withCache(async () => {
    const cities = await getCities(c.env.DB, 12);
    return c.json({ cities });
  }, { ttl: 600, swr: 0 })(c.req.raw);
});

locationsRoutes.get("/tree", async (c) => {
  return withCache(async () => {
    const locations = await getLocationsTree(c.env.DB);
    return c.json(locations);
  }, { ttl: 3600, swr: 86_400 })(c.req.raw);
});

locationsRoutes.get("/near", async (c) => {
  const parsed = locationNearSchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }
  const { lat, lng } = parsed.data;

  const result = await c.env.DB
    .prepare(
      "SELECT *, (lat - ?) * (lat - ?) + (lng - ?) * (lng - ?) as dist_sq FROM locations ORDER BY dist_sq ASC LIMIT 1"
    )
    .bind(lat, lat, lng, lng)
    .first();
  if (!result) return c.json({ error: "No locations found" }, 404);
  return c.json(result);
});

locationsRoutes.get("/:id", async (c) => {
  const parsed = locationIdParamSchema.safeParse(c.req.param());
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }
  const { id } = parsed.data;

  const location = await getLocationById(c.env.DB, id);
  if (!location) return c.json({ error: "Not found" }, 404);
  return c.json(location);
});
