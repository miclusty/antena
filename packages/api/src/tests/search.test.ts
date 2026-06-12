import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const SCHEMA = `
CREATE TABLE news_cards (id TEXT PRIMARY KEY, location_id INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT, image_url TEXT, source_name TEXT, category TEXT, published_at TEXT, source_id INTEGER, source_ids TEXT, bias_score REAL DEFAULT 0, is_gacetilla INTEGER DEFAULT 0, sources_count INTEGER DEFAULT 1, quality_score REAL, cluster_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE VIRTUAL TABLE IF NOT EXISTS news_cards_fts USING fts5(id, title, summary, image_url, source_name, category, published_at, content='')
`;

async function createSchema() {
  // D1's exec() parses by line — flatten multi-line CREATE TABLE
  const stmts = SCHEMA.split(";").map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length > 0);
  for (const stmt of stmts) {
    await env.DB.exec(stmt + ";");
  }
}

beforeEach(async () => {
  // D1 doesn't have a truncate-all; recreate the table for each test
  await env.DB.exec("DROP TABLE IF EXISTS news_cards");
  await createSchema();
});

describe("/api/search", () => {
  beforeAll(() => {});

  it("returns 200 with empty results when no match", async () => {
    await env.DB.exec("INSERT INTO news_cards (id, location_id, title, summary) VALUES ('a-1', 1, 'X', 'X summary')");
    const res = await SELF.fetch("http://example.com/api/search?q=zzznomatchzzz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { q: string; results: unknown[]; total: number };
    expect(body.q).toBe("zzznomatchzzz");
    expect(body.total).toBe(0);
    expect(body.results).toEqual([]);
  });

  it("returns 200 with FTS5 matches when query matches title", async () => {
    await env.DB.exec("INSERT INTO news_cards (id, location_id, title, summary) VALUES ('a-1', 1, 'Dolar sube', 'El dolar blue subio 5%')");
    // The FTS5 table is standalone (content='') so we also need to populate it
    await env.DB.exec("INSERT INTO news_cards_fts (id, title, summary) VALUES ('a-1', 'Dolar sube', 'El dolar blue subio 5%')");
    const res = await SELF.fetch("http://example.com/api/search?q=dolar");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { id: string }[]; total: number };
    expect(body.total).toBeGreaterThan(0);
  });

  it("returns 400 when q is empty", async () => {
    const res = await SELF.fetch("http://example.com/api/search?q=");
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is over 200 chars", async () => {
    const res = await SELF.fetch(`http://example.com/api/search?q=${"x".repeat(201)}`);
    expect(res.status).toBe(400);
  });

  it("returns 400 when limit is > 50", async () => {
    const res = await SELF.fetch("http://example.com/api/search?q=dolar&limit=100");
    expect(res.status).toBe(400);
  });

  it("returns 400 when limit is < 1", async () => {
    const res = await SELF.fetch("http://example.com/api/search?q=dolar&limit=0");
    expect(res.status).toBe(400);
  });

  it("returns 200 for valid params", async () => {
    const res = await SELF.fetch("http://example.com/api/search?q=dolar&limit=5");
    expect(res.status).toBe(200);
  });

  // TODO(Phase 8+): VECTORS (Vectorize) binding isn't available in miniflare 3.
  // Vitest-pool-workers 0.5 ships with miniflare 3; Analytics Engine + Vectorize
  // need miniflare 4 (vitest-pool-workers 1.0+). The handler in
  // packages/api/src/routes/search.ts already catches Vectorize errors
  // gracefully, so the route is integration-tested via the FTS5 path.
  it.skip("handles Vectorize query gracefully (returns vectorResults as array)", async () => {
    const res = await SELF.fetch("http://example.com/api/search?q=dolar&limit=5");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vectorResults?: unknown };
    expect(body).toHaveProperty("vectorResults");
  });
});
