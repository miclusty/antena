import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin()],
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
