import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@solidjs/testing-library";
import ArticleDetail from "../components/article/ArticleDetail";
import { trackArticleComplete } from "../lib/analytics";
import { createMockNews, mockNavigatorClipboard, mockNavigatorShare, mockNavigatorVibrate } from "./helpers";

vi.mock("../lib/api", () => ({
  fetchNewsByCluster: vi.fn().mockResolvedValue({
    cluster_id: "cluster-1",
    news: [
      {
        id: "n2",
        location_id: 1,
        title: "Otra voz",
        summary: "Resumen",
        body: "Cuerpo",
        image_url: null,
        bias_score: 0,
        is_gacetilla: 0,
        cluster_id: "cluster-1",
        category: "Política",
        source_ids: "1",
        source_name: "Fuente",
        source_url: "https://example.com",
        location_name: "Córdoba",
        location_province: "Córdoba",
        published_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        sources_count: 2,
      },
      {
        id: "n3",
        location_id: 1,
        title: "Tercera voz",
        summary: "Resumen",
        body: "Cuerpo",
        image_url: null,
        bias_score: 0,
        is_gacetilla: 0,
        cluster_id: "cluster-1",
        category: "Política",
        source_ids: "1",
        source_name: "Fuente",
        source_url: "https://example.com",
        location_name: "Córdoba",
        location_province: "Córdoba",
        published_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        sources_count: 2,
      },
    ],
  }),
  fetchMasterArticle: vi.fn().mockResolvedValue(null),
  fetchFeedback: vi.fn().mockResolvedValue(null),
  fetchReport: vi.fn().mockResolvedValue(true),
}));

const dispatchTouch = (el: Element, type: string, touches: Record<string, unknown>) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(touches)) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  el.dispatchEvent(event);
};

afterEach(cleanup);

describe("ArticleDetail smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigatorVibrate();
    mockNavigatorShare();
    mockNavigatorClipboard();
  });

  it("renders the article reading path", () => {
    const news = createMockNews({ title: "Título móvil", body: "Texto de la nota" });
    const { getByText } = render(() => <ArticleDetail news={news} onBack={() => {}} />);
    expect(getByText("Título móvil")).toBeInTheDocument();
    expect(getByText("Texto de la nota")).toBeInTheDocument();
    expect(getByText("Desglose de Voces")).toBeInTheDocument();
  });

  it("eager-loads the article hero image for LCP", () => {
    const news = createMockNews({ imageUrl: "https://example.com/hero.jpg" });
    const { container } = render(() => <ArticleDetail news={news} onBack={() => {}} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("loading")).toBe("eager");
    expect(img?.getAttribute("fetchpriority")).toBe("high");
  });

  it("lets iOS edge-swipe back pass through", async () => {
    const onArticleSelect = vi.fn();
    const { container, getByText } = render(() => <ArticleDetail news={createMockNews({ id: "n1" })} onBack={() => {}} onArticleSelect={onArticleSelect} />);
    await waitFor(() => expect(getByText("2 coberturas más")).toBeInTheDocument());
    const root = container.firstElementChild as HTMLElement;
    dispatchTouch(root, "touchstart", { touches: [{ clientX: 10, clientY: 80 }] });
    dispatchTouch(root, "touchend", { changedTouches: [{ clientX: 90, clientY: 82 }] });
    expect(onArticleSelect).not.toHaveBeenCalled();
  });

  it("tracks article completion only after 75 percent scroll", () => {
    const complete = vi.mocked(trackArticleComplete);
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 740 });
    render(() => <ArticleDetail news={createMockNews({ id: "n1" })} onBack={() => {}} />);
    window.dispatchEvent(new Event("scroll"));
    expect(complete).not.toHaveBeenCalled();
    Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: 760 });
    window.dispatchEvent(new Event("scroll"));
    expect(complete).toHaveBeenCalledWith("n1", expect.any(Number), 76);
  });
});
