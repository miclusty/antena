// Manual integration tests for sitemap.xml and rss.xml.
//
// These endpoints must return 200 with valid XML because:
// - /sitemap.xml: Google uses this for SEO indexing. Was 404 in prod
//   because Astro's src/functions/ wasn't being deployed (output: "static"
//   with no adapter skipped the functions directory).
// - /rss.xml: Feed readers (Feedly, NetNewsWire) poll this URL.
// - /sitemap-*.xml: Per-province sitemaps.
//
// The fix: Pages Functions live at the package root in `functions/`,
// compiled with `wrangler pages functions build` into dist/_worker.js,
// and deployed alongside the static dist/ output. HEAD requests
// return 404 because Pages doesn't run functions for HEAD (only GET),
// so the tests below use GET.
//
// NOTE: These tests hit production URLs and require real fetch.
// The default setup.ts stubs fetch with a no-op response. Run with:
//   pnpm vitest run sitemap --no-file-parallelism
// or use the helper script at scripts/check-sitemaps.sh instead.
// Skipped by default in CI; enabled manually during release verification.

import { describe, expect, it } from "vitest";

const ENABLED = process.env.RUN_SITEMAP_INTEGRATION === "1";
const describeIf = ENABLED ? describe : describe.skip;

describeIf("sitemap and rss endpoints (live integration)", () => {
  it("GET /sitemap.xml returns 200 with valid sitemap XML", async () => {
    const res = await fetch("https://www.antena.com.ar/sitemap.xml");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<?xml");
    expect(body).toContain("<urlset");
    expect(body).toContain("https://www.antena.com.ar/");
    const urlCount = (body.match(/<url>/g) ?? []).length;
    expect(urlCount).toBeGreaterThan(10);
  });

  it("GET /rss.xml returns 200 with valid RSS XML", async () => {
    const res = await fetch("https://www.antena.com.ar/rss.xml");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<?xml");
    expect(body).toContain("<rss");
    expect(body).toContain("Antena");
  });

  it("GET /sitemap-index.xml returns 200 listing per-province sitemaps", async () => {
    const res = await fetch("https://www.antena.com.ar/sitemap-index.xml");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<sitemapindex");
    expect(body).toContain("https://www.antena.com.ar/sitemap.xml");
    expect(body).toContain("sitemap-cordoba.xml");
  });
});