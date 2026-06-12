import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import { resolve } from "node:path";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        singleWorker: true,
        main: resolve(__dirname, "./src/index.ts"),
        miniflare: {
          compatibilityDate: "2024-12-30",
          compatibilityFlags: ["nodejs_compat"],
          // miniflare 3 (used by vitest-pool-workers 0.5) supports:
          // D1, KV, R2, Queues. Vectorize + Analytics Engine are NOT
          // supported in miniflare 3 — tests that need those bindings
          // are marked .skip with a TODO.
          d1Databases: { DB: "antena-test" },
          r2Buckets: { IMAGES: "antena-images-test" },
          kvNamespaces: { CACHE: "antena-cache-test" },
          queueProducers: { IMAGE_QUEUE: { queueName: "image-pipeline-test" } },
        },
      },
    },
  },
});
