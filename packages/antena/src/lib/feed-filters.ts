// Pure helpers for the feed filter state (time, quality, bias).
// Kept separate from App.tsx so the URL-building logic is testable
// in isolation — the resource in App.tsx reads its result and
// forwards the params to fetchFeed().

export type TimeFilter = "hour" | "today" | "week" | "all";
export type BiasFilter = "all" | "left" | "right" | "neutral";
export type QualityFilter = 0 | 0.4 | 0.7;

export interface FeedFilterState {
  time: TimeFilter;
  quality: QualityFilter;
  bias: BiasFilter;
}

/** Default state — no filters active, equivalent to the unfiltered
 *  feed. Used on first render and on reset. */
export const DEFAULT_FILTERS: FeedFilterState = {
  time: "all",
  quality: 0,
  bias: "all",
};

/** Returns the subset of URLSearchParams the feed endpoint should
 *  receive given the current filter state. Filters at their
 *  default values are omitted so the URL stays clean and so the
 *  default cache key isn't polluted. */
export function buildFeedFilterParams(state: FeedFilterState): {
  time?: string;
  min_quality?: number;
  bias?: string;
} {
  const out: { time?: string; min_quality?: number; bias?: string } = {};

  if (state.time !== "all") out.time = state.time;

  // Quality 0 = "no filter". Anything > 0 is a real threshold.
  if (state.quality > 0 && state.quality <= 1) out.min_quality = state.quality;

  if (state.bias !== "all") out.bias = state.bias;

  return out;
}

/** True when at least one filter is active. Used to render the
 *  "Filtros activos · Limpiar" affordance in the UI. */
export function hasActiveFilters(state: FeedFilterState): boolean {
  return Object.keys(buildFeedFilterParams(state)).length > 0;
}
