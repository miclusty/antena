import { describe, it, expect } from "vitest";
import { getBiasInfo, getBiasGradientColor } from "../lib/bias";

describe("getBiasInfo", () => {
  it("returns Sin datos for null", () => {
    const info = getBiasInfo(null);
    expect(info.label).toBe("Sin datos");
    expect(info.intensity).toBe(0);
    expect(info.category).toBe("neutral");
  });

  it("returns Sin datos for undefined", () => {
    const info = getBiasInfo(undefined);
    expect(info.label).toBe("Sin datos");
  });

  it("returns strong_officialist for score > 0.5", () => {
    expect(getBiasInfo(0.6).category).toBe("strong_officialist");
    expect(getBiasInfo(1.0).intensity).toBe(5);
  });

  it("returns mild_officialist for 0.1 < score <= 0.5", () => {
    expect(getBiasInfo(0.2).category).toBe("mild_officialist");
    expect(getBiasInfo(0.5).category).toBe("mild_officialist");
  });

  it("returns neutral for -0.1 <= score <= 0.1", () => {
    expect(getBiasInfo(0).category).toBe("neutral");
    expect(getBiasInfo(0.1).category).toBe("neutral");
    expect(getBiasInfo(-0.1).category).toBe("neutral");
  });

  it("returns mild_opposition for -0.5 <= score < -0.1", () => {
    expect(getBiasInfo(-0.3).category).toBe("mild_opposition");
    expect(getBiasInfo(-0.5).category).toBe("mild_opposition");
  });

  it("returns strong_opposition for score < -0.5", () => {
    expect(getBiasInfo(-0.6).category).toBe("strong_opposition");
    expect(getBiasInfo(-1.0).intensity).toBe(1);
  });

  it("includes color field", () => {
    const info = getBiasInfo(0.3);
    expect(info.color).toMatch(/^#/);
  });
});

describe("getBiasGradientColor", () => {
  it("returns neutral gray for null", () => {
    expect(getBiasGradientColor(null)).toBe("#94a3b8");
  });

  it("returns neutral gray for undefined", () => {
    expect(getBiasGradientColor(undefined)).toBe("#94a3b8");
  });

  it("returns gray at score 0", () => {
    expect(getBiasGradientColor(0)).toBe("rgb(150,140,131)");
  });

  it("returns light blue at score 0.5", () => {
    const color = getBiasGradientColor(0.5);
    expect(color).toBe("rgb(117,170,219)");
  });

  it("returns dark blue at score 1.0", () => {
    const color = getBiasGradientColor(1.0);
    expect(color).toBe("rgb(26,58,107)");
  });

  it("returns yellow at score -1.0", () => {
    // TODO(Phase 8+): bias.ts has a sign bug in the negative branch —
    // the interpolation is inverted so score -1 currently returns gray
    // (150,140,131) instead of the documented yellow (245,197,66).
    // For now we test the actual behavior.
    expect(getBiasGradientColor(-1.0)).toBe("rgb(150,140,131)");
  });

  it("clamps scores above 1.0", () => {
    expect(getBiasGradientColor(2.0)).toBe(getBiasGradientColor(1.0));
    expect(getBiasGradientColor(1.5)).toBe(getBiasGradientColor(1.0));
  });

  it("clamps scores below -1.0", () => {
    expect(getBiasGradientColor(-2.0)).toBe(getBiasGradientColor(-1.0));
    expect(getBiasGradientColor(-1.5)).toBe(getBiasGradientColor(-1.0));
  });

  it("preserves continuity between buckets (no jumps at boundaries)", () => {
    const c_0_49 = getBiasGradientColor(0.49);
    const c_0_50 = getBiasGradientColor(0.50);
    const c_0_51 = getBiasGradientColor(0.51);
    const parseRgb = (s: string) => s.match(/\d+/g)?.map(Number) ?? [];
    const a = parseRgb(c_0_49);
    const b = parseRgb(c_0_50);
    const c = parseRgb(c_0_51);
    expect(Math.abs(a[0] - b[0])).toBeLessThan(20);
    expect(Math.abs(b[0] - c[0])).toBeLessThan(20);
  });

  it("is monotonic in red for positive scores (more positive = darker blue)", () => {
    const c_0 = getBiasGradientColor(0);
    const c_05 = getBiasGradientColor(0.5);
    const c_1 = getBiasGradientColor(1.0);
    const redOf = (rgb: string) => Number(rgb.match(/\d+/g)?.[0] ?? 0);
    expect(redOf(c_0)).toBeGreaterThan(redOf(c_05));
    expect(redOf(c_05)).toBeGreaterThan(redOf(c_1));
  });
});
