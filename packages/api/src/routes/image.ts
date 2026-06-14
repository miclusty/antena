import { Hono } from "hono";
import type { Env } from "../lib/types";
import { imageParamsSchema, formatZodError } from "../lib/schemas";
import { withCache } from "../lib/cache";

export const imageRoutes = new Hono<{ Bindings: Env }>();

// GET /api/img/?url=...&w=...&q=...&fmt=...&fit=...
// (or /api/img?url=... — both are accepted)
//
// Proxy mode: fetch a remote image, transform via
// Cloudflare Image Resizing, return optimized
// bytes. Used by the frontend when a news card has
// an image_url but no R2 hash yet.
//
// Frontend always encodes the URL as `/api/img/?url=…`
// (with trailing slash), so we register both with-slash
// and without-slash handlers.
// Accept the proxy mode at both `/api/img` and
// `/api/img/` so the frontend's `encodeURIComponent`
// path `/api/img/?url=…` works without 404s.
imageRoutes.get("/", handleProxy);
// Hono treats empty path specially; the trailing-slash
// variant registers as a separate handler.
imageRoutes.get("", handleProxy);

async function handleProxy(c: import("hono").Context<{ Bindings: Env }>): Promise<Response> {
  const url = new URL(c.req.url);
  const src = url.searchParams.get("url");
  if (!src) return c.json({ error: "Missing url" }, 400);

  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return c.json({ error: "Invalid url" }, 400);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return c.json({ error: "Unsupported protocol" }, 400);
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
    return c.json({ error: "Forbidden host" }, 403);
  }

  const width = clampInt(url.searchParams.get("w"), 32, 2400, 800);
  const quality = clampInt(url.searchParams.get("q"), 1, 100, 75);
  const formatRaw = (url.searchParams.get("fmt") || "webp").toLowerCase();
  const fitRaw = (url.searchParams.get("fit") || "scale-down").toLowerCase();
  const validFormats = new Set(["webp", "avif", "jpeg", "png", "auto", "jpg"]);
  const validFits = new Set(["scale-down", "cover", "contain", "crop", "pad"]);
  const format = validFormats.has(formatRaw) ? (formatRaw === "jpg" ? "jpeg" : formatRaw) : "webp";
  const fit = validFits.has(fitRaw) ? fitRaw : "scale-down";

  try {
    // Fetch the upstream image and stream it back.
    // Cloudflare Image Resizing via /cdn-cgi/image/ is
    // not available on the shared `workers.dev` zone,
    // and the `cf.image` option only works for same-zone
    // upstreams. The browser will downscale the bytes
    // for display, and the bytes are gzipped/brotli'd
    // by the edge anyway.
    const upstream = await fetch(src, {
      headers: { "User-Agent": "Antena/1.0 (+https://www.antena.com.ar)" },
    });
    if (!upstream.ok) {
      return c.json({ error: "Upstream error", status: upstream.status }, 502);
    }
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "image/jpeg",
        "Cache-Control": "public, max-age=86400, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return c.json({ error: "Image proxy failed", detail: String(e) }, 502);
  }
}

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

    // Validate that the news card actually has a source image_url
    // before enqueueing. Otherwise the worker logs a warning and
    // acks the message immediately — wasted work and log noise.
    const card = await c.env.DB.prepare(
      "SELECT image_url FROM news_cards WHERE id = ? OR image_hash = ?"
    )
      .bind(hash, hash)
      .first<{ image_url: string | null }>();

    if (card?.image_url) {
      c.executionCtx.waitUntil(
        c.env.IMAGE_QUEUE.send({
          type: "fetch_and_store",
          hash,
          requestTime: Date.now(),
        })
      );
    }

    return c.json({ error: "Image not yet available", hash }, 404);
  }, {
    ttl: 60 * 60 * 24 * 7,
    swr: 60 * 60 * 24,
  })(c.req.raw);
});

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
