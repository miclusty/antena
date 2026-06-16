import type { PagesFunction } from "@cloudflare/workers-types";
import type { PagesEnv } from "../../lib/cloudflare";

async function handleTrack(ctx: {
  request: Request;
  env: PagesEnv;
}): Promise<Response> {
  const body = (await ctx.request.json().catch(() => null)) as
    | {
        type?: string;
        newsId?: string;
        category?: string;
        source?: string;
        dwellTime?: number;
        scrollDepth?: number;
      }
    | null;

  if (!body || typeof body !== "object" || typeof body.type !== "string") {
    return new Response("Invalid body", { status: 400 });
  }

  ctx.env.ANALYTICS.writeDataPoint({
    blobs: [
      body.type,
      body.newsId ?? "",
      body.category ?? "",
      body.source ?? "",
    ],
    doubles: [body.dwellTime ?? 0, body.scrollDepth ?? 0],
    indexes: [body.newsId ?? "anon"],
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequestPost = handleTrack as unknown as PagesFunction<PagesEnv>;
