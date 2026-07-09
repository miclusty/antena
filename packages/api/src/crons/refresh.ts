import type { Env } from "../lib/types";
import { runSeoHealthCheck } from "../lib/seo-monitor";

async function discordAlert(env: Env, ctx: ExecutionContext, msg: string): Promise<void> {
  const url = env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  ctx.waitUntil(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `**[Antena refresh] ${msg}**` }),
    }).catch((e) => console.error("[refresh] Discord webhook failed:", e))
  );
}

export async function handleRefreshCron(env: Env, ctx: ExecutionContext): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    const updated = await env.DB.prepare(
      "SELECT id, title, summary FROM news_cards WHERE created_at > ? ORDER BY created_at DESC LIMIT 500"
    )
      .bind(cutoff)
      .all<{ id: string; title: string; summary: string | null }>();

    const rows = updated.results ?? [];

    let vectors: Array<{ id: string; values: number[]; metadata: { title: string; summary: string } }> = [];
    if (env.AI) {
      for (const n of rows) {
        const text = `${n.title} ${n.summary ?? ""}`.trim().slice(0, 1000);
        try {
          const embeddingResponse = (await env.AI.run(
            "@cf/baai/bge-small-en-v1.5",
            { text }
          )) as { data: number[][] };
          const values = embeddingResponse.data?.[0];
          if (values && values.length > 0) {
            vectors.push({
              id: n.id,
              values,
              metadata: { title: n.title, summary: n.summary?.slice(0, 200) ?? "" },
            });
          }
        } catch (e) {
          console.warn(`[refresh] Workers AI embedding failed for ${n.id}:`, e);
        }
      }
    } else {
      console.warn("[refresh] env.AI not bound; skipping Vectorize upsert");
    }

    if (vectors.length > 0) {
      await env.VECTORS.upsert(vectors);
    }

    env.ANALYTICS.writeDataPoint({
      blobs: ["cron", "refresh", String(vectors.length), String(rows.length)],
      doubles: [Date.now()],
      indexes: ["cron-refresh"],
    });

    const seo = await runSeoHealthCheck(env);
    console.log(`[cron:refresh] seo-monitor ${seo.ok}/${seo.ok + seo.fail} passed`);
  } catch (e) {
    console.error("[refresh] cron failed:", e);
    await discordAlert(env, ctx, `cron failed: ${(e as Error).message ?? String(e)}`);
    throw e;
  }
}
