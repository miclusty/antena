import { describe, it, expect } from "vitest";
import { createRoot } from "solid-js";
import { useFeedFilters } from "../../hooks/useFeedFilters";

describe("useFeedFilters", () => {
  it("starts with default filters (no time/quality/bias)", () => {
    createRoot((dispose) => {
      const f = useFeedFilters();
      expect(f.filterState()).toEqual({ time: "all", quality: 0, bias: "all" });
      expect(f.hasActiveFilters()).toBe(false);
      dispose();
    });
  });

  it("updateTime sets the time and calls reset via setReset", () => {
    createRoot((dispose) => {
      const f = useFeedFilters();
      const reset = { called: 0 };
      f.setReset(() => {
        reset.called++;
      });
      f.updateTime("hour");
      expect(f.filterState().time).toBe("hour");
      expect(f.hasActiveFilters()).toBe(true);
      expect(reset.called).toBe(1);
      dispose();
    });
  });

  it("updateQuality / updateBias / clearFilters all call reset", () => {
    createRoot((dispose) => {
      const f = useFeedFilters();
      let calls = 0;
      f.setReset(() => calls++);
      f.updateQuality(0.4);
      f.updateBias("neutral");
      expect(calls).toBe(2);
      f.clearFilters();
      expect(calls).toBe(3);
      expect(f.filterState()).toEqual({ time: "all", quality: 0, bias: "all" });
      dispose();
    });
  });

  it("setShowFilters toggles the filter panel", () => {
    createRoot((dispose) => {
      const f = useFeedFilters();
      expect(f.showFilters()).toBe(false);
      f.setShowFilters(true);
      expect(f.showFilters()).toBe(true);
      dispose();
    });
  });
});
