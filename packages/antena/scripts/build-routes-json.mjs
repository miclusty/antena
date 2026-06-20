// Generate Cloudflare Pages _routes.json for the static + functions hybrid.
//
// Pages Functions are mounted on every URL by default. _routes.json lets
// us tell Cloudflare "serve these paths as static files, only run the
// Worker on the rest". This is what keeps the Pages Worker bundle small
// (no _astro assets flow through the Worker) and prevents Edge Cache
// invalidation on every static deploy.
//
// Excluded paths (Worker runs here):
//   /api/* — API endpoints (search, img proxy, track, RSS, sitemap, etc.)
//   /_cron/* — scheduled cron handler
//
// Included paths (served as static):
//   everything else (HTML pages, _astro/* assets, icons, fonts)
//
// References:
//   https://developers.cloudflare.com/pages/functions/routing/#routesjson
import { writeFileSync, readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIST = './dist';

if (!existsSync(DIST)) {
  console.error(`[routes-json] dist/ not found — run astro build first`);
  process.exit(1);
}

// Walk dist/ to discover static asset paths that should NOT trigger the
// Worker. We exclude the obvious dynamic prefixes explicitly so the
// Worker still owns /api/* and /_cron/* regardless of what dist/ has.
const exclude = new Set(['api', '_cron']);
const include = ['/*']; // default: everything not in the exclude list

function walk(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

const staticPaths = walk(DIST);

// Build the exclude list as a union of the dynamic prefixes plus any
// static path whose parent segment matches one of those prefixes
// (defensive: in case static.html files end up under /api/ by mistake).
const excludePatterns = [...exclude].map((p) => `/${p}/*`);

const routes = {
  version: 1,
  include,
  exclude: excludePatterns,
};

const out = join(DIST, '_routes.json');
writeFileSync(out, JSON.stringify(routes, null, 2) + '\n');
console.log(`[routes-json] Wrote ${out}:`, routes);