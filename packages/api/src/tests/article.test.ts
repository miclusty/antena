import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const SCHEMA = `
CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, icon TEXT);
CREATE TABLE clusters (id TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, master_article_id TEXT);
CREATE TABLE locations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, province TEXT NOT NULL, country TEXT DEFAULT 'AR' NOT NULL, lat REAL, lng REAL, population INTEGER, type TEXT DEFAULT 'city' NOT NULL, parent_id INTEGER);
CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL);
CREATE TABLE news_cards (id TEXT PRIMARY KEY, location_id INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT, image_url TEXT, source_id INTEGER, source_name TEXT, category TEXT, bias_score REAL DEFAULT 0, is_gacetilla INTEGER DEFAULT 0, sources_count INTEGER DEFAULT 1, quality_score REAL, source_ids TEXT, cluster_id TEXT, published_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)
`;

async function createSchema() {
  // D1's exec() parses by line — flatten multi-line CREATE TABLE
  const stmts = SCHEMA.split(";").map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length > 0);
  for (const stmt of stmts) {
    await env.DB.exec(stmt + ";");
  }
}

describe("/api/news/:id", () => {
  beforeAll(async () => {
    await createSchema();
    await env.DB.exec("INSERT INTO news_cards (id, location_id, title, summary, cluster_id) VALUES ('abc-123', 1, 'Title here', 'Summary here', 'c-1')");
  });

  it("returns 200 for existing id", async () => {
    const res = await SELF.fetch("http://example.com/api/news/abc-123");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; title: string };
    expect(body.id).toBe("abc-123");
    expect(body.title).toBe("Title here");
  });

  it("returns 404 for missing id", async () => {
    const res = await SELF.fetch("http://example.com/api/news/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Not found");
  });

  it("returns 400/404/401 for empty id path", async () => {
    const res = await SELF.fetch("http://example.com/api/news/");
    // 401 from CORS middleware is also acceptable for this edge case
    expect([400, 401, 404]).toContain(res.status);
  });
});
