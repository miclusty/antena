import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveEntityBySlug } from "../lib/api";

// 404 path: when the slug doesn't resolve to any entity, the
// Astro page never emits a static page (its getStaticPaths
// doesn't include it), so Cloudflare Pages returns 404. The
// resolution helper returns null for these cases; this test
// locks the behavior so future changes to searchEntities() or
// fetchEntityDetail() don't silently swallow unknown slugs.

const apiBase = "https://akira-api.miclusty.workers.dev";

describe("resolveEntityBySlug (404 path)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when /api/entities/search finds nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/entities/search")) {
        return new Response(JSON.stringify({ q: "no-existe", results: [], total: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }));

    const result = await resolveEntityBySlug("no-existe");
    expect(result).toBeNull();
  });

  it("returns null when the matched entity's /api/entities/:id 404s", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/entities/search")) {
        return new Response(JSON.stringify({
          q: "misterioso",
          results: [{ id: 99, name: "Misterioso", type: "person", mention_count: 1 }],
          total: 1,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/entities/99") && !url.includes("/timeline") && !url.includes("/articles") && !url.includes("/sources") && !url.includes("/related")) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      return new Response("{}", { status: 200 });
    }));

    const result = await resolveEntityBySlug("misterioso");
    expect(result).toBeNull();
  });

  it("returns null when slug is empty", async () => {
    const result = await resolveEntityBySlug("");
    expect(result).toBeNull();
  });

  it("returns the resolved entity when search + detail both succeed", async () => {
    const detail = {
      id: 42,
      name: "Javier Milei",
      type: "person",
      mention_count: 1247,
      first_seen: "2023-12-10T12:00:00Z",
      last_seen: "2026-07-11T18:30:00Z",
      related: [{ id: 100, name: "Victoria Villarruel", type: "person", mention_count: 432 }],
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/entities/search")) {
        return new Response(JSON.stringify({
          q: "javier milei",
          results: [{ id: 42, name: "Javier Milei", type: "person", mention_count: 1247 }],
          total: 1,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/entities/42?include=related&related_limit=10")) {
        return new Response(JSON.stringify(detail), { status: 200 });
      }
      if (url.includes("/api/entities/42/timeline")) {
        return new Response(JSON.stringify({ timeline: [] }), { status: 200 });
      }
      if (url.includes("/api/entities/42/articles")) {
        return new Response(JSON.stringify({ news: [] }), { status: 200 });
      }
      if (url.includes("/api/entities/42/sources")) {
        return new Response(JSON.stringify({ sources: [] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }));

    const result = await resolveEntityBySlug("javier-milei");
    expect(result).not.toBeNull();
    expect(result?.entity.name).toBe("Javier Milei");
    expect(result?.entity.related?.length).toBe(1);
  });
});