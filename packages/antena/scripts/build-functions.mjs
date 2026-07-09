import { build } from "esbuild";
import { readdirSync, mkdirSync } from "fs";
import { join, basename } from "path";

const FUNCTIONS_DIR = "./packages/antena/functions";
const OUT_DIR = "./packages/antena/dist/functions";

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(join(OUT_DIR, "api"), { recursive: true });
mkdirSync(join(OUT_DIR, "__cron"), { recursive: true });

const entries = [];
function walk(dir, base = dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, base);
    } else if (entry.name.endsWith(".ts")) {
      entries.push(full);
    }
  }
}
walk(FUNCTIONS_DIR);

console.log(`[functions-build] Compiling ${entries.length} TS files...`);
await build({
  entryPoints: entries,
  outdir: OUT_DIR,
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "neutral",
  // Pages Functions don't have access to npm packages at runtime
  // unless they're bundled. Keep them lean — no node imports.
  external: [],
  logLevel: "warning",
});
console.log(`[functions-build] Done. Output: ${OUT_DIR}`);
