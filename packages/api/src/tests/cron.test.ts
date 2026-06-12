import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

// TODO(Phase 8+): VECTORS (Vectorize) and Analytics Engine bindings aren't
// available in miniflare 3. Vitest-pool-workers 0.5 ships with miniflare 3;
// these bindings need miniflare 4 (vitest-pool-workers 1.0+). The cron
// handler in packages/api/src/crons/refresh.ts exercises both bindings;
// end-to-end verification needs a real Cloudflare Workers environment.

const SCHEMA = `
CREATE TABLE news_cards (id TEXT PRIMARY KEY, location_id INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)
`;

beforeEach(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS news_cards");
  const stmts = SCHEMA.split(";").map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length > 0);
  for (const stmt of stmts) {
    await env.DB.exec(stmt + ";");
  }
  await env.DB.exec("INSERT INTO news_cards (id, location_id, title, summary) VALUES ('1', 1, 'A', 'a'), ('2', 1, 'B', 'b')");
});

describe("Cron refresh handler", () => {
  it.skip("upserts vectors for recent news cards (Vectorize not in miniflare 3)", async () => {
    const res = await SELF.fetch("http://example.com/api/admin/refresh", { method: "POST" });
    expect([200, 202, 204]).toContain(res.status);
  });

  it.skip("writes Analytics cron event (Analytics Engine not in miniflare 3)", async () => {
    await SELF.fetch("http://example.com/api/admin/refresh", { method: "POST" });
  });

  it("DB query in cron handler returns 2 rows when called", async () => {
    // Direct test of the underlying query (without the cron wrapper)
    const result = await env.DB.prepare("SELECT id, title, summary FROM news_cards WHERE updated_at > ? OR updated_at IS NULL LIMIT 500")
      .bind(new Date(Date.now() - 24 * 3600 * 1000).toISOString())
      .all<{ id: string; title: string; summary: string | null }>();
    expect(result.results).toBeDefined();
    expect(result.results!.length).toBe(2);
  });
});
