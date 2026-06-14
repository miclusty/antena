import { describe, it, expect, beforeEach } from "vitest";
import {
  readSavedSearches,
  writeSavedSearches,
  pushSavedSearch,
  removeSavedSearch,
  type SavedSearch,
} from "../lib/saved-searches";

beforeEach(() => {
  localStorage.clear();
});

describe("saved searches", () => {
  it("returns empty list when nothing is stored", () => {
    expect(readSavedSearches()).toEqual([]);
  });

  it("round-trips a list", () => {
    const items: SavedSearch[] = [
      { q: "milei", filters: { time: "today" }, savedAt: "2026-06-14T12:00:00Z" },
      { q: "dólar", filters: {}, savedAt: "2026-06-14T11:00:00Z" },
    ];
    writeSavedSearches(items);
    expect(readSavedSearches()).toEqual(items);
  });

  it("pushSavedSearch adds to top, dedups by q+filters, caps at 10", () => {
    const base = { filters: {} as SavedSearch["filters"] };
    pushSavedSearch({ ...base, q: "a", savedAt: "2026-06-14T01:00:00Z" });
    pushSavedSearch({ ...base, q: "b", savedAt: "2026-06-14T02:00:00Z" });
    pushSavedSearch({ ...base, q: "a", savedAt: "2026-06-14T03:00:00Z" }); // re-push, goes to top
    const list = readSavedSearches();
    expect(list[0].q).toBe("a");
    expect(list[0].savedAt).toBe("2026-06-14T03:00:00Z");
    expect(list.length).toBe(2);
  });

  it("pushSavedSearch treats different filters as different entries", () => {
    pushSavedSearch({ q: "milei", filters: { time: "today" }, savedAt: "2026-06-14T01:00:00Z" });
    pushSavedSearch({ q: "milei", filters: { time: "week" }, savedAt: "2026-06-14T02:00:00Z" });
    expect(readSavedSearches().length).toBe(2);
  });

  it("pushSavedSearch caps at 10 entries (FIFO drop)", () => {
    for (let i = 0; i < 12; i++) {
      pushSavedSearch({ q: `q${i}`, filters: {}, savedAt: `2026-06-14T${String(i).padStart(2, "0")}:00:00Z` });
    }
    const list = readSavedSearches();
    expect(list.length).toBe(10);
    // Most recent first; oldest dropped
    expect(list[0].q).toBe("q11");
    expect(list[9].q).toBe("q2");
  });

  it("removeSavedSearch removes by q+filters pair", () => {
    pushSavedSearch({ q: "a", filters: {}, savedAt: "2026-06-14T01:00:00Z" });
    pushSavedSearch({ q: "b", filters: {}, savedAt: "2026-06-14T02:00:00Z" });
    removeSavedSearch({ q: "a", filters: {} });
    const list = readSavedSearches();
    expect(list.length).toBe(1);
    expect(list[0].q).toBe("b");
  });

  it("removeSavedSearch is a no-op if not present", () => {
    pushSavedSearch({ q: "a", filters: {}, savedAt: "2026-06-14T01:00:00Z" });
    removeSavedSearch({ q: "z", filters: {} });
    expect(readSavedSearches().length).toBe(1);
  });

  it("handles garbage in localStorage gracefully", () => {
    localStorage.setItem("antena-saved-searches", "not-json");
    expect(readSavedSearches()).toEqual([]);
  });

  it("filters out items with missing required fields (defensive)", () => {
    localStorage.setItem(
      "antena-saved-searches",
      JSON.stringify([
        { q: "good", filters: {}, savedAt: "2026-06-14T01:00:00Z" },
        { q: "no-filters" /* missing fields */ },
        "not-an-object",
        null,
      ])
    );
    const list = readSavedSearches();
    expect(list.length).toBe(1);
    expect(list[0].q).toBe("good");
  });
});
