/** @jsxImportSource solid-js */
import { createMemo } from "solid-js";
import type { NewsItem } from "../lib/types";

// Threshold after which we tell the user "the feed is stale" — anything
// older than this is too far gone to silently show as today's news.
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

export type UseStalenessOpts = {
  /** The currently-rendered feed (after filters/search). */
  mappedNews: () => NewsItem[];
  /** `stats.news_today` from /api/stats/health. Treat 0 as "AKIRA hasn't
   *  extracted today". */
  newsToday: () => number;
};

/**
 * Compute whether the feed is stale (no fresh news). The banner should
 * appear when:
 *   - the API stats show news_today === 0 (AKIRA hasn't pushed anything
 *     in the last 24h), AND
 *   - we DO have items in the feed (otherwise the EmptyState takes
 *     over and a banner would double up), AND
 *   - the oldest item we're showing is older than 48h. This guards
 *     against false positives on first-load with cached data.
 *
 * `daysSinceLastNews` is exposed so the banner can show "23 días" to
 * set user expectations precisely (instead of a generic "hace varios
 * días" hand-wave).
 */
export function useStaleness(opts: UseStalenessOpts) {
  const maxPublishedAtMs = createMemo<number>(() => {
    const items = opts.mappedNews();
    if (items.length === 0) return 0;
    let max = 0;
    for (const n of items) {
      const raw = n.publishedAt || n.time || "";
      const t = new Date(raw).getTime();
      if (Number.isFinite(t) && t > max) max = t;
    }
    return max;
  });

  const daysSinceLastNews = createMemo<number | null>(() => {
    const t = maxPublishedAtMs();
    if (!t) return null;
    return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
  });

  const isStale = createMemo<boolean>(() => {
    if (opts.newsToday() > 0) return false;
    const items = opts.mappedNews();
    if (items.length === 0) return false;
    const t = maxPublishedAtMs();
    if (!t) return false;
    return Date.now() - t > STALE_THRESHOLD_MS;
  });

  return { isStale, daysSinceLastNews };
}
