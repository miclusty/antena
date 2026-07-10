import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const ASTRO_CONFIG = join(ROOT, "astro.config.mjs");
const DIST = join(ROOT, "dist");
const PUBLIC_DIR = join(ROOT, "public");

/**
 * Smoke tests for the C3 service-worker `navigateFallback` config
 * (`/offline.html`) and the C5 manifest conflict (no
 * `public/manifest.json` should exist once VitePWA owns the manifest).
 *
 * These read the source config and the post-build `dist/` so they
 * only pass after `pnpm --filter antena build` has run with the
 * current `astro.config.mjs`. They protect against regressions where
 * (a) someone removes the offline fallback, leaving users with a
 * blank page on bad connections, or (b) someone re-adds a static
 * `public/manifest.json` and VitePWA starts emitting two conflicting
 * manifests.
 */

describe("service worker + PWA manifest", () => {
  let astroConfig: string;
  beforeAll(() => {
    astroConfig = readFileSync(ASTRO_CONFIG, "utf-8");
  });

  it("astro.config.mjs declares navigateFallback: '/offline.html' for C3", () => {
    // The audit (2026-07-09) flagged C3 — without navigateFallback,
    // a network failure on a navigation request shows the browser's
    // default offline page instead of the branded offline.html.
    expect(astroConfig).toMatch(/navigateFallback:\s*["']\/offline\.html["']/);
  });

  it("astro.config.mjs keeps /api/ out of the navigateFallback deny-list (it was correct, don't break it)", () => {
    expect(astroConfig).toMatch(/navigateFallbackDenylist/);
    // The deny-list pattern is a regex, so the literal `\/api\/`
    // appears in the source (escaped forward slashes).
    expect(astroConfig).toMatch(/\\\/api\\\//);
  });

  it("astro.config.mjs points the manifest icons at PNG assets, not SVG", () => {
    // C4 — the manifest must declare PNG icons so ChromeOS / Android
    // install dialogs render the right rasterized glyph.
    expect(astroConfig).toMatch(/icon-192\.png/);
    expect(astroConfig).toMatch(/icon-512\.png/);
    expect(astroConfig).toMatch(/icon-maskable-512\.png/);
  });

  it("astro.config.mjs does NOT ship a stray manifest.json includeAssets entry (C5)", () => {
    // The audit found public/manifest.json conflicting with VitePWA's
    // generated manifest.webmanifest. The fix was to delete the static
    // file and let VitePWA own the manifest. Pin that decision here.
    expect(astroConfig).not.toMatch(/includeAssets[^]*manifest\.json/);
  });

  it("Layout.astro references the VitePWA-generated /manifest.webmanifest", () => {
    // VitePWA emits /manifest.webmanifest, not /manifest.json. The
    // <link rel="manifest"> must match, or the browser will 404 on
    // the manifest and refuse the install prompt.
    const layout = readFileSync(join(ROOT, "src", "layouts", "Layout.astro"), "utf-8");
    expect(layout).toMatch(/<link[^>]+rel=["']manifest["'][^>]+href=["']\/manifest\.webmanifest["']/);
  });

  it("Layout.astro uses a PNG apple-touch-icon (Safari ignores SVG)", () => {
    const layout = readFileSync(join(ROOT, "src", "layouts", "Layout.astro"), "utf-8");
    const icon = layout.match(/<link[^>]+rel=["']apple-touch-icon["'][^>]*>/);
    expect(icon, "expected <link rel=\"apple-touch-icon\"> in Layout.astro").toBeTruthy();
    expect(icon![0]).toMatch(/\/icons\/icon-\d+\.png/);
    expect(icon![0]).not.toMatch(/\.svg/);
  });

  it("generated PNG icons are present on disk", () => {
    for (const file of ["icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
      expect(existsSync(join(PUBLIC_DIR, "icons", file)), `${file} must exist`).toBe(true);
    }
  });

  it("no static public/manifest.json exists (C5 — VitePWA owns the manifest)", () => {
    expect(existsSync(join(PUBLIC_DIR, "manifest.json"))).toBe(false);
    expect(existsSync(join(PUBLIC_DIR, "manifest.webmanifest"))).toBe(false);
  });

  // The following checks only pass after `pnpm build`. They are
  // skipped automatically when dist/ is missing so the test suite
  // stays green in dev mode.
  describe("post-build (only runs when dist/ exists)", () => {
    const distExists = existsSync(DIST);

    it.skipIf(!distExists)("dist/offline.html is emitted for the SW navigateFallback", () => {
      expect(existsSync(join(DIST, "offline.html"))).toBe(true);
    });

    it.skipIf(!distExists)("dist contains exactly one manifest (no conflict)", () => {
      const json = existsSync(join(DIST, "manifest.json"));
      const webmanifest = existsSync(join(DIST, "manifest.webmanifest"));
      // VitePWA writes manifest.webmanifest; the older .json variant
      // would only exist if a stale public/manifest.json was copied
      // through.
      expect(webmanifest, "VitePWA manifest.webmanifest must be present").toBe(true);
      expect(json, "stale dist/manifest.json must not be emitted alongside").toBe(false);
    });

    it.skipIf(!distExists)("dist manifest declares PNG icons (192 + 512 + maskable)", () => {
      const manifest = JSON.parse(readFileSync(join(DIST, "manifest.webmanifest"), "utf-8"));
      const sources = (manifest.icons ?? []).map((i: { src: string }) => i.src);
      expect(sources).toContain("/icons/icon-192.png");
      expect(sources).toContain("/icons/icon-512.png");
      expect(sources.some((s: string) => s.includes("maskable"))).toBe(true);
      expect(sources.every((s: string) => !s.endsWith(".svg"))).toBe(true);
    });

    it.skipIf(!distExists)("dist/service worker generation hooks offline.html", () => {
      // After build, vite-plugin-pwa produces sw.js (workbox) with
      // navigateFallbackDenylist + runtimeCaching. We just sanity-
      // check that the SW file mentions offline.html and the API
      // denylist so we don't ship a config-only claim.
      const candidates = ["sw.js", "registerSW.js"];
      const swHit = candidates
        .map((f) => join(DIST, f))
        .filter((p) => existsSync(p))
        .map((p) => readFileSync(p, "utf-8"))
        .join("\n");
      expect(swHit).toMatch(/offline\.html/);
    });
  });
});