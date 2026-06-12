// ═══════════════════════════════════════════════════════════════
// Typed Cloudflare bindings for Pages Functions context
// ═══════════════════════════════════════════════════════════════
// Pages Functions (src/functions/api/*) run in the Pages runtime,
// not the Workers runtime. The context shape is different:
//   - `env` has the same binding names as the API Worker
//   - `params` is the dynamic route segment map
//   - `data` is the shared middleware chain slot (typed via PagesContext<T>)
//   - `next()` runs the next middleware
//
// Use this file from `src/functions/api/*.ts`. Example:
//
//   import type { PagesContext } from "../../lib/cloudflare";
//   export const onRequestGet: PagesFunction<PagesEnv> = async (ctx) => {
//     const { results } = await ctx.env.DB.prepare("...").all();
//     return Response.json(results);
//   };
// ═══════════════════════════════════════════════════════════════

import type {
  D1Database,
  KVNamespace,
  R2Bucket,
  VectorizeIndex,
  AnalyticsEngineDataset,
  Queue,
} from "@cloudflare/workers-types";

export interface PagesEnv {
  DB: D1Database;
  CACHE: KVNamespace;
  IMAGES: R2Bucket;
  VECTORS: VectorizeIndex;
  ANALYTICS: AnalyticsEngineDataset;
  IMAGE_QUEUE: Queue;
  ENVIRONMENT?: "development" | "staging" | "production";
  API_BASE?: string;
  AKIRA_URL?: string;
}

export type PagesContext<T = unknown> = {
  request: Request;
  env: PagesEnv;
  params: Record<string, string>;
  data: T;
  waitUntil: (promise: Promise<unknown>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
};
