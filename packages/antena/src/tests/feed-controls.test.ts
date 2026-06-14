import { describe, it, expect } from "vitest";
import { resolveCustomTabSelection, type CategoryOption } from "../lib/feed-controls";

const CATS: CategoryOption[] = [
  { name: "Política", slug: "politica" },
  { name: "Economía", slug: "economia" },
  { name: "Tecnología", slug: "tecnologia" },
];

describe("resolveCustomTabSelection", () => {
  it("returns the matching category and shouldReset=true for a known cat:* tab", () => {
    const out = resolveCustomTabSelection("cat:tecnologia", CATS);
    expect(out).toEqual({
      categoryName: "Tecnología",
      shouldReset: true,
      slug: "tecnologia",
    });
  });

  it("returns shouldReset=false for the built-in 'home' tab", () => {
    const out = resolveCustomTabSelection("home", CATS);
    expect(out).toEqual({
      categoryName: null,
      shouldReset: false,
      slug: null,
    });
  });

  it("returns shouldReset=false for the 'following' tab", () => {
    const out = resolveCustomTabSelection("following", CATS);
    expect(out.shouldReset).toBe(false);
    expect(out.categoryName).toBe(null);
  });

  it("returns categoryName=null when the slug is unknown (defensive)", () => {
    const out = resolveCustomTabSelection("cat:no-existe", CATS);
    expect(out).toEqual({
      categoryName: null,
      shouldReset: true,
      slug: "no-existe",
    });
  });

  it("ignores non-prefixed tab ids that aren't built-in (defensive)", () => {
    const out = resolveCustomTabSelection("weird-tab", CATS);
    expect(out.shouldReset).toBe(false);
    expect(out.categoryName).toBe(null);
  });
});
