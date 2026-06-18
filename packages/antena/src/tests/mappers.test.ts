import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mapNewsCard, stripHtml, formatTime, computeSignalLevel, computeVoices, mapBias, mapCategory, mapLocation } from "../lib/mappers";
import type { ApiNewsCard, ApiCategory, ApiLocation } from "../lib/api";

describe("stripHtml", () => {
  it("returns empty string for empty input", () => {
    expect(stripHtml("")).toBe("");
  });

  it("strips HTML tags", () => {
    expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("strips Facebook/Twitter/Instagram embed prefixes", () => {
    expect(stripHtml("[Facebook](https://fb.com/x) The actual content")).toBe("The actual content");
  });

  it("decodes HTML entities", () => {
    expect(stripHtml("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(stripHtml("&nbsp;text&nbsp;")).toBe("text");
    expect(stripHtml("&#8217;")).toBe("'");
    expect(stripHtml("&#8220;quoted&#8221;")).toBe('"quoted"');
    expect(stripHtml("&#8211;")).toBe("-");
    expect(stripHtml("&#8212;")).toBe("—");
  });

  it("truncates to ~280 chars with ellipsis when long content", () => {
    const long = "This is a sentence. ".repeat(30);
    const result = stripHtml(`<p>${long}</p>`);
    expect(result.length).toBeLessThanOrEqual(310);
  });

  it("removes 'The post' suffix (Facebook scraping artifact)", () => {
    expect(stripHtml("Real content The post was published yesterday")).toBe("Real content");
  });

  it("removes 'Leer más' suffix", () => {
    expect(stripHtml("Some content Leer más some more")).toBe("Some contentsome more");
    expect(stripHtml("Some content  Leer más  some more")).toBe("Some contentsome more");
  });

  it("collapses whitespace", () => {
    expect(stripHtml("  hello   world  ")).toBe("hello world");
  });
});

describe("formatTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T15:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty string for null input", () => {
    expect(formatTime(null)).toBe("");
  });

  it("returns 'Ahora' for less than a minute ago", () => {
    const now = new Date().toISOString();
    expect(formatTime(now)).toBe("Ahora");
  });

  it("returns 'Hace Xmin' for minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatTime(fiveMinAgo)).toBe("Hace 5min");
  });

  it("returns 'Hace Xh' for hours ago", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
    expect(formatTime(twoHoursAgo)).toBe("Hace 2h");
  });

  it("returns 'Hace Xd' for days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
    expect(formatTime(threeDaysAgo)).toBe("Hace 3d");
  });
});

describe("computeSignalLevel", () => {
  it("returns 1 when sourceIds is null", () => {
    expect(computeSignalLevel(null)).toBe(1);
  });

  it("returns 1 for single source", () => {
    expect(computeSignalLevel("src-1")).toBe(1);
  });

  it("returns 3 for 2 sources", () => {
    expect(computeSignalLevel("src-1,src-2")).toBe(3);
  });

  it("returns 4 for 3 sources", () => {
    expect(computeSignalLevel("src-1,src-2,src-3")).toBe(4);
  });

  it("returns 6 for 5 sources", () => {
    expect(computeSignalLevel("src-1,src-2,src-3,src-4,src-5")).toBe(6);
  });

  it("returns 8 for 10 sources", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `src-${i}`).join(",");
    expect(computeSignalLevel(ids)).toBe(8);
  });

  it("returns 10 for 20+ sources", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `src-${i}`).join(",");
    expect(computeSignalLevel(ids)).toBe(10);
  });

  it("applies +1 boost for high quality (>=0.7)", () => {
    expect(computeSignalLevel("src-1,src-2,src-3", 0.85)).toBe(5);
  });

  it("applies -1 penalty for low quality (<0.4)", () => {
    expect(computeSignalLevel("src-1,src-2,src-3", 0.2)).toBe(3);
  });

  it("applies -2 penalty for gacetilla", () => {
    expect(computeSignalLevel("src-1,src-2,src-3", null, true)).toBe(2);
  });

  it("clamps to minimum 1", () => {
    expect(computeSignalLevel(null, 0.1, true)).toBe(1);
  });

  it("clamps to maximum 10", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `src-${i}`).join(",");
    expect(computeSignalLevel(ids, 1.0)).toBe(10);
  });
});

describe("computeVoices", () => {
  it("returns default split for empty input", () => {
    const voices = computeVoices([]);
    expect(voices).toHaveLength(3);
    expect(voices[0].pct + voices[1].pct + voices[2].pct).toBe(100);
  });

  it("classifies positive bias as officialist", () => {
    const voices = computeVoices([{ bias_score: 0.5 }, { bias_score: 0.8 }]);
    expect(voices.find(v => v.label === "Oficialista")?.pct).toBe(100);
  });

  it("classifies negative bias as opposition", () => {
    const voices = computeVoices([{ bias_score: -0.5 }]);
    expect(voices.find(v => v.label === "Opositor")?.pct).toBe(100);
  });

  it("classifies near-zero bias as neutral", () => {
    const voices = computeVoices([{ bias_score: 0.05 }]);
    expect(voices.find(v => v.label === "Neutral")?.pct).toBe(100);
  });

  it("treats null bias as neutral", () => {
    const voices = computeVoices([{ bias_score: null }]);
    expect(voices.find(v => v.label === "Neutral")?.pct).toBe(100);
  });

  it("computes percentages from mixed cluster", () => {
    const voices = computeVoices([
      { bias_score: 0.5 },
      { bias_score: 0.5 },
      { bias_score: -0.5 },
      { bias_score: 0 },
    ]);
    const officialist = voices.find(v => v.label === "Oficialista")?.pct ?? 0;
    const opposition = voices.find(v => v.label === "Opositor")?.pct ?? 0;
    const neutral = voices.find(v => v.label === "Neutral")?.pct ?? 0;
    expect(officialist).toBe(50);
    expect(opposition).toBe(25);
    expect(neutral).toBe(25);
  });
});

describe("mapBias", () => {
  it("returns 'Sin datos' for null", () => {
    const r = mapBias(null);
    expect(r.label).toBe("Sin datos");
    expect(r.intensity).toBe(0);
  });

  it("returns strong officialist for >0.5", () => {
    const r = mapBias(0.8);
    expect(r.label).toBe("Fuerte oficialista");
    expect(r.intensity).toBe(5);
  });

  it("returns mild officialist for 0.1-0.5", () => {
    const r = mapBias(0.3);
    expect(r.label).toBe("Oficialista");
  });

  it("returns neutral for -0.1 to 0.1", () => {
    const r = mapBias(0);
    expect(r.label).toBe("Neutral");
  });

  it("returns mild opposition for -0.5 to -0.1", () => {
    const r = mapBias(-0.3);
    expect(r.label).toBe("Opositor");
  });

  it("returns strong opposition for <-0.5", () => {
    const r = mapBias(-0.8);
    expect(r.label).toBe("Fuerte opositor");
    expect(r.intensity).toBe(1);
  });
});

describe("mapCategory", () => {
  it("maps API category to frontend category", () => {
    const cat: ApiCategory = { id: 1, slug: "politica", name: "Política", icon: "gavel" };
    const result = mapCategory(cat);
    expect(result).toEqual({ name: "Política", icon: "gavel", slug: "politica" });
  });

  it("defaults icon to 'grid_view' when missing", () => {
    const cat = { id: 1, slug: "x", name: "X", icon: "" } as unknown as ApiCategory;
    const result = mapCategory(cat);
    expect(result.icon).toBe("grid_view");
  });
});

describe("mapLocation", () => {
  it("maps API location to frontend location", () => {
    const loc: ApiLocation = {
      id: 1,
      name: "Córdoba",
      province: "Córdoba",
      country: "AR",
      type: "ciudad",
      parent_id: null,
      lat: null,
      lng: null,
      population: null,
    };
    const result = mapLocation(loc);
    expect(result).toEqual({
      name: "Córdoba",
      slug: "córdoba",
      icon: "location_on",
    });
  });

  it("uses 'map' icon for province type", () => {
    const loc: ApiLocation = {
      id: 1,
      name: "Buenos Aires",
      province: "BA",
      country: "AR",
      type: "provincia",
      parent_id: null,
      lat: null,
      lng: null,
      population: null,
    };
    expect(mapLocation(loc).icon).toBe("map");
  });

  it("slugifies multi-word names", () => {
    const loc: ApiLocation = {
      id: 1,
      name: "Rio Gallegos",
      province: "SC",
      country: "AR",
      type: "ciudad",
      parent_id: null,
      lat: null,
      lng: null,
      population: null,
    };
    expect(mapLocation(loc).slug).toBe("rio-gallegos");
  });
});

describe("mapNewsCard", () => {
  const baseCard: ApiNewsCard = {
    id: "test-1",
    location_id: 1,
    title: "Dólar sube en el mercado",
    summary: "<p>El dólar subió 5% en la jornada de hoy</p>",
    body: "<p>El dólar subió 5% en la jornada de hoy</p>",
    image_url: "https://example.com/img.jpg",
    bias_score: 0.3,
    is_gacetilla: 0,
    cluster_id: "cluster-1",
    category: "Economía",
    source_ids: "src-1,src-2",
    source_name: "Ámbito",
    source_url: "https://ambito.com",
    location_name: "Córdoba",
    location_province: "CBA",
    published_at: new Date(Date.now() - 3600_000).toISOString(),
    created_at: new Date().toISOString(),
    sources_count: 2,
    quality_score: 0.8,
  };

  it("maps all required fields", () => {
    const result = mapNewsCard(baseCard);
    expect(result.id).toBe("test-1");
    expect(result.title).toBe("Dólar sube en el mercado");
    expect(result.category).toBe("Economía");
    expect(result.source).toBe("Ámbito");
    expect(result.clusterId).toBe("cluster-1");
    expect(result.sourcesCount).toBe(2);
    expect(result.imageUrl).toBe("https://example.com/img.jpg");
  });

  it("uses provided category over extracted one", () => {
    const result = mapNewsCard({ ...baseCard, category: "Política" });
    expect(result.category).toBe("Política");
  });

  it("falls back to source_names[0] when no source_name", () => {
    const card = { ...baseCard, source_name: null, source_names: ["La Nación", "Clarín"] };
    const result = mapNewsCard(card);
    expect(result.source).toBe("La Nación");
  });

  it("falls back to SOURCE_NAMES lookup when no names", () => {
    const card = { ...baseCard, source_name: null, source_names: undefined, source_ids: "src-1,src-2" };
    const result = mapNewsCard(card);
    expect(typeof result.source).toBe("string");
    expect(result.source.length).toBeGreaterThan(0);
  });

  it("uses defaults when source fields are missing", () => {
    const card = { ...baseCard, source_name: null, source_names: undefined, source_ids: null };
    const result = mapNewsCard(card);
    expect(result.source).toBe("Fuente");
  });

  it("formats location with province when both present", () => {
    const result = mapNewsCard(baseCard);
    expect(result.location).toBe("Córdoba, CBA");
  });

  it("uses just location name when no province", () => {
    const card = { ...baseCard, location_province: null };
    const result = mapNewsCard(card);
    expect(result.location).toBe("Córdoba");
  });

  it("deduplicates when name and province are identical", () => {
    // e.g. Córdoba Capital / Córdoba province: "Córdoba, Córdoba" would be noise.
    const card = { ...baseCard, location_province: "Córdoba" };
    const result = mapNewsCard(card);
    expect(result.location).toBe("Córdoba");
  });

  it("returns empty location when no location_name", () => {
    const card = { ...baseCard, location_name: null, location_province: null };
    const result = mapNewsCard(card);
    expect(result.location).toBe("");
  });

  it("marks gacetilla correctly", () => {
    const card = { ...baseCard, is_gacetilla: 1 };
    const result = mapNewsCard(card);
    expect(result.isGacetilla).toBe(true);
    expect(result.gacetillaConf).toBe(70);
  });

  it("uses bias_score gradient color", () => {
    const result = mapNewsCard(baseCard);
    expect(result.biasGradientColor).toMatch(/^rgb/);
  });

  it("returns null biasGradientColor for null bias_score", () => {
    const card = { ...baseCard, bias_score: null };
    const result = mapNewsCard(card);
    expect(result.biasScore).toBeNull();
  });

  it("strips HTML from summary and body", () => {
    const card = {
      ...baseCard,
      summary: "<p>Real <b>content</b></p>",
      body: "<div>Body with <i>html</i></div>",
    };
    const result = mapNewsCard(card);
    expect(result.summary).not.toContain("<");
    expect(result.body).not.toContain("<");
  });

  it("uses summary as body fallback when body is empty", () => {
    const card = { ...baseCard, body: "" };
    const result = mapNewsCard(card);
    expect(result.body.length).toBeGreaterThan(0);
  });

  it("computes publishedAt from published_at with created_at fallback", () => {
    const card = { ...baseCard, published_at: null, created_at: "2026-01-01T00:00:00Z" };
    const result = mapNewsCard(card);
    expect(result.publishedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("extracts h2/h3 headings from body and assigns sequential ids", () => {
    const card = {
      ...baseCard,
      body: "<p>Intro</p><h2>Contexto</h2><p>...</p><h3>Antecedentes</h3><p>...</p><h2>Desarrollo</h2>",
    };
    const result = mapNewsCard(card);
    expect(result.headings).toEqual([
      { level: 2, text: "Contexto", id: "h-0" },
      { level: 3, text: "Antecedentes", id: "h-1" },
      { level: 2, text: "Desarrollo", id: "h-2" },
    ]);
  });

  it("returns empty headings array when body has no h2/h3", () => {
    const card = { ...baseCard, body: "<p>Solo texto sin estructura</p>" };
    const result = mapNewsCard(card);
    expect(result.headings).toEqual([]);
  });

  it("returns empty headings array when body is empty", () => {
    const card = { ...baseCard, body: "" };
    const result = mapNewsCard(card);
    expect(result.headings).toEqual([]);
  });

  it("ignores h1, h4+ and nested tags inside heading text", () => {
    const card = {
      ...baseCard,
      body: "<h1>Título principal</h1><h2>Sección <em>uno</em></h2><h4>Sub-sub</h4><h2>Sección dos</h2>",
    };
    const result = mapNewsCard(card);
    expect(result.headings).toEqual([
      { level: 2, text: "Sección uno", id: "h-0" },
      { level: 2, text: "Sección dos", id: "h-1" },
    ]);
  });
});
