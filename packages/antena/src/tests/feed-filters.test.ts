import { describe, it, expect } from "vitest";
import { buildFeedFilterParams, type FeedFilterState } from "../lib/feed-filters";

describe("buildFeedFilterParams", () => {
  it("returns empty object when all filters are at their default ('all'/0)", () => {
    const state: FeedFilterState = { time: "all", quality: 0, bias: "all" };
    expect(buildFeedFilterParams(state)).toEqual({});
  });

  it("includes time filter when not 'all'", () => {
    const state: FeedFilterState = { time: "today", quality: 0, bias: "all" };
    expect(buildFeedFilterParams(state)).toEqual({ time: "today" });
  });

  it("includes min_quality when > 0", () => {
    const state: FeedFilterState = { time: "all", quality: 0.4, bias: "all" };
    expect(buildFeedFilterParams(state)).toEqual({ min_quality: 0.4 });
  });

  it("includes bias when not 'all'", () => {
    const state: FeedFilterState = { time: "all", quality: 0, bias: "neutral" };
    expect(buildFeedFilterParams(state)).toEqual({ bias: "neutral" });
  });

  it("combines multiple active filters", () => {
    const state: FeedFilterState = { time: "hour", quality: 0.7, bias: "left" };
    expect(buildFeedFilterParams(state)).toEqual({
      time: "hour",
      min_quality: 0.7,
      bias: "left",
    });
  });

  it("preserves zero as a valid quality (not omitted)", () => {
    const state: FeedFilterState = { time: "all", quality: 0, bias: "all" };
    expect(buildFeedFilterParams(state)).toEqual({});
  });

  it("clamps quality to 0..1 range (defensive)", () => {
    // Bypass the QualityFilter union: a malformed value should be
    // dropped by the runtime check, not produce an invalid param.
    const state = { time: "all" as const, quality: 1.5 as unknown as 0, bias: "all" as const };
    expect(buildFeedFilterParams(state)).toEqual({});
  });
});
