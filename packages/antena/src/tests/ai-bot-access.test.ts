// Regression test: AI crawlers (GPTBot, ClaudeBot, etc.) must be able
// to access the site for Pagespeed "agentic browsing" audits and for
// AI assistants like ChatGPT, Claude, Perplexity to reference our
// content. Cloudflare Bot Fight Mode blocks these by default — see
// packages/antena/docs/CLOUDFLARE-BOT-FIGHT-MODE.md for the fix.
//
// Implementation note: we use Node's built-in `http` module instead of
// the global `fetch` because tests/setup.ts stubs fetch with a no-op
// mock that always returns 200, which would mask real Cloudflare
// behavior.
//
// To skip in CI without network access, set SKIP_BOT_TESTS=1.

import { describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const SKIP = process.env.SKIP_BOT_TESTS === "1";
const describeIf = SKIP ? describe.skip : describe;

type BotProbe = { label: string; ua: string };
const probes: BotProbe[] = [
  { label: "OpenAI GPTBot",     ua: "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)" },
  { label: "Anthropic ClaudeBot", ua: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
  { label: "Perplexity",        ua: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/bot)" },
  { label: "Common Crawl CCBot", ua: "Mozilla/5.0 (compatible; CCBot/2.0; +https://commoncrawl.org/biglogger)" },
];

/** Make a real HTTPS request with a custom User-Agent. Bypasses any
 *  test mocks because it doesn't use the global fetch. */
async function fetchWithUA(url: string, ua: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      { headers: { "User-Agent": ua, Accept: "text/html" }, method: "HEAD" },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.setTimeout(15_000, () => {
      req.destroy(new Error("timeout"));
    });
    req.end();
  });
}

describeIf("AI bots are not blocked by Cloudflare", () => {
  const target = "https://www.antena.com.ar/";

  for (const { label, ua } of probes) {
    it(`${label} can reach the site (not 403)`, async () => {
      const status = await fetchWithUA(target, ua);
      // 403 = Cloudflare Bot Fight Mode blocking the bot.
      // To fix: Cloudflare dashboard → antena.com.ar → Security →
      // Bots → disable Bot Fight Mode, or add WAF allow rules for
      // these user agents. See docs/CLOUDFLARE-BOT-FIGHT-MODE.md.
      expect(
        status,
        `${label} got ${status} from ${target}. ` +
          `If 403: Bot Fight Mode is blocking. If 5xx: API/edge issue.`,
      ).not.toBe(403);
    }, 30_000);
  }
});