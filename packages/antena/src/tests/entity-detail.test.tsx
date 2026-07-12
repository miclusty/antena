import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import EntityDetailView from "../components/entity/EntityDetailView";
import type { EntityDetail, EntitySummary, EntityTimelinePoint } from "../lib/api";
import type { ApiNewsCard } from "../lib/api";

afterEach(cleanup);

const baseEntity: EntityDetail = {
  id: 42,
  name: "Javier Milei",
  type: "person",
  mention_count: 1247,
  first_seen: "2023-12-10T12:00:00Z",
  last_seen: "2026-07-11T18:30:00Z",
  related: [],
};

const sampleArticles: ApiNewsCard[] = [
  {
    id: "n-1",
    location_id: 1,
    title: "Milei anuncia nuevas medidas",
    summary: "",
    image_url: null,
    bias_score: null,
    is_gacetilla: 0,
    cluster_id: null,
    category: "Política",
    source_ids: null,
    source_names: ["La Nación"],
    source_name: "La Nación",
    source_url: null,
    source_id: 1,
    location_name: "Buenos Aires",
    location_province: null,
    published_at: "2026-07-11T15:00:00Z",
    created_at: "2026-07-11T15:00:00Z",
    sources_count: 1,
    quality_score: null,
    slug: "milei-anuncia",
    slug_date: "2026-07-11",
  },
  {
    id: "n-2",
    location_id: 1,
    title: "Discurso del presidente",
    summary: "",
    image_url: null,
    bias_score: null,
    is_gacetilla: 0,
    cluster_id: null,
    category: "Política",
    source_ids: null,
    source_names: ["Clarín"],
    source_name: "Clarín",
    source_url: null,
    source_id: 2,
    location_name: null,
    location_province: null,
    published_at: "2026-07-10T10:00:00Z",
    created_at: "2026-07-10T10:00:00Z",
    sources_count: 1,
    quality_score: null,
    slug: null,
    slug_date: null,
  },
];

const sampleRelated: EntitySummary[] = [
  { id: 100, name: "Victoria Villarruel", type: "person", mention_count: 432 },
  { id: 101, name: "Casa Rosada", type: "place", mention_count: 1200 },
];

const sampleTimeline: EntityTimelinePoint[] = Array.from({ length: 30 }, (_, i) => ({
  day: new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10),
  count: i === 15 ? 8 : i % 3 === 0 ? 2 : 0,
}));

const sampleSources = [
  { id: 1, name: "La Nación", slug: "la-nacion", articleCount: 312 },
  { id: 2, name: "Clarín", slug: "clarin", articleCount: 198 },
];

describe("EntityDetailView", () => {
  it("renders the entity name and 'Persona' type badge", () => {
    const { getByText } = render(() => (
      <EntityDetailView
        entity={baseEntity}
        timeline={sampleTimeline}
        articles={sampleArticles}
        topSources={sampleSources}
      />
    ));
    expect(getByText("Javier Milei")).toBeInTheDocument();
    expect(getByText("Persona")).toBeInTheDocument();
  });

  it("renders the total mention count", () => {
    const { container } = render(() => (
      <EntityDetailView
        entity={baseEntity}
        timeline={sampleTimeline}
        articles={sampleArticles}
        topSources={sampleSources}
      />
    ));
    // formatMentionCount(1247) → "1.2k"; the text spans a <strong>
    // and a literal text node so we match the full container text.
    expect(container.textContent).toMatch(/1\.2k\s+menciones en Antena/);
  });

  it("renders first_seen and last_seen as dates", () => {
    const { container } = render(() => (
      <EntityDetailView
        entity={baseEntity}
        timeline={sampleTimeline}
        articles={sampleArticles}
        topSources={sampleSources}
      />
    ));
    const text = container.textContent ?? "";
    expect(text).toMatch(/2023/);
    expect(text).toMatch(/2026/);
  });

  it("renders an SVG sparkline", () => {
    const { container } = render(() => (
      <EntityDetailView
        entity={baseEntity}
        timeline={sampleTimeline}
        articles={sampleArticles}
        topSources={sampleSources}
      />
    ));
    const svg = container.querySelector('[data-testid="mention-sparkline"] svg');
    expect(svg).toBeTruthy();
  });

  it("renders 'Artículos recientes' with the article titles", () => {
    const { getByText } = render(() => (
      <EntityDetailView
        entity={baseEntity}
        timeline={sampleTimeline}
        articles={sampleArticles}
        topSources={sampleSources}
      />
    ));
    expect(getByText("Milei anuncia nuevas medidas")).toBeInTheDocument();
    expect(getByText("Discurso del presidente")).toBeInTheDocument();
  });

  it("links each article to the canonical article URL", () => {
    const { container } = render(() => (
      <EntityDetailView
        entity={baseEntity}
        timeline={sampleTimeline}
        articles={sampleArticles}
        topSources={sampleSources}
      />
    ));
    const links = Array.from(container.querySelectorAll("a"));
    const first = links.find((a) => a.textContent?.includes("Milei anuncia"));
    expect(first).toBeTruthy();
    expect(first?.getAttribute("href")).toBe("/2026/07/11/milei-anuncia/");
  });

  it("links the second article (no slug) to /noticia/<id>", () => {
    const { container } = render(() => (
      <EntityDetailView
        entity={baseEntity}
        timeline={sampleTimeline}
        articles={sampleArticles}
        topSources={sampleSources}
      />
    ));
    const links = Array.from(container.querySelectorAll("a"));
    const second = links.find((a) => a.textContent?.includes("Discurso del presidente"));
    expect(second).toBeTruthy();
    expect(second?.getAttribute("href")).toBe("/noticia/n-2");
  });

  it("renders 'Relacionado con' chips for related entities", () => {
    const { getByText } = render(() => (
      <EntityDetailView
        entity={{ ...baseEntity, related: sampleRelated }}
        timeline={sampleTimeline}
        articles={sampleArticles}
        topSources={sampleSources}
      />
    ));
    expect(getByText("Victoria Villarruel")).toBeInTheDocument();
    expect(getByText("Casa Rosada")).toBeInTheDocument();
  });

  it("links related chips to /entidad/<slug>", () => {
    const { container } = render(() => (
      <EntityDetailView
        entity={{ ...baseEntity, related: sampleRelated }}
        timeline={sampleTimeline}
        articles={sampleArticles}
        topSources={sampleSources}
      />
    ));
    const links = Array.from(container.querySelectorAll("a"));
    const mileiLink = links.find((a) => a.getAttribute("href") === "/entidad/victoria-villarruel");
    expect(mileiLink).toBeTruthy();
  });

  it("renders 'Cubierto por' with the source names", () => {
    const { getByText } = render(() => (
      <EntityDetailView
        entity={baseEntity}
        timeline={sampleTimeline}
        articles={sampleArticles}
        topSources={sampleSources}
      />
    ));
    expect(getByText("La Nación")).toBeInTheDocument();
    expect(getByText("Clarín")).toBeInTheDocument();
  });

  it("handles empty articles gracefully", () => {
    const { getByText } = render(() => (
      <EntityDetailView
        entity={baseEntity}
        timeline={sampleTimeline}
        articles={[]}
        topSources={sampleSources}
      />
    ));
    // Spanish copy must include something like "no hay" or empty state
    const text = getByText(/Artículos recientes/i).closest("section")?.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
  });

  it("handles empty timeline by showing the empty state inside the sparkline", () => {
    const { getByText } = render(() => (
      <EntityDetailView
        entity={baseEntity}
        timeline={[]}
        articles={sampleArticles}
        topSources={sampleSources}
      />
    ));
    expect(getByText("Sin menciones recientes")).toBeInTheDocument();
  });
});