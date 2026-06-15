/**
 * Build-time script: reads news_cards from D1 and emits Cloudflare
 * Pages `_redirects` rules mapping `/noticia/<uuid>` →
 * `/<year>/<month>/<day>/<slug>`.
 *
 * Output:
 *   - packages/antena/public/_redirects — first 2000 rules (Cloudflare
 *     Pages limit per file).
 *   - packages/api/.redirects-cache.json — remaining rules as a JSON
 *     object { uuid: "/<y>/<m>/<d>/<slug>" } that the worker
 *     middleware (Task 32) reads at runtime to handle the long tail.
 *
 * Run via: `pnpm tsx packages/api/src/lib/redirects-generator.ts`
 *          (wired as `prebuild` in packages/antena/package.json)
 *
 * Phase 3 Task 30.
 */
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REDIRECTS_PATH = join(__dirname, "../../../antena/public/_redirects");
const CACHE_PATH = join(__dirname, "../../.redirects-cache.json");
const MAX_REDIRECTS_IN_FILE = 2000;

interface SitemapItem {
  id: string;
  slug: string;
  slug_date: string;
  published_at: string;
}

function fetchAllSlugs(envArg: string): SitemapItem[] {
  const target = envArg === "local" ? "--local" : `--env=${envArg} --remote`;
  const cmd = `pnpm wrangler d1 execute DB ${target} --json --command="SELECT id, slug, slug_date, published_at FROM news_cards WHERE slug != '' AND slug_date != '' ORDER BY published_at DESC"`;
  try {
    const output = execSync(cmd, { encoding: "utf-8", cwd: join(__dirname, "../..") });
    // `wrangler d1 execute --json` wraps the rows in an outer array
    // (one per statement) and an inner `results` array. The first
    // statement is our SELECT.
    const parsed = JSON.parse(output);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return (first?.results ?? []) as SitemapItem[];
  } catch (e) {
    console.error("[redirects-generator] Failed to fetch slugs from D1:", e);
    return [];
  }
}

function buildRedirectLine(item: SitemapItem): string {
  const [year, month, day] = item.slug_date.split("-");
  return `/noticia/${item.id}  /${year}/${month}/${day}/${item.slug}  301!`;
}

function main() {
  const envArg = process.argv[2] ?? "production";
  console.log(`[redirects-generator] Fetching slugs from D1 (env=${envArg})...`);
  const items = fetchAllSlugs(envArg);
  console.log(`[redirects-generator] Found ${items.length} slugs`);

  if (items.length === 0) {
    console.log("[redirects-generator] No slugs to process, exiting");
    return;
  }

  // Already sorted DESC by published_at from the SQL, but be defensive.
  const sorted = items.sort((a, b) =>
    new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
  );

  const inFile = sorted.slice(0, MAX_REDIRECTS_IN_FILE);
  const inWorker = sorted.slice(MAX_REDIRECTS_IN_FILE);

  const newLines = inFile.map(buildRedirectLine);

  // Preserve any non-legacy rules that already live in the file
  // (the apex→www 301, the trailing-slash rules, etc.) and only
  // replace the per-article legacy redirects.
  const existing = existsSync(REDIRECTS_PATH)
    ? readFileSync(REDIRECTS_PATH, "utf-8").split("\n").filter((line) => {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) return true;
        return !/^\/noticia\/[0-9a-f-]{36}\s/.test(line);
      })
    : [];

  const finalContent = [...existing.filter(Boolean), ...newLines].join("\n") + "\n";
  writeFileSync(REDIRECTS_PATH, finalContent, "utf-8");
  console.log(`[redirects-generator] Wrote ${inFile.length} redirects to ${REDIRECTS_PATH}`);

  const kvData = Object.fromEntries(
    inWorker.map((item) => {
      const [y, m, d] = item.slug_date.split("-");
      return [item.id, `/${y}/${m}/${d}/${item.slug}`];
    }),
  );
  writeFileSync(CACHE_PATH, JSON.stringify(kvData, null, 2), "utf-8");
  console.log(`[redirects-generator] Wrote ${inWorker.length} KV entries to ${CACHE_PATH}`);
}

main();
