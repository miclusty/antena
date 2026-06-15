import type { MiddlewareHandler } from "hono";
import type { Env } from "../lib/types";

/**
 * Legacy `/noticia/<uuid>` → `/<y>/<m>/<d>/<slug>` redirect middleware.
 *
 * Cloudflare Pages accepts a maximum of 2000 rules in `_redirects`,
 * so the build-time script (Task 30) puts the most recent 2000 in
 * `packages/antena/public/_redirects` and the long tail in
 * `packages/api/.redirects-cache.json`. The Astro site serves the
 * recent 2000 at the edge; this middleware handles the long tail
 * on the API worker.
 *
 * The worker caches the map in-memory per isolate (Map) for 1 hour
 * and falls back to a KV copy (`CACHE:redirects-legacy-map`) on
 * cold start so we don't pay the wrangler D1 round-trip on every
 * request.
 *
 * Phase 3 Task 32. Locked decision (AGENTS.md): the canonical host
 * is `https://www.antena.com.ar` (with www).
 */
let cache: Map<string, string> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function loadRedirectMap(env: Env): Promise<Map<string, string>> {
  // 1. Try the KV copy first (set by a deploy hook or by the
  //    prebuild script uploading it). Cheap and warm.
  try {
    const kvData = await env.CACHE.get("redirects-legacy-map", "json");
    if (kvData && typeof kvData === "object") {
      return new Map(Object.entries(kvData as Record<string, string>));
    }
  } catch (e) {
    console.error("[legacyRedirect] KV read failed:", e);
  }

  // 2. Fall back to the on-disk cache the prebuild script wrote.
  //    We use dynamic imports so this middleware can also be
  //    bundled for production deploy (where `node:fs` doesn't
  //    exist) without breaking the build.
  try {
    const [{ readFileSync, existsSync }, { join }] = await Promise.all([
      import("node:fs"),
      import("node:path"),
    ]);
    const path = join(process.cwd(), ".redirects-cache.json");
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
      // Best-effort: re-upload to KV so future cold starts skip
      // the disk read. If this fails, we still served this request.
      try {
        await env.CACHE.put("redirects-legacy-map", JSON.stringify(data), { expirationTtl: 86400 });
      } catch {
        // ignore
      }
      return new Map(Object.entries(data));
    }
  } catch {
    // `node:fs` not available (e.g. on a fully-bundled worker)
    // — that's fine, we'll just have an empty map.
  }

  return new Map();
}

export const legacyRedirectMiddleware = (): MiddlewareHandler<{ Bindings: Env }> => {
  return async (c, next) => {
    const url = new URL(c.req.url);
    // Cloudflare Pages appends a trailing slash for directory-style
    // requests before they reach the worker, so accept both
    // /noticia/<uuid> and /noticia/<uuid>/.
    const match = url.pathname.match(/^\/noticia\/([0-9a-f-]{36})\/?$/);
    if (!match) {
      return next();
    }

    const id = match[1];

    const now = Date.now();
    if (!cache || now - cacheLoadedAt > CACHE_TTL_MS) {
      cache = await loadRedirectMap(c.env);
      cacheLoadedAt = now;
    }

    const target = cache.get(id);
    if (target) {
      return c.redirect(`https://www.antena.com.ar${target}`, 301);
    }

    return next();
  };
};
