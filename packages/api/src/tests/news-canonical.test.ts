import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const SCHEMA = `
CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, icon TEXT);
CREATE TABLE clusters (id TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, master_article_id TEXT);
CREATE TABLE locations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, province TEXT NOT NULL, country TEXT DEFAULT 'AR' NOT NULL, lat REAL, lng REAL, population INTEGER, type TEXT DEFAULT 'city' NOT NULL, parent_id INTEGER);
CREATE TABLE sources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL, location_id INTEGER, is_active INTEGER DEFAULT 1);
CREATE TABLE news_cards (id TEXT PRIMARY KEY, location_id INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT, image_url TEXT, source_id INTEGER, source_name TEXT, category TEXT, bias_score REAL DEFAULT 0, is_gacetilla INTEGER DEFAULT 0, sources_count INTEGER DEFAULT 1, quality_score REAL, source_ids TEXT, cluster_id TEXT, source_url TEXT, author TEXT, slug TEXT, slug_date TEXT, published_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)
`;

async function createSchema() {
  const stmts = SCHEMA.split(";").map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length > 0);
  for (const stmt of stmts) {
    await env.DB.exec(stmt + ";");
  }
}

describe("/api/news/:year/:month/:day/:slug", () => {
  beforeAll(async () => {
    await createSchema();
    await env.DB.exec("INSERT INTO locations (id, name, province) VALUES (1, 'Córdoba', 'CBA'), (2, 'Buenos Aires', 'BA')");
    await env.DB.exec("INSERT INTO sources (id, name, url, is_active) VALUES (1, 'La Nación', 'https://lanacion.com.ar', 1)");
    await env.DB.exec(
      "INSERT INTO news_cards (id, location_id, title, summary, source_id, source_name, category, cluster_id, slug, slug_date, published_at) " +
      "VALUES ('abc-123', 1, 'Córdoba elige intendente 2026', 'Elecciones municipales', 1, 'La Nación', 'politica', 'c-1', 'cordoba-elige-intendente-2026', '2026-06-10', '2026-06-10T12:00:00Z')",
    );
  });

  it("returns 200 with location_name from JOIN (regression: bug was querying non-existent column)", async () => {
    const res = await SELF.fetch("http://example.com/api/news/2026/06/10/cordoba-elige-intendente-2026");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { news: { id: string; location_name: string; location_province: string } };
    expect(body.news.id).toBe("abc-123");
    expect(body.news.location_name).toBe("Córdoba");
    expect(body.news.location_province).toBe("CBA");
  });

  it("returns 404 for unknown slug", async () => {
    const res = await SELF.fetch("http://example.com/api/news/2026/06/10/no-existe");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid slug format", async () => {
    const res = await SELF.fetch("http://example.com/api/news/2026/06/10/INVALID_SLUG");
    expect(res.status).toBe(400);
  });
});

describe("/api/llm/cite", () => {
  beforeAll(async () => {
    await createSchema();
    await env.DB.exec("INSERT INTO locations (id, name, province) VALUES (1, 'Córdoba', 'CBA'), (2, 'Buenos Aires', 'BA')");
    await env.DB.exec("INSERT INTO sources (id, name, url, is_active) VALUES (1, 'La Nación', 'https://lanacion.com.ar', 1)");
    await env.DB.exec(
      "INSERT INTO news_cards (id, location_id, title, summary, source_id, source_name, category, cluster_id, slug, slug_date, published_at) " +
      "VALUES ('abc-123', 1, 'Córdoba elige intendente 2026', 'Elecciones municipales', 1, 'La Nación', 'politica', 'c-1', 'cordoba-elige-intendente-2026', '2026-06-10', '2026-06-10T12:00:00Z')",
    );
  });

  it("returns 200 with location_name from JOIN", async () => {
    const res = await SELF.fetch("http://example.com/api/llm/cite?id=abc-123");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; location: string; canonical_url: string };
    expect(body.id).toBe("abc-123");
    expect(body.location).toBe("Córdoba");
    expect(body.canonical_url).toContain("https://www.antena.com.ar/2026/06/10/cordoba-elige-intendente-2026");
  });

  it("uses stored slug (not title-derived) in canonical_url — regression: bug was SELECT without slug col", async () => {
    // Insert a card whose title would produce a DIFFERENT slug than the stored one
    await env.DB.exec(
      "INSERT INTO news_cards (id, location_id, title, summary, source_id, source_name, category, cluster_id, slug, slug_date, published_at) " +
      "VALUES ('def-456', 1, 'Córdoba: elecciones 2026', 'Resumen', 1, 'La Nación', 'politica', 'c-2', 'custom-stored-slug', '2026-06-12', '2026-06-12T10:00:00Z')",
    );
    const res = await SELF.fetch("http://example.com/api/llm/cite?id=def-456");
    const body = (await res.json()) as { canonical_url: string };
    // canonical_url should use the STORED slug 'custom-stored-slug',
    // not a title-derived one like 'cordoba-elecciones-2026'.
    expect(body.canonical_url).toContain("/2026/06/12/custom-stored-slug");
    expect(body.canonical_url).not.toContain("cordoba-elecciones");
  });

  it("returns 400 when id is missing", async () => {
    const res = await SELF.fetch("http://example.com/api/llm/cite");
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown id", async () => {
    const res = await SELF.fetch("http://example.com/api/llm/cite?id=nope");
    expect(res.status).toBe(404);
  });
});
