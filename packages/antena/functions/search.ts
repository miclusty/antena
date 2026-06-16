import type { PagesFunction } from "@cloudflare/workers-types";

interface PagesContextLite {
  request: Request;
  env: { API_BASE?: string };
}

async function handleSearch(ctx: PagesContextLite): Promise<Response> {
  const url = new URL(ctx.request.url);
  const q = url.searchParams.get("q") || "";
  if (!q) {
    return new Response("Missing q", { status: 400 });
  }
  const apiBase = ctx.env.API_BASE || "http://localhost:8787";
  const res = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
    },
  });
}

export const onRequestGet = handleSearch as unknown as PagesFunction;
