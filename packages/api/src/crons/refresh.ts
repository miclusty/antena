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

interface DumpCard {
  id: string;
  location_id?: number;
  title?: string;
  summary?: string;
  body?: string | null;
  image_url?: string | null;
  source_url?: string | null;
  source_name?: string | null;
  source_id?: number | null;
  category?: string | null;
  bias_score?: number;
  is_gacetilla?: number | boolean;
  gacetilla_confidence?: number;
  sources_count?: number;
  quality_score?: number | null;
  cluster_id?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  slug?: string | null;
  slug_date?: string | null;
}

async function syncFromAkira(env: Env, ctx: ExecutionContext): Promise<number> {
  const akiraUrl = env.AKIRA_URL;
  if (!akiraUrl) {
    console.log("[refresh] AKIRA_URL not set; skipping AKIRA sync");
    return 0;
  }
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const url = `${akiraUrl}/api/admin/dump?since=${encodeURIComponent(cutoff)}&limit=500`;
  const adminKey = env.AKIRA_ADMIN_KEY ?? "";
  const dumpRes = await fetch(url, {
    headers: { "X-Admin-Key": adminKey },
  });
  if (!dumpRes.ok) {
    throw new Error(`AKIRA dump failed: HTTP ${dumpRes.status}`);
  }
  const { news } = (await dumpRes.json()) as { news: DumpCard[] };
  if (!news?.length) return 0;

  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO news_cards (
      id, location_id, title, summary, body, image_url, source_url, source_name,
      source_id, category, bias_score, is_gacetilla, gacetilla_confidence,
      sources_count, quality_score, cluster_id, published_at, created_at, slug, slug_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let count = 0;
  for (const card of news) {
    try {
      await stmt
        .bind(
          card.id,
          card.location_id ?? 0,
          card.title ?? "",
          card.summary ?? "",
          card.body ?? null,
          card.image_url ?? null,
          card.source_url ?? null,
          card.source_name ?? null,
          card.source_id ?? null,
          card.category ?? null,
          card.bias_score ?? 0,
          card.is_gacetilla ? 1 : 0,
          card.gacetilla_confidence ?? 0,
          card.sources_count ?? 1,
          card.quality_score ?? null,
          card.cluster_id ?? null,
          card.published_at ?? null,
          card.created_at ?? new Date().toISOString(),
          card.slug ?? null,
          card.slug_date ?? null,
        )
        .run();
      count++;
    } catch (e) {
      console.warn(`[refresh] insert failed for ${card.id}:`, e);
    }
  }
  ctx.waitUntil(Promise.resolve()); // ensure ctx used
  return count;
}

export async function handleRefreshCron(env: Env, ctx: ExecutionContext): Promise<void> {
  try {
    // Step 1: sync fresh data from AKIRA
    let syncedFromAkira = 0;
    try {
      syncedFromAkira = await syncFromAkira(env, ctx);
      console.log(`[refresh] synced ${syncedFromAkira} cards from AKIRA`);
    } catch (e) {
      console.error("[refresh] AKIRA sync failed:", e);
      await discordAlert(env, ctx, `AKIRA sync failed: ${(e as Error).message ?? String(e)}`);
    }

    // Step 2: re-embed recent cards via Workers AI + Vectorize
    const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    const updated = await env.DB.prepare(
      "SELECT id, title, summary FROM news_cards WHERE created_at > ? ORDER BY created_at DESC LIMIT 500"
    )
      .bind(cutoff)
      .all<{ id: string; title: string; summary: string | null }>();

    const rows = updated.results ?? [];

    const vectors: Array<{ id: string; values: number[]; metadata: { title: string; summary: string } }> = [];
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

    if (env.ANALYTICS) {
      env.ANALYTICS.writeDataPoint({
        blobs: [
          "cron",
          "refresh",
          String(syncedFromAkira),
          String(vectors.length),
          String(rows.length),
        ],
        doubles: [Date.now()],
        indexes: ["cron-refresh"],
      });
    }

    const seo = await runSeoHealthCheck(env);
    console.log(`[cron:refresh] seo-monitor ${seo.ok}/${seo.ok + seo.fail} passed`);
  } catch (e) {
    console.error("[refresh] cron failed:", e);
    await discordAlert(env, ctx, `cron failed: ${(e as Error).message ?? String(e)}`);
    throw e;
  }
}
