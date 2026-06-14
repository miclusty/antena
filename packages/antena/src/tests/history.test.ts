import { describe, it, expect, beforeEach } from "vitest";
import { readHistory, writeHistory, pushHistoryEntry, type HistoryEntry } from "../lib/history";

const SAMPLE: HistoryEntry = {
  id: "n-1",
  title: "Title 1",
  summary: "S1",
  source: "Source 1",
  category: "Política",
  imageUrl: "https://x/y.jpg",
  publishedAt: "2026-06-14T10:00:00Z",
  viewedAt: 1718356800000,
};

beforeEach(() => {
  localStorage.clear();
});

describe("readHistory / writeHistory", () => {
  it("returns empty when nothing is stored", () => {
    expect(readHistory()).toEqual([]);
  });

  it("round-trips a list", () => {
    const items: HistoryEntry[] = [SAMPLE, { ...SAMPLE, id: "n-2", viewedAt: 1718356801000 }];
    writeHistory(items);
    expect(readHistory()).toEqual(items);
  });

  it("handles garbage gracefully", () => {
    localStorage.setItem("antena-history", "not-json");
    expect(readHistory()).toEqual([]);
  });

  it("filters out malformed entries (defensive)", () => {
    localStorage.setItem(
      "antena-history",
      JSON.stringify([
        SAMPLE,
        { id: "broken" /* missing fields */ },
        null,
        42,
        { ...SAMPLE, id: "n-3" },
      ])
    );
    const list = readHistory();
    expect(list.length).toBe(2);
    expect(list.map((x) => x.id)).toEqual(["n-1", "n-3"]);
  });
});

describe("pushHistoryEntry", () => {
  it("adds to the top of the list", () => {
    pushHistoryEntry({ ...SAMPLE, id: "n-1" });
    pushHistoryEntry({ ...SAMPLE, id: "n-2" });
    const list = readHistory();
    expect(list[0].id).toBe("n-2");
    expect(list[1].id).toBe("n-1");
  });

  it("dedupes by id (re-viewing moves to top)", () => {
    pushHistoryEntry({ ...SAMPLE, id: "n-1", viewedAt: 1000 });
    pushHistoryEntry({ ...SAMPLE, id: "n-2", viewedAt: 2000 });
    pushHistoryEntry({ ...SAMPLE, id: "n-1", viewedAt: 3000 });
    const list = readHistory();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe("n-1");
    expect(list[0].viewedAt).toBe(3000);
  });

  it("caps at 50 entries (FIFO drop)", () => {
    for (let i = 0; i < 55; i++) {
      pushHistoryEntry({ ...SAMPLE, id: `n-${i}`, viewedAt: 1000 + i });
    }
    const list = readHistory();
    expect(list.length).toBe(50);
    expect(list[0].id).toBe("n-54");
    expect(list[49].id).toBe("n-5");
  });

  it("ignores entries with missing required fields", () => {
    // Cast to bypass type checking for the test.
    pushHistoryEntry({ ...SAMPLE, id: "" /* invalid */ });
    expect(readHistory()).toEqual([]);
  });
});
