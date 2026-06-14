import { env, SELF, applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";

const SCHEMA = `
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon TEXT
);
CREATE TABLE clusters (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  master_article_id TEXT
);
CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  province TEXT NOT NULL,
  country TEXT DEFAULT 'AR' NOT NULL,
  lat REAL,
  lng REAL,
  population INTEGER,
  type TEXT DEFAULT 'city' NOT NULL,
  parent_id INTEGER
);
CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  domain TEXT,
  country TEXT DEFAULT 'AR' NOT NULL,
  province TEXT,
  location_id INTEGER,
  type TEXT DEFAULT 'diario' NOT NULL,
  rss_url TEXT,
  wp_api_url TEXT,
  sitemap_url TEXT,
  extraction_method TEXT,
  reliability_score REAL DEFAULT 0.5 NOT NULL,
  bias_score REAL DEFAULT 0 NOT NULL,
  is_active INTEGER DEFAULT 1 NOT NULL,
  deactivation_reason TEXT,
  last_fetch TEXT,
  last_success TEXT,
  last_harvest_at TEXT,
  fetch_count INTEGER DEFAULT 0 NOT NULL,
  error_count INTEGER DEFAULT 0 NOT NULL,
  news_count INTEGER DEFAULT 0 NOT NULL,
  gacetilla_count INTEGER DEFAULT 0 NOT NULL,
  avg_bias REAL
);
CREATE TABLE news_cards (
  id TEXT PRIMARY KEY,
  location_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT,
  image_url TEXT,
  source_url TEXT,
  source_name TEXT,
  source_id INTEGER,
  category TEXT,
  bias_score REAL DEFAULT 0 NOT NULL,
  is_gacetilla INTEGER DEFAULT 0 NOT NULL,
  gacetilla_confidence REAL DEFAULT 0 NOT NULL,
  sources_count INTEGER DEFAULT 1 NOT NULL,
  quality_score REAL,
  source_ids TEXT,
  cluster_id TEXT,
  published_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE source_follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX uniq_follows_device_source ON source_follows (device_id, source_id);
CREATE VIRTUAL TABLE IF NOT EXISTS news_cards_fts USING fts5(
  id, title, summary, content=''
);
`;

async function seed() {
  // D1's exec() takes single statements and parses by line — flatten newlines
  const statements = SCHEMA.split(";").map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length > 0);
  for (const stmt of statements) {
    await env.DB.exec(stmt + ";");
  }
  for (const insertSql of [
    `INSERT INTO categories (id, slug, name, icon) VALUES (1, 'politica', 'Política', 'gavel'), (2, 'economia', 'Economía', 'trending_up')`,
    `INSERT INTO locations (id, name, province, type) VALUES (1, 'Córdoba', 'CBA', 'ciudad'), (2, 'Buenos Aires', 'BA', 'provincia')`,
    `INSERT INTO sources (id, name, url, is_active) VALUES (1, 'La Nación', 'https://lanacion.com.ar', 1), (2, 'Ámbito', 'https://ambito.com', 1)`,
    `INSERT INTO news_cards (id, location_id, title, summary, source_id, source_name, category, bias_score, is_gacetilla, sources_count, cluster_id, published_at) VALUES ('n-1', 1, 'Dólar sube 5%', 'El dolar blue subio 5% hoy', 1, 'La Nación', 'economia', 0.3, 0, 2, 'c-1', '2026-06-10T12:00:00Z'), ('n-2', 1, 'Córdoba elige intendente', 'Elecciones municipales', 1, 'La Nación', 'politica', 0.1, 0, 1, NULL, '2026-06-10T10:00:00Z')`,
    `INSERT INTO source_follows (device_id, source_id) VALUES ('dev-A', 1), ('dev-A', 2)`,
  ]) {
    await env.DB.exec(insertSql);
  }
}

describe("/api/news/feed", () => {
  beforeAll(async () => {
    await seed();
  });

  it("returns 200 with default pagination", async () => {
    const res = await SELF.fetch("http://example.com/api/news/feed");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { news: unknown[]; total: number; page: number; per_page: number };
    expect(Array.isArray(body.news)).toBe(true);
    expect(body.per_page).toBe(20);
    expect(body.page).toBe(1);
  });

  it("respects limit and offset", async () => {
    const res = await SELF.fetch("http://example.com/api/news/feed?limit=1&offset=0");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { news: unknown[]; per_page: number };
    expect(body.per_page).toBe(1);
    expect(body.news).toHaveLength(1);
  });

  it("filters by category", async () => {
    const res = await SELF.fetch("http://example.com/api/news/feed?category=politica");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { news: { category: string }[] };
    expect(body.news.every(n => n.category === "politica")).toBe(true);
  });

  it("returns 400 on invalid limit (> 100)", async () => {
    const res = await SELF.fetch("http://example.com/api/news/feed?limit=200");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid request");
  });

  it("returns 400 on invalid limit (< 1)", async () => {
    const res = await SELF.fetch("http://example.com/api/news/feed?limit=0");
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid category (too long)", async () => {
    const res = await SELF.fetch(`http://example.com/api/news/feed?category=${"x".repeat(60)}`);
    expect(res.status).toBe(400);
  });

  it("accepts location_id as number", async () => {
    const res = await SELF.fetch("http://example.com/api/news/feed?location_id=1");
    expect(res.status).toBe(200);
  });

  it("accepts min_quality filter", async () => {
    const res = await SELF.fetch("http://example.com/api/news/feed?min_quality=0.5");
    expect(res.status).toBe(200);
  });

  it("filters to followed sources when ?following=true & device_id set", async () => {
    // dev-A follows sources 1 and 2 (the two seeded sources).
    // Without ?following=true, both news are returned. With it, the
    // feed is restricted to those sources — which IS all of them,
    // so we filter further by source.
    const res = await SELF.fetch(
      "http://example.com/api/news/feed?following=true&device_id=dev-A"
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { news: { id: string }[]; total: number };
    // Both seeded news come from source_id=1, which dev-A follows.
    expect(body.total).toBe(2);
  });

  it("returns empty when device follows no sources", async () => {
    const res = await SELF.fetch(
      "http://example.com/api/news/feed?following=true&device_id=dev-with-no-follows"
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { news: unknown[]; total: number };
    expect(body.total).toBe(0);
  });

  it("ignores following=true if no device_id provided", async () => {
    // Missing device_id should not 500 — the filter just becomes
    // a no-op and the global feed is returned.
    const res = await SELF.fetch("http://example.com/api/news/feed?following=true");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { news: unknown[]; total: number };
    expect(body.total).toBe(2);
  });

  it("filters by explicit source_ids list", async () => {
    const res = await SELF.fetch("http://example.com/api/news/feed?source_ids=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { news: { id: string }[]; total: number };
    expect(body.total).toBe(2);
    expect(body.news.every((n) => n.id.startsWith("n-"))).toBe(true);
  });

  it("ignores invalid source_ids silently", async () => {
    // Non-numeric values in the list are filtered out by the
    // route. A comma-separated list like "1,abc,0,-5" should be
    // treated as just [1].
    const res = await SELF.fetch("http://example.com/api/news/feed?source_ids=1,abc,0,-5");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { news: unknown[]; total: number };
    expect(body.total).toBe(2);
  });

  // TODO(Phase 8+): workerd's caches.default doesn't preserve Cache-Control
  // header set on the cached Response. Tests for it are skipped here — see
  // packages/api/src/tests/cache.test.ts for the same issue.
  it.skip("returns Cache-Control header on success", async () => {
    const res = await SELF.fetch("http://example.com/api/news/feed");
    expect(res.status).toBe(200);
    const cc = res.headers.get("Cache-Control");
    expect(cc).toMatch(/public/);
    expect(cc).toMatch(/max-age=/);
  });
});
