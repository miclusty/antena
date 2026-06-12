import { Hono } from "hono";
import type { Env } from "../lib/types";
import { imageParamsSchema, formatZodError } from "../lib/schemas";
import { withCache } from "../lib/cache";

export const imageRoutes = new Hono<{ Bindings: Env }>();

imageRoutes.get("/:hash", async (c) => {
  const parsed = imageParamsSchema.safeParse({
    hash: c.req.param("hash"),
    w: c.req.query("w"),
    fmt: c.req.query("fmt"),
    fit: c.req.query("fit"),
  });
  if (!parsed.success) {
    return c.json(formatZodError(parsed.error), 400);
  }

  const { hash, w, fmt, fit } = parsed.data;

  return withCache(async () => {
    const object = await c.env.IMAGES.get(hash);
    if (object) {
      const cfImage: { width?: number; fit?: "cover" | "contain"; format?: "avif" | "webp" | "jpeg" } = {};
      if (w !== undefined) cfImage.width = w;
      if (fit !== undefined) cfImage.fit = fit;
      if (fmt !== undefined) cfImage.format = fmt === "jpg" ? "jpeg" : fmt;

      const r2Url = `https://antena-images.r2.cloudflarestorage.com/${hash}`;
      return fetch(r2Url, { cf: { image: cfImage } });
    }

    c.executionCtx.waitUntil(
      c.env.IMAGE_QUEUE.send({
        type: "fetch_and_store",
        hash,
        requestTime: Date.now(),
      })
    );

    return c.json({ error: "Image not yet available", hash }, 404);
  }, {
    ttl: 60 * 60 * 24 * 7,
    swr: 60 * 60 * 24,
  })(c.req.raw);
});
