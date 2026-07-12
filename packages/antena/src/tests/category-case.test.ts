import { describe, it, expect } from "vitest";
import { mapNewsCard } from "../lib/mappers";
import type { ApiNewsCard } from "../lib/api";

// The category strings on the frontend (`CAT_COLOR` in NewsCard.tsx and
// elsewhere) are title-case Spanish: "Economía", "Deportes", etc. When
// the AKIRA API returns a lowercase slug-style category ("economia"),
// the renderer falls through to the gray default. This test pins down
// the normalization at the mapper layer so the front-end never has to
// guess.

const baseCard: ApiNewsCard = {
  id: "t-1",
  location_id: 1,
  title: "x",
  summary: "s",
  body: "",
  image_url: null,
  bias_score: 0,
  is_gacetilla: 0,
  cluster_id: "c-1",
  category: null,
  source_ids: "1",
  source_name: "F",
  source_url: "",
  location_name: null,
  location_province: null,
  published_at: null,
  created_at: new Date().toISOString(),
  sources_count: 1,
  quality_score: 0.5,
};

describe("mapNewsCard category normalization", () => {
  it("normalizes lowercase 'economia' from API to title-case 'Economía'", () => {
    const r = mapNewsCard({ ...baseCard, category: "economia" });
    expect(r.category).toBe("Economía");
  });

  it("normalizes each Spanish category slug to its title-case form", () => {
    const cases: Array<[string, string]> = [
      ["deportes", "Deportes"],
      ["politica", "Política"],
      ["policiales", "Policiales"],
      ["cultura", "Cultura"],
      ["tecnologia", "Tecnología"],
      ["sociedad", "Sociedad"],
      ["internacional", "Internacional"],
      ["clima", "Clima"],
      ["espectaculos", "Espectáculos"],
      ["general", "Generales"],
      ["generales", "Generales"],
    ];
    for (const [input, expected] of cases) {
      expect(
        mapNewsCard({ ...baseCard, category: input }).category,
        `expected "${input}" → "${expected}"`,
      ).toBe(expected);
    }
  });

  it("passes already-title-case categories through unchanged", () => {
    expect(mapNewsCard({ ...baseCard, category: "Economía" }).category).toBe("Economía");
    expect(mapNewsCard({ ...baseCard, category: "Tecnología" }).category).toBe("Tecnología");
  });

  it("returns a string for unknown categories (no crash, no throw)", () => {
    const r = mapNewsCard({ ...baseCard, category: "rare-bird" });
    expect(typeof r.category).toBe("string");
    expect(r.category.length).toBeGreaterThan(0);
  });
});
