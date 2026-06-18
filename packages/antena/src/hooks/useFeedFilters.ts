/** @jsxImportSource solid-js */
import { createSignal, createEffect } from "solid-js";
import { type TimeFilter, type QualityFilter, type BiasFilter, type FeedFilterState, DEFAULT_FILTERS, hasActiveFilters as hasActiveFiltersImpl } from "../lib/feed-filters";

export type UseFeedFiltersOptions = {
  initial?: Partial<FeedFilterState>;
};

export function useFeedFilters(opts: UseFeedFiltersOptions = {}) {
  const [filterState, setFilterState] = createSignal<FeedFilterState>({ ...DEFAULT_FILTERS, ...opts.initial });
  const [showFilters, setShowFilters] = createSignal(false);

  let reset: () => void = () => {};

  const updateTime = (t: TimeFilter) => {
    setFilterState((s) => ({ ...s, time: t }));
    reset();
  };
  const updateQuality = (q: QualityFilter) => {
    setFilterState((s) => ({ ...s, quality: q }));
    reset();
  };
  const updateBias = (b: BiasFilter) => {
    setFilterState((s) => ({ ...s, bias: b }));
    reset();
  };
  const clearFilters = () => {
    setFilterState({ ...DEFAULT_FILTERS });
    reset();
  };

  const hasActiveFilters = (): boolean => hasActiveFiltersImpl(filterState());

  const setReset = (fn: () => void) => {
    reset = fn;
  };

  return {
    filterState,
    showFilters,
    setShowFilters,
    updateTime,
    updateQuality,
    updateBias,
    clearFilters,
    hasActiveFilters,
    setReset,
  };
}
