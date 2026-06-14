import { describe, it, expect, beforeEach } from "vitest";
import {
  readDensity,
  writeDensity,
  readFontScale,
  writeFontScale,
  readDataSaver,
  writeDataSaver,
  readImageQuality,
  writeImageQuality,
  clampFontScale,
  isValidImageQuality,
  type Density,
  type ImageQuality,
  type FontScale,
} from "../lib/preferences";

beforeEach(() => {
  localStorage.clear();
});

describe("density preference", () => {
  it("defaults to 'comfortable' when nothing is stored", () => {
    expect(readDensity()).toBe("comfortable");
  });
  it("persists writes that round-trip", () => {
    writeDensity("compact");
    expect(readDensity()).toBe("compact");
  });
});

describe("font scale", () => {
  it("defaults to 1.0 when nothing is stored", () => {
    expect(readFontScale()).toBe(1.0);
  });
  it("persists a value in range", () => {
    writeFontScale(1.2);
    expect(readFontScale()).toBe(1.2);
  });
  it("clamps out-of-range writes to 0.875..1.25", () => {
    expect(clampFontScale(0.5)).toBe(0.875);
    expect(clampFontScale(2.0)).toBe(1.25);
  });
  it("rejects garbage stored values and falls back to default", () => {
    localStorage.setItem("antena-font-scale", "huge");
    expect(readFontScale()).toBe(1.0);
  });
  it("rejects NaN and Infinity", () => {
    localStorage.setItem("antena-font-scale", "NaN");
    expect(readFontScale()).toBe(1.0);
    localStorage.setItem("antena-font-scale", "Infinity");
    expect(readFontScale()).toBe(1.0);
  });
  it("rejects values outside the clamp range on read", () => {
    localStorage.setItem("antena-font-scale", "5.0");
    expect(readFontScale()).toBe(1.0);
  });
});

describe("data-saver preference", () => {
  it("defaults to false", () => {
    expect(readDataSaver()).toBe(false);
  });
  it("round-trips true and false", () => {
    writeDataSaver(true);
    expect(readDataSaver()).toBe(true);
    writeDataSaver(false);
    expect(readDataSaver()).toBe(false);
  });
  it("rejects garbage values", () => {
    localStorage.setItem("antena-data-saver", "yes");
    expect(readDataSaver()).toBe(false);
  });
});

describe("image quality", () => {
  it("defaults to 'auto'", () => {
    expect(readImageQuality()).toBe("auto");
  });
  it("round-trips each valid value", () => {
    const values: ImageQuality[] = ["auto", "high", "medium", "low"];
    for (const v of values) {
      writeImageQuality(v);
      expect(readImageQuality()).toBe(v);
    }
  });
  it("validates input", () => {
    expect(isValidImageQuality("auto")).toBe(true);
    expect(isValidImageQuality("low")).toBe(true);
    expect(isValidImageQuality("lol")).toBe(false);
    expect(isValidImageQuality("")).toBe(false);
  });
  it("falls back to 'auto' on garbage", () => {
    localStorage.setItem("antena-image-quality", "ultra-mega-hd");
    expect(readImageQuality()).toBe("auto");
  });
});

// Re-export the type so the unused-import warning doesn't fire on
// the import in production code. (Sanity.)
type _ = FontScale;
