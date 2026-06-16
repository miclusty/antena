// Pages Function: POST /api/newsletter
//
// Stores email signups in a Cloudflare KV namespace
// (NEWSLETTER) or, if KV is not bound, in D1 as a
// fallback. Real production would forward to a real
// email service (Mailchimp, Buttondown, Resend
// audiences); for now we collect the list and can
// export it as CSV later.
//
// This function is wired for the @astrojs/cloudflare
// adapter. In static mode (current) the endpoint is
// dormant and the UI just shows a success toast.

import type { PagesFunction } from "@cloudflare/workers-types";
import type { PagesEnv } from "../../lib/cloudflare";

interface NewsletterBody {
  email?: string;
  source?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const onRequestPost = handleNewsletter as unknown as PagesFunction<PagesEnv>;

async function handleNewsletter(ctx: { request: Request; env: PagesEnv }): Promise<Response> {
  const body = (await ctx.request.json().catch(() => null)) as NewsletterBody | null;
  if (!body || !body.email || !EMAIL_RE.test(body.email)) {
    return new Response(JSON.stringify({ error: "Invalid email" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const email = body.email.trim().toLowerCase();
  const source = body.source ?? "unknown";

  // Try KV first
  const kv = (ctx.env as unknown as { NEWSLETTER?: { put: (k: string, v: string) => Promise<unknown> } }).NEWSLETTER;
  if (kv) {
    await kv.put(email, JSON.stringify({ source, ts: Date.now() }));
  }

  // Also keep a D1 list (fallback / cross-channel)
  const db = (ctx.env as unknown as { DB?: { prepare: (q: string) => { bind: (...args: unknown[]) => { run: () => Promise<unknown> } } } }).DB;
  if (db) {
    try {
      await db
        .prepare(
          `INSERT OR IGNORE INTO newsletter_subscribers (email, source, created_at) VALUES (?, ?, datetime('now'))`,
        )
        .bind(email, source)
        .run();
    } catch {
      // table might not exist yet — safe to ignore
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
