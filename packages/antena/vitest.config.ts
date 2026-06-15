import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);

function findAstroCoreCompile(): (opts: any) => Promise<any> {
  const astroPkgPath = require.resolve("astro/package.json");
  const astroRoot = dirname(astroPkgPath);
  const compilePath = resolve(astroRoot, "dist/core/compile/compile.js");
  const mod = require(compilePath) as { compile: (opts: any) => Promise<any> };
  return mod.compile;
}

const astroCompile = findAstroCoreCompile();

function astroTestPlugin() {
  return {
    name: "astro-test",
    enforce: "pre" as const,
    async transform(code: string, id: string) {
      if (!id.endsWith(".astro")) return null;
      const result = await astroCompile({
        astroConfig: {
          root: new URL("file:///"),
          srcDir: new URL("file:///src/"),
          compressHTML: false,
          scopedStyleStrategy: "attribute",
          site: "https://www.antena.com.ar",
          experimental: { preserveScriptOrder: false },
          devToolbar: { enabled: false },
        },
        viteConfig: { command: "build", esbuild: {} },
        preferences: { get: async () => false },
        filename: id,
        source: code,
      });
      const stripped = await esbuild.transform(result.code, {
        loader: "ts",
        sourcemap: "external",
        target: "esnext",
      });
      return { code: stripped.code, map: stripped.map };
    },
  };
}

export default defineConfig({
  plugins: [solidPlugin(), astroTestPlugin()],
  esbuild: {
    jsx: "preserve",
    jsxImportSource: "solid-js",
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/tests/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/cloudflare.ts", "src/lib/db.ts"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
  resolve: {
    conditions: ["development", "browser"],
  },
});
