import { describe, it, expect } from "vitest";
import { extractHeadings, type Heading } from "../lib/headings";

describe("extractHeadings", () => {
  it("returns empty array for empty input", () => {
    expect(extractHeadings("")).toEqual([]);
  });

  it("returns empty array for plain text (no h2/h3)", () => {
    expect(extractHeadings("just a paragraph of text")).toEqual([]);
  });

  it("extracts h2 headings with text", () => {
    const html = "<h2>First section</h2><p>body</p><h2>Second section</h2>";
    expect(extractHeadings(html)).toEqual<Heading[]>([
      { level: 2, text: "First section", id: "h-0" },
      { level: 2, text: "Second section", id: "h-1" },
    ]);
  });

  it("extracts h3 headings as a separate level", () => {
    const html = "<h2>Top</h2><h3>Sub one</h3><h3>Sub two</h3>";
    const out = extractHeadings(html);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ level: 2, text: "Top", id: "h-0" });
    expect(out[1]).toEqual({ level: 3, text: "Sub one", id: "h-1" });
    expect(out[2]).toEqual({ level: 3, text: "Sub two", id: "h-2" });
  });

  it("strips nested tags inside heading text", () => {
    const html = '<h2>The <strong>bold</strong> word</h2>';
    const out = extractHeadings(html);
    expect(out[0].text).toBe("The bold word");
  });

  it("ignores empty headings", () => {
    const html = "<h2></h2><h2>Real one</h2>";
    const out = extractHeadings(html);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Real one");
  });

  it("truncates very long heading text (defensive)", () => {
    const long = "a".repeat(300);
    const html = `<h2>${long}</h2>`;
    const out = extractHeadings(html);
    expect(out[0].text.length).toBeLessThanOrEqual(200);
  });

  it("generates stable ids (h-0, h-1, ...) regardless of other tags", () => {
    const html = "<p>intro</p><h2>One</h2><p>more</p><h2>Two</h2>";
    const out = extractHeadings(html);
    expect(out[0].id).toBe("h-0");
    expect(out[1].id).toBe("h-1");
  });

  it("ignores h1 and h4+", () => {
    const html = "<h1>Title</h1><h2>Yes</h2><h4>No</h4><h5>No</h5>";
    const out = extractHeadings(html);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Yes");
  });
});
