import { describe, it, expect } from "vitest";
import { readingTimeText, computeScrollPct } from "../lib/reading-progress";

describe("readingTimeText", () => {
  it("returns 0 min for empty body", () => {
    expect(readingTimeText("")).toBe("0 min de lectura");
  });

  it("returns 1 min for a short body (< 200 words)", () => {
    expect(readingTimeText("uno dos tres")).toBe("1 min de lectura");
  });

  it("scales with word count (200 words/min)", () => {
    const words = Array(600).fill("w").join(" ");
    expect(readingTimeText(words)).toBe("3 min de lectura");
  });
});

describe("computeScrollPct", () => {
  it("returns 0 at the top", () => {
    expect(computeScrollPct(0, 1000)).toBe(0);
  });

  it("returns 1 at the bottom", () => {
    expect(computeScrollPct(1000, 1000)).toBe(1);
  });

  it("returns the linear progress in the middle", () => {
    expect(computeScrollPct(500, 1000)).toBe(0.5);
  });

  it("clamps to 0 when scrolled negative", () => {
    expect(computeScrollPct(-100, 1000)).toBe(0);
  });

  it("clamps to 1 when scrolled past the end", () => {
    expect(computeScrollPct(2000, 1000)).toBe(1);
  });

  it("returns 0 when the page is shorter than the viewport", () => {
    expect(computeScrollPct(0, 0)).toBe(0);
  });
});
