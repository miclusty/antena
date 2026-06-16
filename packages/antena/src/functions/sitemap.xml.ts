// /sitemap.xml — Sitemap proxy.
//
// Wraps the API's /sitemap.xml so the response is served with
// Content-Type: application/xml (Astro static output would
// default to text/html).

interface PagesContextLite {
  request: Request;
  env: { API_BASE?: string };
}

export const onRequestGet = async (ctx: PagesContextLite): Promise<Response> => {
  const apiBase = ctx.env.API_BASE || "https://akira-api.miclusty.workers.dev";
  try {
    const res = await fetch(`${apiBase}/sitemap.xml`);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=900",
      },
    });
  } catch (e) {
    return new Response(`<error>${(e as Error).message}</error>`, {
      status: 502,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }
};
