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
  const stmts = SCHEMA.split(";").map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length > 0);
  for (const stmt of stmts) {
    await env.DB.exec(stmt + ";");
  }
}

describe("/api/news/:id/cluster", () => {
  beforeAll(async () => {
    await createSchema();
    await env.DB.exec("INSERT INTO news_cards (id, location_id, title, summary, cluster_id) VALUES ('a-1', 1, 'A1', 'A1 summary', 'cluster-x'), ('a-2', 1, 'A2', 'A2 summary', 'cluster-x'), ('a-3', 1, 'A3', 'A3 summary', 'cluster-y'), ('b-1', 1, 'B1', 'B1 summary', NULL)");
  });

  it("returns 200 with cluster articles when cluster exists", async () => {
    const res = await SELF.fetch("http://example.com/api/news/a-1/cluster");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cluster_id: string; news: { id: string }[] };
    expect(body.cluster_id).toBe("cluster-x");
    expect(body.news.length).toBe(2);
    expect(body.news.map(n => n.id).sort()).toEqual(["a-1", "a-2"]);
  });

  it("returns 404 when article has no cluster", async () => {
    const res = await SELF.fetch("http://example.com/api/news/b-1/cluster");
    expect(res.status).toBe(404);
  });

  it("returns 404 when article does not exist", async () => {
    const res = await SELF.fetch("http://example.com/api/news/nonexistent/cluster");
    expect(res.status).toBe(404);
  });
});
