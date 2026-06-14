import { z } from "zod";

export const feedParamsSchema = z.object({
  location_id: z.coerce.number().int().positive().optional(),
  category: z.string().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  bias: z.enum(["all", "left", "right", "neutral"]).optional(),
  time: z.enum(["hour", "today", "week", "all"]).optional(),
  min_quality: z.coerce.number().min(0).max(1).optional(),
  /**
   * If true, the feed is restricted to news from sources the
   * caller follows. Identified by `X-Device-Id` header or
   * `device_id` query param (same as the follows API).
   *
   * Note: z.coerce.boolean() in zod 3.23+ does NOT parse "true"/"false"
   * strings (it only handles actual booleans or undefined). So we use
   * a string union + transform.
   */
  following: z
    .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0"), z.boolean()])
    .optional()
    .transform((v) => v === "true" || v === "1" || v === true),
  /**
   * Comma-separated list of source_ids. When set (and `following`
   * is false / unset), the feed is restricted to those sources
   * directamente. The frontend uses this to scope a custom-tab feed
   * to a single source when the user has selected "see more
   * from this source" from a card.
   */
  source_ids: z.string().max(2048).optional(),
});

export const articleIdSchema = z.object({
  id: z.string().min(1).max(128),
});

export const clusterIdSchema = z.object({
  id: z.string().min(1).max(128),
});

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const imageParamsSchema = z.object({
  hash: z.string().min(1).max(256),
  w: z.coerce.number().int().min(50).max(2000).optional(),
  fmt: z.enum(["avif", "webp", "jpg"]).optional(),
  fit: z.enum(["cover", "contain"]).optional(),
});

export const trackEventSchema = z.object({
  type: z.enum(["card_view", "article_open", "article_complete", "bookmark", "share"]),
  newsId: z.string().max(128).optional(),
  category: z.string().max(50).optional(),
  source: z.string().max(128).optional(),
  dwellTime: z.number().min(0).max(86_400).optional(),
  scrollDepth: z.number().min(0).max(1).optional(),
});

export const locationNearSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const locationIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const statsLimitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export type FeedParams = z.infer<typeof feedParamsSchema>;
export type ArticleId = z.infer<typeof articleIdSchema>;
export type ClusterId = z.infer<typeof clusterIdSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type ImageParams = z.infer<typeof imageParamsSchema>;
export type TrackEvent = z.infer<typeof trackEventSchema>;
export type LocationNear = z.infer<typeof locationNearSchema>;
export type LocationIdParam = z.infer<typeof locationIdParamSchema>;
export type StatsLimit = z.infer<typeof statsLimitSchema>;

export function formatZodError(error: z.ZodError): {
  error: string;
  details: { fieldErrors: Record<string, string[]>; formErrors: string[] };
} {
  return {
    error: "Invalid request",
    details: {
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
      formErrors: error.flatten().formErrors,
    },
  };
}
