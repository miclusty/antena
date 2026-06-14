import { describe, it, expect, beforeEach } from "vitest";
import {
  readReadingModeDefault,
  writeReadingModeDefault,
} from "../lib/preferences";

beforeEach(() => {
  localStorage.clear();
});

describe("reading mode default preference", () => {
  it("defaults to false (off)", () => {
    expect(readReadingModeDefault()).toBe(false);
  });

  it("round-trips true", () => {
    writeReadingModeDefault(true);
    expect(readReadingModeDefault()).toBe(true);
  });

  it("round-trips false", () => {
    writeReadingModeDefault(false);
    expect(readReadingModeDefault()).toBe(false);
  });

  it("rejects garbage stored values", () => {
    localStorage.setItem("antena-reading-mode-default", "yes");
    expect(readReadingModeDefault()).toBe(false);
  });
});
