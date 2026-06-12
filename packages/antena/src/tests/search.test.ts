import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchNews, parseSearchQuery, searchQuerySchema } from "../lib/search";

describe("searchNews", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches /api/search with q and limit", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ q: "test", results: [], total: 0 }),
    });

    await searchNews("test", 20);

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/search?q=test&limit=20");
  });

  it("defaults limit to 20", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ q: "test", results: [], total: 0 }),
    });

    await searchNews("test");

    expect(globalThis.fetch).toHaveBeenCalledWith("/api/search?q=test&limit=20");
  });

  it("returns parsed JSON on success", async () => {
    const mockResponse = {
      q: "test",
      results: [{ id: "1", title: "X", summary: "Y" }],
      total: 1,
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const result = await searchNews("test");
    expect(result).toEqual(mockResponse);
  });

  it("encodes query in URL", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ q: "a b", results: [], total: 0 }),
    });

    await searchNews("a b");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/search?q=a+b&limit=20");
  });

  it("throws on non-ok response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({}),
    });

    await expect(searchNews("test")).rejects.toThrow("Search failed: 500");
  });
});

describe("searchQuerySchema", () => {
  it("accepts valid query", () => {
    const r = searchQuerySchema.parse({ q: "test" });
    expect(r.q).toBe("test");
    expect(r.limit).toBe(20);
  });

  it("rejects empty query", () => {
    expect(() => searchQuerySchema.parse({ q: "" })).toThrow();
  });

  it("rejects query over 200 chars", () => {
    expect(() => searchQuerySchema.parse({ q: "x".repeat(201) })).toThrow();
  });

  it("clamps limit to max 50", () => {
    expect(() => searchQuerySchema.parse({ q: "x", limit: 100 })).toThrow();
  });

  it("rejects limit below 1", () => {
    expect(() => searchQuerySchema.parse({ q: "x", limit: 0 })).toThrow();
  });

  it("coerces string limit to number", () => {
    const r = searchQuerySchema.parse({ q: "x", limit: "15" });
    expect(r.limit).toBe(15);
  });
});

describe("parseSearchQuery", () => {
  it("returns parsed object on valid input", () => {
    const r = parseSearchQuery({ q: "test" });
    expect(r.q).toBe("test");
  });

  it("throws on invalid input", () => {
    expect(() => parseSearchQuery({ q: "" })).toThrow();
  });
});
