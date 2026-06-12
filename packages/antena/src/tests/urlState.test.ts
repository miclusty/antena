import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseURLState, updateURL, clearURL } from "../lib/urlState";

describe("parseURLState", () => {
  it("returns nulls on server (no window)", () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", { value: undefined, configurable: true });
    const result = parseURLState();
    expect(result).toEqual({
      category: null,
      locationId: null,
      view: null,
      articleId: null,
    });
    Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
  });

  it("parses all params from URL", () => {
    window.history.pushState({}, "", "/?cat=politica&loc=1&view=menu&id=abc");
    const result = parseURLState();
    expect(result.category).toBe("politica");
    expect(result.locationId).toBe("1");
    expect(result.view).toBe("menu");
    expect(result.articleId).toBe("abc");
  });

  it("returns nulls for missing params", () => {
    window.history.pushState({}, "", "/");
    const result = parseURLState();
    expect(result.category).toBeNull();
    expect(result.locationId).toBeNull();
    expect(result.view).toBeNull();
    expect(result.articleId).toBeNull();
  });

  it("parses only category", () => {
    window.history.pushState({}, "", "/?cat=economia");
    const result = parseURLState();
    expect(result.category).toBe("economia");
    expect(result.locationId).toBeNull();
  });

  it("handles empty param values", () => {
    window.history.pushState({}, "", "/?cat=&loc=");
    const result = parseURLState();
    expect(result.category).toBe("");
    expect(result.locationId).toBe("");
  });
});

describe("updateURL", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("adds new params to URL", () => {
    updateURL({ cat: "politica" });
    expect(window.location.search).toBe("?cat=politica");
  });

  it("updates existing params", () => {
    window.history.pushState({}, "", "/?cat=economia");
    updateURL({ cat: "deportes" });
    expect(window.location.search).toBe("?cat=deportes");
  });

  it("removes params when value is null", () => {
    window.history.pushState({}, "", "/?cat=politica&loc=1");
    updateURL({ cat: null });
    expect(window.location.search).toBe("?loc=1");
  });

  it("removes params when value is empty string", () => {
    window.history.pushState({}, "", "/?cat=politica");
    updateURL({ cat: "" });
    expect(window.location.search).toBe("");
  });

  it("preserves pathname when updating", () => {
    window.history.pushState({}, "", "/noticia/123?view=feed");
    updateURL({ view: "menu" });
    expect(window.location.pathname).toBe("/noticia/123");
    expect(window.location.search).toBe("?view=menu");
  });

  it("handles multiple params at once", () => {
    updateURL({ cat: "politica", loc: "1", view: "menu" });
    expect(window.location.search).toContain("cat=politica");
    expect(window.location.search).toContain("loc=1");
    expect(window.location.search).toContain("view=menu");
  });

  it("uses pushState (does not replace)", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    updateURL({ cat: "x" });
    expect(pushStateSpy).toHaveBeenCalled();
  });
});

describe("clearURL", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/noticia/123?cat=politica&loc=1");
  });

  it("removes all query params but keeps pathname", () => {
    clearURL();
    expect(window.location.pathname).toBe("/noticia/123");
    expect(window.location.search).toBe("");
  });

  it("uses pushState", () => {
    const pushStateSpy = vi.spyOn(window.history, "pushState");
    clearURL();
    expect(pushStateSpy).toHaveBeenCalled();
  });
});
