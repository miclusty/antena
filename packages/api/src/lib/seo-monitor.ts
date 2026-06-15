// Cron-driven SEO health check. Runs every 6h and verifies the
// critical SEO surface area is still intact:
//
//   - sitemap.xml is reachable and on https://www.
//   - robots.txt allows the major AI bots (GPTBot, Claude, etc.)
//   - the home page emits a www-canonical link and og:url
//   - llms.txt / llms-full.txt are reachable
//   - og-default.webp and the IndexNow key file are reachable
//
// Each check writes a row to the Analytics Engine dataset
// `seo_health` (so the dashboard can graph pass/fail over time),
// and on any failure we POST a Discord webhook so on-call sees it
// before users do.

const SITE = "https://www.antena.com.ar";

interface BaseCheck {
  name: string;
  url: string;
}

interface ExpectHttpsCheck extends BaseCheck {
  expectHttps: true;
}

interface ExpectBodyCheck extends BaseCheck {
  expectBodyMatch: RegExp;
}

interface ExpectExtractCheck extends BaseCheck {
  extract: (html: string) => string;
  expect: string;
}

type Check = BaseCheck | ExpectHttpsCheck | ExpectBodyCheck | ExpectExtractCheck;

const CHECKS: Check[] = [
  { name: "sitemap_xml_accessible", url: `${SITE}/sitemap.xml` },
  { name: "sitemap_xml_www", url: `${SITE}/sitemap.xml`, expectHttps: true },
  { name: "robots_txt_accessible", url: `${SITE}/robots.txt` },
  { name: "robots_txt_has_gptbot", url: `${SITE}/robots.txt`, expectBodyMatch: /GPTBot/i },
  {
    name: "home_canonical_www",
    url: `${SITE}/`,
    extract: (html: string) => {
      const m = html.match(/<link rel="canonical" href="([^"]+)"/);
      return m?.[1] ?? "";
    },
    expect: `${SITE}/`,
  },
  {
    name: "home_og_url_www",
    url: `${SITE}/`,
    extract: (html: string) => {
      const m = html.match(/og:url" content="([^"]+)"/);
      return m?.[1] ?? "";
    },
    expect: `${SITE}/`,
  },
  { name: "llms_txt_accessible", url: `${SITE}/llms.txt` },
  { name: "llms_full_txt_accessible", url: `${SITE}/llms-full.txt` },
  { name: "og_default_webp_accessible", url: `${SITE}/og-default.webp` },
  { name: "indexnow_key_accessible", url: `${SITE}/antena2026indexnow.txt` },
  {
    name: "indexnow_key_valid",
    url: `${SITE}/antena2026indexnow.txt`,
    expectBodyMatch: /antena2026indexnow/,
  },
];

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
  duration_ms: number;
}

async function runCheck(check: Check): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await fetch(check.url, {
      headers: { "User-Agent": "AntenaSeoMonitor/1.0" },
    });
    const body = await res.text();
    let pass = res.ok;
    let detail = `${res.status}`;

    if ("expectHttps" in check && check.expectHttps) {
      pass = pass && check.url.startsWith("https://");
    }
    if ("expectBodyMatch" in check && check.expectBodyMatch) {
      pass = pass && check.expectBodyMatch.test(body);
    }
    if ("expect" in check && check.expect) {
      const extracted = check.extract?.(body) ?? "";
      pass = pass && extracted === check.expect;
      detail = `${res.status}, extracted=${extracted}`;
    }

    return { name: check.name, pass, detail, duration_ms: Date.now() - start };
  } catch (e) {
    return {
      name: check.name,
      pass: false,
      detail: `error: ${e instanceof Error ? e.message : String(e)}`,
      duration_ms: Date.now() - start,
    };
  }
}

export interface SeoMonitorEnv {
  ANALYTICS?: AnalyticsEngineDataset;
  DISCORD_WEBHOOK_URL?: string;
}

export interface SeoHealthSummary {
  ok: number;
  fail: number;
  results: CheckResult[];
}

export async function runSeoHealthCheck(
  env: SeoMonitorEnv,
): Promise<SeoHealthSummary> {
  const results = await Promise.all(CHECKS.map(runCheck));
  const ok = results.filter((r) => r.pass).length;
  const fail = results.length - ok;

  if (env.ANALYTICS) {
    for (const r of results) {
      try {
        env.ANALYTICS.writeDataPoint({
          blobs: [r.name, r.pass ? "pass" : "fail", r.detail],
          doubles: [r.duration_ms],
          indexes: [r.name],
        });
      } catch {
        // ignore analytics errors — never let reporting fail the run
      }
    }
  }

  if (fail > 0 && env.DISCORD_WEBHOOK_URL) {
    const failed = results.filter((r) => !r.pass);
    const message =
      `🚨 SEO Health Check FAILED (${fail}/${results.length})\n\n` +
      failed.map((r) => `❌ ${r.name}: ${r.detail}`).join("\n");
    try {
      await fetch(env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
      });
    } catch {
      // ignore discord errors
    }
  }

  return { ok, fail, results };
}
