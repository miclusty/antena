import { describe, it, expect } from "vitest";
import { imageUrl, imageSrcset, responsiveImageSrcset, DEFAULT_RESPONSIVE_WIDTHS } from "../lib/image";

describe("imageUrl", () => {
  it("returns empty string for empty hash", () => {
    expect(imageUrl({ hash: "" })).toBe("");
  });

  it("builds URL with hash only", () => {
    expect(imageUrl({ hash: "abc123" })).toBe("/img/abc123?q=80");
  });

  it("includes width param", () => {
    const url = imageUrl({ hash: "abc", width: 640 });
    expect(url).toContain("w=640");
  });

  it("includes height param", () => {
    const url = imageUrl({ hash: "abc", height: 480 });
    expect(url).toContain("h=480");
  });

  it("includes fit param", () => {
    const url = imageUrl({ hash: "abc", fit: "cover" });
    expect(url).toContain("fit=cover");
  });

  it("includes format param", () => {
    const url = imageUrl({ hash: "abc", format: "webp" });
    expect(url).toContain("fmt=webp");
  });

  it("always includes quality", () => {
    const url = imageUrl({ hash: "abc", width: 320 });
    expect(url).toContain("q=80");
  });

  it("rounds fractional width", () => {
    const url = imageUrl({ hash: "abc", width: 320.7 });
    expect(url).toContain("w=321");
  });

  it("combines all params", () => {
    const url = imageUrl({ hash: "abc", width: 800, height: 600, fit: "contain", format: "avif" });
    expect(url).toMatch(/^\/img\/abc\?/);
    expect(url).toContain("w=800");
    expect(url).toContain("h=600");
    expect(url).toContain("fit=contain");
    expect(url).toContain("fmt=avif");
    expect(url).toContain("q=80");
  });
});

describe("imageSrcset", () => {
  it("returns empty string for empty hash", () => {
    expect(imageSrcset({ hash: "" }, [320, 640])).toBe("");
  });

  it("returns empty string for empty widths", () => {
    expect(imageSrcset({ hash: "abc" }, [])).toBe("");
  });

  it("builds srcset with multiple widths", () => {
    const srcset = imageSrcset({ hash: "abc" }, [320, 640, 1280]);
    const parts = srcset.split(", ");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain(" 320w");
    expect(parts[1]).toContain(" 640w");
    expect(parts[2]).toContain(" 1280w");
  });

  it("includes width in URL", () => {
    const srcset = imageSrcset({ hash: "abc", fit: "cover" }, [320]);
    expect(srcset).toContain("w=320");
    expect(srcset).toContain("fit=cover");
  });
});

describe("responsiveImageSrcset", () => {
  it("uses DEFAULT_RESPONSIVE_WIDTHS", () => {
    const srcset = responsiveImageSrcset("abc");
    for (const w of DEFAULT_RESPONSIVE_WIDTHS) {
      expect(srcset).toContain(` ${w}w`);
    }
  });

  it("defaults fit to cover", () => {
    const srcset = responsiveImageSrcset("abc");
    expect(srcset).toContain("fit=cover");
  });

  it("accepts contain fit", () => {
    const srcset = responsiveImageSrcset("abc", "contain");
    expect(srcset).toContain("fit=contain");
  });

  it("returns empty for empty hash", () => {
    expect(responsiveImageSrcset("")).toBe("");
  });
});

describe("DEFAULT_RESPONSIVE_WIDTHS", () => {
  it("contains common responsive breakpoints", () => {
    expect(DEFAULT_RESPONSIVE_WIDTHS).toContain(320);
    expect(DEFAULT_RESPONSIVE_WIDTHS).toContain(640);
    expect(DEFAULT_RESPONSIVE_WIDTHS).toContain(1280);
  });

  it("is sorted ascending", () => {
    const arr = [...DEFAULT_RESPONSIVE_WIDTHS];
    for (let i = 1; i < arr.length; i++) {
      expect(arr[i]).toBeGreaterThan(arr[i - 1]);
    }
  });
});
