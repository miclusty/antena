/** @jsxImportSource solid-js */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "solid-js";

vi.mock("../../lib/api", () => ({
  fetchCategories: vi.fn().mockResolvedValue([]),
  fetchStats: vi.fn().mockResolvedValue({ status: "ok", stats: { total_news: 0, active_sources: 0, total_locations: 0 } }),
  fetchCities: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../components/Toast", () => ({
  toast: vi.fn(),
}));

import { useDiscovery } from "../../hooks/useDiscovery";

describe("useDiscovery", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  it("starts with default categories from CATEGORIES and empty everything else", () => {
    createRoot((dispose) => {
      const d = useDiscovery();
      expect(d.categories().length).toBeGreaterThan(0);
      expect(d.stats().total_news).toBe(0);
      expect(d.cities()).toEqual([]);
      expect(d.customTabs()).toEqual([]);
      expect(d.feedTabsVisible()).toBe(true);
      dispose();
    });
  });

  it("onAddCustomTab adds a tab and persists to localStorage", () => {
    createRoot((dispose) => {
      const d = useDiscovery();
      d.onAddCustomTab({ slug: "tecnologia", name: "Tecnología" });
      expect(d.customTabs()).toEqual([{ id: "cat:tecnologia", label: "Tecnología", category: "tecnologia" }]);
      const stored = JSON.parse(localStorage.getItem("antena-custom-tabs") ?? "[]");
      expect(stored[0].id).toBe("cat:tecnologia");
      dispose();
    });
  });

  it("onRemoveCustomTab removes the tab and persists", () => {
    localStorage.setItem("antena-custom-tabs", JSON.stringify([{ id: "cat:tecnologia", label: "Tecnología", category: "tecnologia" }]));
    createRoot((dispose) => {
      const d = useDiscovery();
      expect(d.customTabs().length).toBe(1);
      d.onRemoveCustomTab("cat:tecnologia");
      expect(d.customTabs()).toEqual([]);
      const stored = JSON.parse(localStorage.getItem("antena-custom-tabs") ?? "[]");
      expect(stored).toEqual([]);
      dispose();
    });
  });
});
