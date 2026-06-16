/**
 * AKIRA base URL helper.
 *
 * AKIRA (the Python extractor/scraper) is exposed via a tunnel
 * (e.g. https://*.trycloudflare.com) or a deployed instance.
 * The URL is read from the request context env (c.env.AKIRA_URL)
 * which is set via `[vars]` in wrangler.toml.
 *
 * Returns null when AKIRA isn't configured, so callers can
 * gracefully skip AKIRA-dependent operations.
 */
export function getAkiraBaseUrl(env?: { AKIRA_URL?: string }): string | null {
  if (env?.AKIRA_URL) return env.AKIRA_URL;
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
  // Note: tryFetchAkira without env requires AKIRA_URL to be in
  // globalThis. Use tryFetchAkiraWithEnv if you have a request context.
  const base = (globalThis as { AKIRA_URL?: string }).AKIRA_URL;
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

export async function tryFetchAkiraWithEnv(
  path: string,
  env: { AKIRA_URL?: string },
  init?: RequestInit,
  timeoutMs = 5000
): Promise<Response | null> {
  const base = getAkiraBaseUrl(env);
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
