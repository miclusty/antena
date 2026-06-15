import type { Env } from "../lib/types";
import { runSeoHealthCheck } from "../lib/seo-monitor";

export async function handleRefreshCron(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  const updated = await env.DB.prepare(
    "SELECT id, title, summary FROM news_cards WHERE updated_at > ? OR updated_at IS NULL LIMIT 500"
  )
    .bind(cutoff)
    .all<{ id: string; title: string; summary: string | null }>();

  const rows = updated.results ?? [];
  const vectors = rows.map((n) => ({
    id: n.id,
    values: new Array(384).fill(0).map(() => Math.random() * 0.01),
    metadata: { title: n.title, summary: n.summary?.slice(0, 200) ?? "" },
  }));

  if (vectors.length > 0) {
    await env.VECTORS.upsert(vectors);
  }

  env.ANALYTICS.writeDataPoint({
    blobs: ["cron", "refresh", String(vectors.length)],
    doubles: [Date.now()],
    indexes: ["cron-refresh"],
  });

  // SEO health check piggybacks on the same scheduled tick.
  // Writes a row per check to the same Analytics Engine dataset
  // (so a dashboard can graph pass/fail over time) and posts
  // to Discord on any failure.
  const seo = await runSeoHealthCheck(env);
  console.log(`[cron:refresh] seo-monitor ${seo.ok}/${seo.ok + seo.fail} passed`);
}
