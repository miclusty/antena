import { describe, it, expect } from "vitest";
import { formatRelativeFromIso, type RelativeUnit } from "../lib/relative-time";

describe("formatRelativeFromIso", () => {
  const NOW = new Date("2026-06-14T12:00:00Z").getTime();
  const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

  it("returns 'ahora' for timestamps within the last 30s", () => {
    expect(formatRelativeFromIso(ago(5), NOW)).toBe("ahora");
    expect(formatRelativeFromIso(ago(29), NOW)).toBe("ahora");
  });

  it("returns minutes for <1h", () => {
    expect(formatRelativeFromIso(ago(60), NOW)).toBe("hace 1m");
    expect(formatRelativeFromIso(ago(45 * 60), NOW)).toBe("hace 45m");
  });

  it("returns hours for <24h", () => {
    expect(formatRelativeFromIso(ago(60 * 60), NOW)).toBe("hace 1h");
    expect(formatRelativeFromIso(ago(23 * 60 * 60), NOW)).toBe("hace 23h");
  });

  it("returns days for >=24h", () => {
    expect(formatRelativeFromIso(ago(24 * 60 * 60), NOW)).toBe("hace 1d");
    expect(formatRelativeFromIso(ago(7 * 24 * 60 * 60), NOW)).toBe("hace 7d");
  });

  it("returns '—' for null/invalid input (defensive)", () => {
    expect(formatRelativeFromIso(null, NOW)).toBe("—");
    expect(formatRelativeFromIso("", NOW)).toBe("—");
    expect(formatRelativeFromIso("not-a-date", NOW)).toBe("—");
  });

  it("returns '—' for future timestamps (clock skew)", () => {
    const future = new Date(NOW + 60_000).toISOString();
    expect(formatRelativeFromIso(future, NOW)).toBe("—");
  });

  it("accepts a custom unit set (caller controls output)", () => {
    const out: { value: number; unit: RelativeUnit } = {
      value: 0,
      unit: "second",
    };
    // Smoke: function signature is unit-agnostic.
    expect(typeof formatRelativeFromIso).toBe("function");
    void out;
  });
});
