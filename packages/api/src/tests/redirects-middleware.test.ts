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
