import { describe, expect, it } from "vitest";
import { sanitizeCard } from "../lib/d1";
import type { NewsCard } from "../lib/types";

function makeCard(overrides: Partial<NewsCard>): NewsCard {
  return {
    id: "id-1",
    location_id: null,
    title: "Test title",
    summary: "",
    body: null,
    image_url: null,
    bias_score: null,
    is_gacetilla: 0,
    cluster_id: null,
    category: null,
    source_ids: null,
    ...overrides,
  } as NewsCard;
}

describe("sanitizeCard", () => {
  it("strips HTML from summary", () => {
    const result = sanitizeCard(
      makeCard({
        summary: '<p><img alt="foo" /></p><div class="subtitles"><p class="subtitle">Real lede goes here and has enough text to count as a real summary.</p></div>',
      })
    );
    expect(result.summary).not.toContain("<");
    expect(result.summary).toContain("Real lede");
  });

  it("preserves original HTML as summary_html", () => {
    const html = '<p><img src="x.jpg" /></p><p>Body of the article.</p>';
    const result = sanitizeCard(makeCard({ summary: html }));
    expect(result.summary_html).toBe(html);
  });

  it("strips HTML from title", () => {
    const result = sanitizeCard(makeCard({ title: "Hello <b>world</b>" }));
    expect(result.title).toBe("Hello world");
  });

  it("falls back to body when summary is short and body is longer", () => {
    const longBody = "This is a much longer body of text. ".repeat(40);
    const result = sanitizeCard(
      makeCard({ summary: "Short.", body: longBody })
    );
    expect(result.summary.length).toBeGreaterThan(200);
    expect(result.summary).toContain("longer body");
  });

  it("keeps summary when body fallback conditions are not met", () => {
    const result = sanitizeCard(
      makeCard({
        summary: "This is a perfectly fine summary with about two hundred characters of content that explains the news in plain terms.",
        body: null,
      })
    );
    expect(result.summary).toContain("perfectly fine summary");
  });

  it("removes social link brackets", () => {
    const result = sanitizeCard(
      makeCard({
        summary: 'The story continues. [Facebook](https://facebook.com/x) More story text follows after the link that should disappear entirely.',
      })
    );
    expect(result.summary).not.toContain("Facebook");
    expect(result.summary).not.toContain("https://");
  });

  it("truncates at 'The post' footer", () => {
    const result = sanitizeCard(
      makeCard({
        summary: "Real lede paragraph with enough text. The post appeared first on Some Site.",
      })
    );
    expect(result.summary).not.toContain("The post");
    expect(result.summary).toContain("Real lede");
  });

  it("handles null body", () => {
    const result = sanitizeCard(
      makeCard({ summary: "Just a summary.", body: null })
    );
    expect(result.body).toBe("");
  });
});
