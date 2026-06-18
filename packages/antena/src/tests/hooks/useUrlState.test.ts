/** @jsxImportSource solid-js */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "solid-js";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    fetchNewsById: vi.fn(),
  };
});

vi.mock("../../lib/urlState", () => ({
  parseURLState: vi.fn(() => ({ category: "Todas", locationId: null, view: "feed", articleId: null })),
  pushPath: vi.fn(),
  updateURL: vi.fn(),
  clearURL: vi.fn(),
  articleCanonicalPath: vi.fn(() => "/2026/06/11/foo/"),
}));

vi.mock("../../lib/scroll", () => ({
  saveScrollPos: vi.fn(),
  restoreScrollPos: vi.fn(),
  markAsRead: vi.fn(),
}));

vi.mock("../../components/Toast", () => ({
  toast: vi.fn(),
}));

vi.mock("../../lib/mappers", () => ({
  mapNewsCard: vi.fn((c: { id: string; title?: string; summary?: string; body?: string; cluster_id?: string }) => ({
    id: c.id,
    title: c.title ?? "Mock",
    summary: c.summary ?? "",
    body: c.body ?? "",
    clusterId: c.cluster_id ?? "",
  })),
}));

import { fetchNewsById } from "../../lib/api";
import { parseURLState, pushPath, updateURL, clearURL, articleCanonicalPath } from "../../lib/urlState";
import { useUrlState } from "../../hooks/useUrlState";
import { createMockNews } from "../helpers";

describe("useUrlState", () => {
  beforeEach(() => {
    vi.mocked(parseURLState).mockReturnValue({ category: "Todas", locationId: null, view: "feed", articleId: null });
    vi.mocked(fetchNewsById).mockReset();
    vi.mocked(pushPath).mockReset();
    vi.mocked(updateURL).mockReset();
    vi.mocked(clearURL).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes currentView, selectedId, selectedNews, and 4 handlers", () => {
    createRoot((dispose) => {
      const nav = useUrlState();
      expect(nav.currentView()).toBe("feed");
      expect(nav.selectedId()).toBeNull();
      expect(nav.selectedNews()).toBeNull();
      expect(typeof nav.handleViewChange).toBe("function");
      expect(typeof nav.handleNewsClick).toBe("function");
      expect(typeof nav.handleBack).toBe("function");
      expect(typeof nav.loadArticleFromId).toBe("function");
      dispose();
    });
  });

  it("handleViewChange('feed') clears selection and restores scroll", async () => {
    const { restoreScrollPos } = await import("../../lib/scroll");
    await createRoot(async (dispose) => {
      const nav = useUrlState();
      nav.handleViewChange("bookmarks");
      expect(nav.currentView()).toBe("bookmarks");
      nav.handleViewChange("feed");
      expect(nav.currentView()).toBe("feed");
      expect(nav.selectedId()).toBeNull();
      expect(nav.selectedNews()).toBeNull();
      expect(vi.mocked(restoreScrollPos)).toHaveBeenCalled();
      dispose();
    });
  });

  it("handleNewsClick saves scroll, loads article, and pushes canonical URL", async () => {
    vi.mocked(fetchNewsById).mockResolvedValue({
      id: "x",
      title: "X",
      summary: "S",
      body: "B",
      cluster_id: "c-1",
    } as never);
    const { saveScrollPos } = await import("../../lib/scroll");
    await createRoot(async (dispose) => {
      const nav = useUrlState();
      const news = createMockNews({ id: "x", slug: "foo", slugDate: "2026-06-11" });
      await nav.handleNewsClick(news);
      expect(vi.mocked(saveScrollPos)).toHaveBeenCalled();
      expect(vi.mocked(articleCanonicalPath)).toHaveBeenCalledWith("foo", "2026-06-11", "x");
      expect(vi.mocked(pushPath)).toHaveBeenCalledWith("/2026/06/11/foo/");
      expect(nav.currentView()).toBe("article");
      expect(nav.selectedId()).toBe("x");
      dispose();
    });
  });

  it("handleBack clears selection, switches to feed, restores scroll, clears URL", async () => {
    const { restoreScrollPos } = await import("../../lib/scroll");
    await createRoot(async (dispose) => {
      const nav = useUrlState();
      vi.mocked(fetchNewsById).mockResolvedValue({ id: "x", title: "X", summary: "", body: "" } as never);
      await nav.loadArticleFromId("x");
      nav.handleBack();
      expect(nav.currentView()).toBe("feed");
      expect(nav.selectedId()).toBeNull();
      expect(nav.selectedNews()).toBeNull();
      expect(vi.mocked(restoreScrollPos)).toHaveBeenCalled();
      expect(vi.mocked(clearURL)).toHaveBeenCalled();
      dispose();
    });
  });

  it("loadArticleFromId sets selectedId, sets currentView=article, stores selectedNews on success", async () => {
    vi.mocked(fetchNewsById).mockResolvedValue({
      id: "abc",
      title: "Title",
      summary: "S",
      body: "B",
    } as never);
    await createRoot(async (dispose) => {
      const nav = useUrlState();
      await nav.loadArticleFromId("abc");
      expect(nav.selectedId()).toBe("abc");
      expect(nav.currentView()).toBe("article");
      expect(nav.selectedNews()?.id).toBe("abc");
      dispose();
    });
  });

  it("loadArticleFromId calls handleBack and shows toast on fetch failure", async () => {
    vi.mocked(fetchNewsById).mockResolvedValue(null);
    const { toast } = await import("../../components/Toast");
    await createRoot(async (dispose) => {
      const nav = useUrlState();
      await nav.loadArticleFromId("missing");
      expect(vi.mocked(toast)).toHaveBeenCalledWith("No se pudo cargar la noticia", "error");
      expect(nav.currentView()).toBe("feed");
      dispose();
    });
  });

  it("parseURLState on mount: article view loads the article, category/location update signals", async () => {
    vi.mocked(parseURLState).mockReturnValue({
      view: "article",
      articleId: "art-1",
      category: "Política",
      locationId: "5",
    });
    vi.mocked(fetchNewsById).mockResolvedValue({ id: "art-1", title: "T", summary: "S", body: "B" } as never);
    await createRoot(async (dispose) => {
      const nav = useUrlState({
        activeCategory: () => "Todas",
        setActiveCategory: vi.fn(),
        activeLocation: () => null,
        setActiveLocation: vi.fn(),
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(vi.mocked(fetchNewsById)).toHaveBeenCalledWith("art-1");
      dispose();
    });
  });
});
