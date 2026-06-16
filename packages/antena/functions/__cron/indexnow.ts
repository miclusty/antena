// Pages Function: GET /__cron/indexnow
//
// Cron-triggered endpoint. On every invocation, it:
//  1. Fetches the latest N article IDs from the feed.
//  2. Pings IndexNow with the canonical URLs so Bing /
//     Yandex / Seznam / Naver re-crawl within minutes
//     instead of days.
//  3. Pings Google sitemap (best-effort, the
//     sitemap endpoint Google exposes for this is the
//     same one we serve).
//
// We keep it simple: the cron runs every 2 hours, we
// send the most recent 50 URLs. IndexNow also rate-
// limits at 10k URLs per call so there's no concern.
//
// Auth: simple shared secret in the URL. Cloudflare
// Pages Cron Triggers can be configured with a custom
// path and the secret stays in the URL itself, so it's
// not part of the public surface.

import type { PagesFunction } from "@cloudflare/workers-types";
import type { PagesEnv } from "../../../lib/cloudflare";

const RECENT_LIMIT = 50;
const SHARED_SECRET = "antena-indexnow-secret-rotate-me";

export const onRequestGet = handleIndexNow as unknown as PagesFunction<PagesEnv>;

async function handleIndexNow(ctx: { request: Request; env: PagesEnv }): Promise<Response> {
  const url = new URL(ctx.request.url);
  if (url.searchParams.get("key") !== SHARED_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  const apiBase = ctx.env.PUBLIC_API_BASE || "https://akira-api.miclusty.workers.dev";
  const origin = new URL(ctx.request.url).origin;

  // Fetch the most recent article IDs from the feed.
  let ids: string[] = [];
  try {
    const res = await fetch(`${apiBase}/api/news/feed?limit=${RECENT_LIMIT}&offset=0`);
    if (res.ok) {
      const data = (await res.json()) as { news: { id: string; published_at: string | null }[] };
      ids = data.news.map((n) => n.id);
    }
  } catch (e) {
    return new Response(`Feed fetch failed: ${e}`, { status: 502 });
  }

  if (ids.length === 0) {
    return new Response("No articles to ping", { status: 200 });
  }

  const urls = ids.map((id) => `${origin}/noticia/${id}`);

  // ── IndexNow ──────────────────────────────────────────
  let indexNowOk = 0;
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: new URL(origin).host,
        key: "antena2026indexnow",
        keyLocation: `${origin}/antena2026indexnow.txt`,
        urlList: urls,
      }),
    });
    indexNowOk = res.ok ? urls.length : 0;
  } catch {
    // best-effort
  }

  // ── Google sitemap ping (optional, but helps
  //    Google pick up the change faster) ─────────────
  let googlePing = false;
  try {
    const res = await fetch(
      `https://www.google.com/ping?sitemap=${encodeURIComponent(`${origin}/sitemap.xml`)}`,
    );
    googlePing = res.ok;
  } catch {
    // best-effort
  }

  return new Response(
    JSON.stringify({
      ok: true,
      articles: urls.length,
      indexNow: indexNowOk,
      googlePing,
      timestamp: new Date().toISOString(),
    }, null, 2),
    { headers: { "Content-Type": "application/json" } },
  );
}