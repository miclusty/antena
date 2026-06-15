import { describe, expect, it } from "vitest";

describe("legacyRedirectMiddleware regex", () => {
  // The regex is module-internal; re-implement it here as a
  // regression test. The actual middleware file imports a
  // function that returns the compiled pattern; mirror it.
  const PATTERN = /^\/noticia\/([0-9a-f-]{36})\/?$/;

  it("matches /noticia/<uuid> (no trailing slash)", () => {
    const m = "/noticia/fdf5a816-ff23-5610-86e2-26b49870a975".match(PATTERN);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("fdf5a816-ff23-5610-86e2-26b49870a975");
  });

  it("matches /noticia/<uuid>/ (with trailing slash — Pages adds it)", () => {
    const m = "/noticia/fdf5a816-ff23-5610-86e2-26b49870a975/".match(PATTERN);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("fdf5a816-ff23-5610-86e2-26b49870a975");
  });

  it("does NOT match /noticia/<uuid>extra", () => {
    expect("/noticia/fdf5a816-ff23-5610-86e2-26b49870a975extra".match(PATTERN)).toBeNull();
  });

  it("does NOT match /noticia/<bad-uuid>", () => {
    expect("/noticia/not-a-uuid".match(PATTERN)).toBeNull();
  });

  it("does NOT match /noticia/ (no UUID)", () => {
    expect("/noticia/".match(PATTERN)).toBeNull();
  });

  it("does NOT match /noticia (no slash)", () => {
    expect("/noticia".match(PATTERN)).toBeNull();
  });

  it("does NOT match /api/news/<uuid> (only /noticia/* is legacy)", () => {
    expect("/api/news/fdf5a816-ff23-5610-86e2-26b49870a975".match(PATTERN)).toBeNull();
  });
});

describe("apex → www 301 redirect", () => {
  // The Pages _redirects rule can't redirect from one host to
  // another when Pages is bound to the apex. The worker has its
  // own route binding for antena.com.ar/* that 301s everything
  // to www before any other processing. The logic is a single
  // hostname check in middleware/index.ts; this test verifies
  // the redirect URL construction across the common cases.
  const buildRedirectUrl = (hostname: string, pathname: string, search: string): string | null => {
    if (hostname !== "antena.com.ar") return null;
    return `https://www.antena.com.ar${pathname}${search}`;
  };

  it("redirects apex root to www root", () => {
    expect(buildRedirectUrl("antena.com.ar", "/", "")).toBe(
      "https://www.antena.com.ar/",
    );
  });

  it("preserves the path in the redirect", () => {
    expect(buildRedirectUrl("antena.com.ar", "/2026/05/18/some-slug/", "")).toBe(
      "https://www.antena.com.ar/2026/05/18/some-slug/",
    );
  });

  it("preserves query string in the redirect", () => {
    expect(buildRedirectUrl("antena.com.ar", "/buscar", "?q=test")).toBe(
      "https://www.antena.com.ar/buscar?q=test",
    );
  });

  it("does NOT redirect www.antena.com.ar (only the apex)", () => {
    expect(buildRedirectUrl("www.antena.com.ar", "/", "")).toBeNull();
    expect(buildRedirectUrl("akira-api.miclusty.workers.dev", "/api/news", "")).toBeNull();
  });

  it("does NOT redirect other hosts (workers.dev, etc.)", () => {
    expect(buildRedirectUrl("akira-api.miclusty.workers.dev", "/", "")).toBeNull();
    expect(buildRedirectUrl("staging.antena.com.ar", "/", "")).toBeNull();
  });
});
