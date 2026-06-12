import { describe, it, expect } from "vitest";
import {
  feedQueryKey,
  articleQueryKey,
  clusterQueryKey,
  locationsQueryKey,
  categoriesQueryKey,
  searchQueryKey,
  statsQueryKey,
  bookmarksQueryKey,
} from "../lib/cache";

describe("query keys", () => {
  it("feedQueryKey is a tuple [feed, params]", () => {
    const key = feedQueryKey({ category: "politica", limit: 20 });
    expect(key[0]).toBe("feed");
    expect(key[1]).toEqual({ category: "politica", limit: 20 });
  });

  it("feedQueryKey is deterministic for the same params", () => {
    const a = feedQueryKey({ category: "x", limit: 20 });
    const b = feedQueryKey({ category: "x", limit: 20 });
    expect(a).toEqual(b);
  });

  it("feedQueryKey differs for different params", () => {
    const a = feedQueryKey({ category: "x" });
    const b = feedQueryKey({ category: "y" });
    expect(a).not.toEqual(b);
  });

  it("articleQueryKey wraps the id", () => {
    expect(articleQueryKey("abc-123")).toEqual(["article", "abc-123"]);
  });

  it("clusterQueryKey wraps the id", () => {
    expect(clusterQueryKey("cluster-1")).toEqual(["cluster", "cluster-1"]);
  });

  it("locationsQueryKey returns constant", () => {
    expect(locationsQueryKey()).toEqual(["locations"]);
  });

  it("categoriesQueryKey returns constant", () => {
    expect(categoriesQueryKey()).toEqual(["categories"]);
  });

  it("statsQueryKey returns constant", () => {
    expect(statsQueryKey()).toEqual(["stats"]);
  });

  it("bookmarksQueryKey returns constant", () => {
    expect(bookmarksQueryKey()).toEqual(["bookmarks"]);
  });

  it("searchQueryKey includes q and limit", () => {
    const key = searchQueryKey("hello", 20);
    expect(key[0]).toBe("search");
    expect(key[1]).toEqual({ q: "hello", limit: 20 });
  });

  it("searchQueryKey defaults limit to 20", () => {
    const key = searchQueryKey("hello");
    expect(key[1]).toEqual({ q: "hello", limit: 20 });
  });

  it("searchQueryKey is deterministic for same args", () => {
    expect(searchQueryKey("foo", 10)).toEqual(searchQueryKey("foo", 10));
    expect(searchQueryKey("foo")).toEqual(searchQueryKey("foo", 20));
  });

  it("all query keys are tuples (array shape)", () => {
    const keys = [
      feedQueryKey({}),
      articleQueryKey("x"),
      clusterQueryKey("x"),
      locationsQueryKey(),
      categoriesQueryKey(),
      searchQueryKey("x"),
      statsQueryKey(),
      bookmarksQueryKey(),
    ];
    keys.forEach((k) => expect(Array.isArray(k)).toBe(true));
  });
});
