import { describe, it, expect, beforeEach } from "vitest";
import { readDensity, writeDensity, type Density } from "../lib/preferences";

beforeEach(() => {
  localStorage.clear();
});

describe("density preference", () => {
  it("defaults to 'comfortable' when nothing is stored", () => {
    expect(readDensity()).toBe("comfortable");
  });

  it("returns the stored value when present", () => {
    localStorage.setItem("antena-density", "compact");
    expect(readDensity()).toBe("compact");
  });

  it("ignores garbage values and falls back to default", () => {
    localStorage.setItem("antena-density", "weird-mode");
    expect(readDensity()).toBe("comfortable");
  });

  it("persists writes that round-trip", () => {
    writeDensity("compact");
    expect(localStorage.getItem("antena-density")).toBe("compact");
    expect(readDensity()).toBe("compact");
  });

  it("accepts both density values", () => {
    const values: Density[] = ["compact", "comfortable"];
    for (const v of values) {
      writeDensity(v);
      expect(readDensity()).toBe(v);
    }
  });
});
