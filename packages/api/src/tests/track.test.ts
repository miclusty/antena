import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";

// TODO(Phase 8+): Analytics Engine binding isn't available in miniflare 3.
// Vitest-pool-workers 0.5 ships with miniflare 3; Analytics Engine needs
// miniflare 4 (vitest-pool-workers 1.0+). The validation paths are covered
// by the 400-status tests below; the 200-status tests are skipped.

describe("/api/track", () => {
  it("returns 400 for invalid type", async () => {
    const res = await SELF.fetch("http://example.com/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "invalid_type" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing body", async () => {
    const res = await SELF.fetch("http://example.com/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid dwellTime (> 86400)", async () => {
    const res = await SELF.fetch("http://example.com/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "card_view", dwellTime: 100000 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid scrollDepth (> 1)", async () => {
    const res = await SELF.fetch("http://example.com/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "card_view", scrollDepth: 1.5 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for negative scrollDepth", async () => {
    const res = await SELF.fetch("http://example.com/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "card_view", scrollDepth: -0.1 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for negative dwellTime", async () => {
    const res = await SELF.fetch("http://example.com/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "card_view", dwellTime: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for newsId over 128 chars", async () => {
    const res = await SELF.fetch("http://example.com/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "card_view", newsId: "x".repeat(129) }),
    });
    expect(res.status).toBe(400);
  });

  it.skip("returns 200 for valid event (Analytics Engine not in miniflare 3)", async () => {
    const res = await SELF.fetch("http://example.com/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "card_view",
        newsId: "abc-123",
        category: "politica",
        source: "La Nación",
        dwellTime: 5,
        scrollDepth: 0.5,
      }),
    });
    expect(res.status).toBe(200);
  });

  it.skip("accepts minimal payload (just type)", async () => {
    const res = await SELF.fetch("http://example.com/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "bookmark" }),
    });
    expect(res.status).toBe(200);
  });
});
