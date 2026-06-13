/**
 * AKIRA base URL helper.
 *
 * AKIRA (the Python extractor/scraper) runs only on the user's local
 * machine — it's NOT deployed to Cloudflare. In production builds,
 * `process.env.AKIRA_URL` is not set, so this returns `null` and
 * callers should gracefully skip any AKIRA-dependent operation
 * (synthesis, extract.py fallback, etc.).
 *
 * In local dev, set `AKIRA_URL=http://localhost:5000` in
 * `packages/antena/.env` and the helper returns the URL.
 */
export function getAkiraBaseUrl(): string | null {
  // process.env.AKIRA_URL is set per-environment in wrangler.toml
  // (or in the .env file for the frontend).
  const url =
    typeof process !== "undefined" && process.env
      ? process.env.AKIRA_URL
      : undefined;
  if (url) return url;

  // In dev, default to localhost:5000 (the Python uvicorn default port).
  if (
    typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string> }).env?.DEV
  ) {
    return "http://localhost:5000";
  }
  return null;
}

/**
 * Convenience: `await fetch(getAkiraBaseUrl() + '/health')` returns a
 * `Response | null`. Returns null when AKIRA isn't reachable (prod).
 */
export async function tryFetchAkira(
  path: string,
  init?: RequestInit,
  timeoutMs = 5000
): Promise<Response | null> {
  const base = getAkiraBaseUrl();
  if (!base) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${base}${path}`, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch {
    return null;
  }
}
