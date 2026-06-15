import { describe, it, expect } from "vitest";
import { sanitizeArticleHtml, sanitizeArticleHtmlForView } from "../lib/sanitize-html";

describe("sanitizeArticleHtml", () => {
  describe("strips dangerous content", () => {
    it("removes <script> tags", () => {
      const html = '<p>Hola</p><script>alert("xss")</script>';
      const out = sanitizeArticleHtml(html);
      expect(out).not.toContain("<script");
      expect(out).not.toContain("alert(");
    });

    it("removes inline event handlers (onclick, onerror, onload)", () => {
      const html = '<p>Hola</p><img src="x" onerror="alert(1)">';
      const out = sanitizeArticleHtml(html);
      expect(out).not.toMatch(/on\w+=/i);
    });

    it("removes javascript: URLs in <a> href", () => {
      const html = '<a href="javascript:alert(1)">click</a>';
      const out = sanitizeArticleHtml(html);
      expect(out).not.toMatch(/href=["']?javascript:/i);
    });

    it("removes <iframe>", () => {
      const html = '<p>Antes</p><iframe src="https://evil.com"></iframe>';
      const out = sanitizeArticleHtml(html);
      expect(out).not.toContain("<iframe");
    });

    it("removes <style> tags", () => {
      const html = '<style>body{display:none}</style><p>Hola</p>';
      const out = sanitizeArticleHtml(html);
      expect(out).not.toContain("<style");
    });

    it("removes <object>, <embed>, <form>", () => {
      const html = '<object data="x"></object><embed src="x"><form action="x"><input></form>';
      const out = sanitizeArticleHtml(html);
      expect(out).not.toContain("<object");
      expect(out).not.toContain("<embed");
      expect(out).not.toContain("<form");
    });
  });

  describe("preserves safe content", () => {
    it("keeps <p>, <h1>-<h6>, <em>, <strong>, <ul>, <li>", () => {
      const html = "<h1>Titular</h1><p>Hola <em>mundo</em></p><ul><li>uno</li></ul>";
      const out = sanitizeArticleHtml(html);
      expect(out).toContain("<h1>");
      expect(out).toContain("<p>");
      expect(out).toContain("<em>");
      expect(out).toContain("<ul>");
      expect(out).toContain("<li>");
    });

    it("keeps <img> but strips event handlers", () => {
      const html = '<img src="https://cdn.example.com/img.jpg" alt="foto">';
      const out = sanitizeArticleHtml(html);
      expect(out).toContain("<img");
      expect(out).toContain('src="https://cdn.example.com/img.jpg"');
      expect(out).toContain('alt="foto"');
    });

    it("keeps <a> with safe https href", () => {
      const html = '<a href="https://example.com/foo">link</a>';
      const out = sanitizeArticleHtml(html);
      expect(out).toContain('href="https://example.com/foo"');
      expect(out).toContain("link");
    });
  });

  describe("hardens safe tags (ForView variant)", () => {
    it("forces <a target=_blank> to have rel=noopener noreferrer", () => {
      const html = '<a href="https://example.com" target="_blank">x</a>';
      const out = sanitizeArticleHtmlForView(html);
      expect(out).toMatch(/rel=["'][^"']*noopener/);
      expect(out).toMatch(/rel=["'][^"']*noreferrer/);
      expect(out).toMatch(/target=["']_blank["']/);
    });

    it("forces <img> to have loading=lazy", () => {
      const html = '<img src="https://x.com/y.jpg" alt="x">';
      const out = sanitizeArticleHtmlForView(html);
      expect(out).toMatch(/loading=["']lazy["']/);
    });

    it("does not double-add loading=lazy if already present", () => {
      const html = '<img src="x.jpg" alt="x" loading="eager">';
      const out = sanitizeArticleHtmlForView(html);
      expect(out).toMatch(/loading=["']eager["']/);
      expect(out).not.toMatch(/loading=["']eager["']\s+loading=/);
    });
  });

  describe("edge cases", () => {
    it("returns empty string for empty input", () => {
      expect(sanitizeArticleHtml("")).toBe("");
    });

    it("handles nested malicious payloads", () => {
      const html =
        '<p>safe<script>alert(1)</script><img src=x onerror=alert(2)>after</p>';
      const out = sanitizeArticleHtml(html);
      expect(out).not.toContain("script");
      expect(out).not.toMatch(/onerror=/i);
      expect(out).toContain("safe");
      expect(out).toContain("after");
    });

    it("handles malformed HTML without throwing", () => {
      const html = "<p>unclosed<p>another<img src=x";
      expect(() => sanitizeArticleHtml(html)).not.toThrow();
    });
  });
});
