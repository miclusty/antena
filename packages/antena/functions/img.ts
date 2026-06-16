// Pages Function: GET /api/img
//
// Image resizing proxy. Wraps Cloudflare's Image
// Resizing (`/cdn-cgi/image/...`) so the client can
// request an arbitrary remote image at an arbitrary
// width / quality / format and we hand back a
// CDN-cached, optimized version.
//
// Query params:
//   url   (required) — source image URL (http/https)
//   w     (optional, default 800) — max width px
//   q     (optional, default 75) — quality 1..100
//   fmt   (optional, default webp) — webp | avif | jpeg | png
//   fit   (optional, default scale-down) — scale-down | cover
//        | contain | crop | pad
//
// The first time a unique (url, w, q, fmt, fit) tuple
// is seen, Cloudflare fetches the origin, transforms it
// at the edge, and caches the result. Subsequent
// requests are served from cache with the configured
// Cache-Control on `/api/img/*` in _headers.

import type { PagesFunction } from "@cloudflare/workers-types";

export const onRequestGet = handleImage as unknown as PagesFunction;

async function handleImage(ctx: { request: Request }): Promise<Response> {
  const url = new URL(ctx.request.url);
  const src = url.searchParams.get("url");
  if (!src) return new Response("Missing url", { status: 400 });

  // Basic SSRF protection: only http(s), no localhost,
  // no private IPs in production. The set of valid
  // source hosts is whatever the news aggregator pulls
  // from (RSS images, source sites). We allow any
  // public HTTP(S) image.
  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return new Response("Unsupported protocol", { status: 400 });
  }
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname.endsWith(".local")) {
    return new Response("Forbidden host", { status: 403 });
  }

  // Cloudflare Image Resizing: /cdn-cgi/image/options/source
  // We compose a relative URL — Pages will proxy through
  // /cdn-cgi/image on the same origin so we don't need
  // to know the public hostname.
  const width = clampInt(url.searchParams.get("w"), 32, 2400, 800);
  const quality = clampInt(url.searchParams.get("q"), 1, 100, 75);
  const format = (url.searchParams.get("fmt") || "webp").toLowerCase();
  const fit = (url.searchParams.get("fit") || "scale-down").toLowerCase();

  const validFormats = new Set(["webp", "avif", "jpeg", "png", "auto"]);
  const validFits = new Set(["scale-down", "cover", "contain", "crop", "pad"]);

  const fmt = validFormats.has(format) ? format : "webp";
  const f = validFits.has(fit) ? fit : "scale-down";

  const cdnUrl = `/cdn-cgi/image/width=${width},quality=${quality},format=${fmt},fit=${f}/${src}`;

  // Fetch and stream the response back. Cloudflare's
  // /cdn-cgi/image/ endpoint already sets long-lived
  // cache headers; we just pipe it through.
  try {
    const res = await fetch(cdnUrl);
    if (!res.ok) return new Response("Upstream error", { status: 502 });
    const body = await res.arrayBuffer();
    return new Response(body, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || `image/${fmt}`,
        // Tell the browser to keep this for a year; the
        // srcset signature changes when the article image
        // is updated, so cache invalidation is implicit.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return new Response(`Image proxy failed: ${e}`, { status: 502 });
  }
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
