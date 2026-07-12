import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Minimal schema covering entities, entity_mentions, news_cards,
// sources, and locations. The :id/articles and :id/sources
// endpoints join these. CREATE TABLE IF NOT EXISTS makes the
// suite idempotent across describes.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, province TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, url TEXT NOT NULL, is_active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS news_cards (
  id TEXT PRIMARY KEY,
  location_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_id INTEGER,
  source_name TEXT,
  category TEXT,
  bias_score REAL DEFAULT 0,
  is_gacetilla INTEGER DEFAULT 0,
  sources_count INTEGER DEFAULT 1,
  cluster_id TEXT,
  source_url TEXT,
  author TEXT,
  slug TEXT,
  slug_date TEXT,
  published_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS entities (id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, mention_count INTEGER DEFAULT 0, first_seen TEXT, last_seen TEXT);
CREATE TABLE IF NOT EXISTS entity_mentions (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT NOT NULL, entity_id INTEGER NOT NULL, confidence REAL DEFAULT 1.0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`;

async function createSchema() {
  for (const stmt of SCHEMA.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    await env.DB.exec(stmt + ";");
  }
}

async function resetRows() {
  await env.DB.exec("DELETE FROM entity_mentions; DELETE FROM news_cards; DELETE FROM sources; DELETE FROM locations; DELETE FROM entities;");
}

describe("/api/entities/:id/articles", () => {
  beforeAll(async () => {
    await createSchema();
  });

  beforeEach(async () => {
    await resetRows();
    await env.DB.exec("INSERT INTO locations (id, name, province) VALUES (1, 'CABA', 'BA')");
    await env.DB.exec("INSERT INTO sources (id, name, url) VALUES (1, 'La Nación', 'https://lanacion.com.ar'), (2, 'Clarín', 'https://clarin.com')");
    await env.DB.exec("INSERT INTO entities (id, name, type, mention_count) VALUES (42, 'Javier Milei', 'person', 1247)");
    await env.DB.exec(
      "INSERT INTO news_cards (id, location_id, title, summary, source_id, source_name, slug, slug_date, published_at) " +
      "VALUES ('a-1', 1, 'Milei anuncia medidas', 's1', 1, 'La Nación', 'milei-medidas', '2026-07-11', '2026-07-11T10:00:00Z'), " +
      "('a-2', 1, 'Discurso presidencial', 's2', 2, 'Clarín', 'discurso', '2026-07-10', '2026-07-10T10:00:00Z'), " +
      "('a-3', 1, 'Otro sin Milei', 's3', 1, 'La Nación', 'otro', '2026-07-09', '2026-07-09T10:00:00Z')"
    );
    await env.DB.exec(
      "INSERT INTO entity_mentions (card_id, entity_id, confidence) " +
      "VALUES ('a-1', 42, 0.95), ('a-2', 42, 0.80), ('a-3', 42, 0.10)"
    );
  });

  it("returns recent cards mentioning the entity, newest first", async () => {
    const res = await SELF.fetch("http://example.com/api/entities/42/articles?limit=10");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { news: { id: string; source_name: string; title: string }[]; total: number };
    expect(body.total).toBe(3);
    expect(body.news[0].id).toBe("a-1");
    expect(body.news[0].source_name).toBe("La Nación");
    expect(body.news[1].id).toBe("a-2");
    expect(body.news[2].id).toBe("a-3");
  });

  it("respects the limit query param", async () => {
    const res = await SELF.fetch("http://example.com/api/entities/42/articles?limit=1");
    const body = (await res.json()) as { news: unknown[]; total: number };
    expect(body.total).toBe(1);
    expect(body.news.length).toBe(1);
  });

  it("returns empty list for an entity with no mentions", async () => {
    await env.DB.exec("INSERT INTO entities (id, name, type) VALUES (99, 'Otro', 'person')");
    const res = await SELF.fetch("http://example.com/api/entities/99/articles");
    const body = (await res.json()) as { news: unknown[]; total: number };
    expect(body.total).toBe(0);
    expect(body.news).toEqual([]);
  });

  it("returns 400 for invalid id", async () => {
    const res = await SELF.fetch("http://example.com/api/entities/abc/articles");
    expect(res.status).toBe(400);
  });
});

describe("/api/entities/:id/sources", () => {
  beforeAll(async () => {
    await createSchema();
  });

  beforeEach(async () => {
    await resetRows();
    await env.DB.exec("INSERT INTO locations (id, name, province) VALUES (1, 'CABA', 'BA')");
    await env.DB.exec("INSERT INTO sources (id, name, url) VALUES (1, 'La Nación', 'https://lanacion.com.ar'), (2, 'Clarín', 'https://clarin.com')");
    await env.DB.exec("INSERT INTO entities (id, name, type) VALUES (42, 'Javier Milei', 'person')");
    await env.DB.exec(
      "INSERT INTO news_cards (id, location_id, title, summary, source_id, source_name) " +
      "VALUES ('a-1', 1, 'a', 's', 1, 'La Nación'), ('a-2', 1, 'b', 's', 1, 'La Nación'), " +
      "('a-3', 1, 'c', 's', 1, 'La Nación'), ('a-4', 1, 'd', 's', 2, 'Clarín')"
    );
    await env.DB.exec("INSERT INTO entity_mentions (card_id, entity_id) VALUES ('a-1', 42), ('a-2', 42), ('a-3', 42), ('a-4', 42)");
  });

  it("aggregates mentions per source and orders by article_count DESC", async () => {
    const res = await SELF.fetch("http://example.com/api/entities/42/sources");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sources: { id: number; name: string; article_count: number }[] };
    expect(body.sources.length).toBe(2);
    expect(body.sources[0].name).toBe("La Nación");
    expect(body.sources[0].article_count).toBe(3);
    expect(body.sources[1].name).toBe("Clarín");
    expect(body.sources[1].article_count).toBe(1);
  });
});