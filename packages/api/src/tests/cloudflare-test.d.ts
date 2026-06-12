import type { Env } from "../lib/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}
