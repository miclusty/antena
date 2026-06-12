// ═══════════════════════════════════════════════════════════════
// Drizzle Kit config — Cloudflare D1 (SQLite at the edge)
// ═══════════════════════════════════════════════════════════════
// Schema is `./src/db/schema.ts`. Migrations emit to `./migrations/`.
//
// To regenerate migrations after a schema change:
//   pnpm exec drizzle-kit generate
//
// To apply locally:
//   wrangler d1 migrations apply DB --local
//
// To apply remotely (CI / deploy):
//   wrangler d1 migrations apply DB --remote
//
// Required env vars (see packages/api/.dev.vars or .dev.vars):
//   CLOUDFLARE_ACCOUNT_ID
//   CLOUDFLARE_D1_DATABASE_ID
//   CLOUDFLARE_API_TOKEN
// ═══════════════════════════════════════════════════════════════

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID!,
    token: process.env.CLOUDFLARE_API_TOKEN!,
  },
  verbose: true,
  strict: true,
});
