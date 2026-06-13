export interface CacheOptions {
  ttl?: number;
  swr?: number;
  vary?: string[];
  cacheableStatuses?: number[];
  private?: boolean;
}

const DEFAULT_TTL = 60;
const DEFAULT_SWR = 300;
const DEFAULT_CACHEABLE_STATUSES = [200, 203, 204, 300, 301, 404, 410];

function sortedEntries(params: Record<string, unknown>): [string, string][] {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => [k, String(params[k])]);
}

export function cacheKey(prefix: string, params: Record<string, unknown> = {}): string {
  const entries = sortedEntries(params);
  if (entries.length === 0) return prefix;
  const qs = entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `${prefix}?${qs}`;
}

export async function getCache(request: Request): Promise<Response | null> {
  const cache = (caches as unknown as { default: Cache }).default;
  return (await cache.match(request)) ?? null;
}

export async function setCache(
  request: Request,
  response: Response,
  opts: CacheOptions = {}
): Promise<void> {
  const ttl = opts.ttl ?? DEFAULT_TTL;
  const swr = opts.swr ?? DEFAULT_SWR;
  const cacheable = opts.cacheableStatuses ?? DEFAULT_CACHEABLE_STATUSES;
  if (!cacheable.includes(response.status)) return;

  const headers = new Headers(response.headers);
  const visibility = opts.private ? "private" : "public";
  const swrDirective = swr > 0 ? `, stale-while-revalidate=${swr}` : "";
  headers.set("Cache-Control", `${visibility}, max-age=${ttl}${swrDirective}`);

  const cached = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  const cache = (caches as unknown as { default: Cache }).default;
  await cache.put(request, cached.clone());
}

export function withCache(
  handler: (req: Request, ...args: unknown[]) => Promise<Response>,
  opts: CacheOptions = {}
): (req: Request, ...args: unknown[]) => Promise<Response> {
  return async (req: Request, ...args: unknown[]): Promise<Response> => {
    const cache = (caches as unknown as { default: Cache }).default;
    const vary = (opts.vary ?? []).map((h) => h.toLowerCase());

    if (vary.length > 0) {
      const varyHeader = vary.join(", ");
      const cached = (await cache.match(req)) ?? null;
      if (cached) {
        const cachedVary = cached.headers.get("Vary");
        if (cachedVary === varyHeader) {
          return cached;
        }
      }
    } else {
      const cached = (await cache.match(req)) ?? null;
      if (cached) return cached;
    }

    // Run the handler with try-catch fallback. If the upstream D1 query
    // or compute fails (timeout, network, 5xx), return a 503 instead of
    // letting the error bubble up to the user. Cloudflare's edge will
    // retry transient errors.
    let response: Response;
    try {
      response = await handler(req, ...args);
    } catch (e) {
      console.error("withCache handler failed:", e);
      return new Response(
        JSON.stringify({
          error: "Internal server error",
          message: (e as Error).message,
        }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    if (response.status === 200 || response.status === 203 || response.status === 204) {
      const ttl = opts.ttl ?? DEFAULT_TTL;
      const swr = opts.swr ?? DEFAULT_SWR;
      const headers = new Headers(response.headers);
      const visibility = opts.private ? "private" : "public";
      const swrDirective = swr > 0 ? `, stale-while-revalidate=${swr}` : "";
      headers.set("Cache-Control", `${visibility}, max-age=${ttl}${swrDirective}`);

      const cached = new Response(response.clone().body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      await cache.put(req, cached.clone());
    }

    return response;
  };
}
