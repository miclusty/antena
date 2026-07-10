import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@solidjs/testing-library";
import ArticleDetail from "../components/article/ArticleDetail";
import { createMockNews, mockNavigatorVibrate, mockNavigatorShare, mockNavigatorClipboard } from "./helpers";

vi.mock("../lib/api", async () => {
  return {
    fetchNewsByCluster: vi.fn().mockResolvedValue({
      cluster_id: "cluster-1",
      news: [],
    }),
    fetchMasterArticle: vi.fn().mockResolvedValue(null),
  };
});

afterEach(cleanup);

describe("ArticleDetail", () => {
  beforeEach(() => {
    mockNavigatorVibrate();
    mockNavigatorShare();
    mockNavigatorClipboard();
  });

  it("renders article title", () => {
    const news = createMockNews({ title: "Headline" });
    const { getByText } = render(() => (
      <ArticleDetail news={news} onBack={() => {}} />
    ));
    expect(getByText("Headline")).toBeInTheDocument();
  });

  it("renders article source", () => {
    const news = createMockNews({ source: "La Nación" });
    const { getByText } = render(() => (
      <ArticleDetail news={news} onBack={() => {}} />
    ));
    expect(getByText("La Nación")).toBeInTheDocument();
  });

  it("renders article body", () => {
    const news = createMockNews({ body: "Body content here" });
    const { container } = render(() => (
      <ArticleDetail news={news} onBack={() => {}} />
    ));
    expect(container.textContent).toContain("Body content here");
  });

  it("renders 'Leer en fuente original' link when sourceUrl present", () => {
    const news = createMockNews({ sourceUrl: "https://example.com/article" });
    const { getByText } = render(() => (
      <ArticleDetail news={news} onBack={() => {}} />
    ));
    const link = getByText("Leer en fuente original").closest("a");
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toBe("https://example.com/article");
  });

  it("does not render 'Leer en fuente original' when sourceUrl missing", () => {
    const news = createMockNews({ sourceUrl: undefined });
    const { queryByText } = render(() => (
      <ArticleDetail news={news} onBack={() => {}} />
    ));
    expect(queryByText("Leer en fuente original")).toBeNull();
  });

  it("calls onBack when back button is clicked", () => {
    const onBack = vi.fn();
    const news = createMockNews();
    const { getByLabelText } = render(() => (
      <ArticleDetail news={news} onBack={onBack} />
    ));
    fireEvent.click(getByLabelText("Volver"));
    expect(onBack).toHaveBeenCalled();
  });

  it("renders 'Comunicado Oficial' badge when isGacetilla", () => {
    const news = createMockNews({ isGacetilla: true });
    const { getByText } = render(() => (
      <ArticleDetail news={news} onBack={() => {}} />
    ));
    expect(getByText("Comunicado Oficial")).toBeInTheDocument();
  });

  it("renders 'Ruido Filtrado' badge when isClickbait", () => {
    const news = createMockNews({ isClickbait: true, clickbaitAnswer: "No really" });
    const { getAllByText, container } = render(() => (
      <ArticleDetail news={news} onBack={() => {}} />
    ));
    // The text appears in both the badge and the answer section
    expect(getAllByText("Ruido Filtrado").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("No really");
  });

  it("renders Modo lectura button", () => {
    const news = createMockNews();
    const { getAllByLabelText } = render(() => (
      <ArticleDetail news={news} onBack={() => {}} />
    ));
    // The article view has two Modo lectura affordances
    // (the header pill + the bottom bar button). The test
    // only asserts that at least one is present.
    expect(getAllByLabelText("Modo lectura").length).toBeGreaterThan(0);
  });

  it("renders reading time", () => {
    const news = createMockNews({ body: "word ".repeat(400) });
    const { getAllByText } = render(() => (
      <ArticleDetail news={news} onBack={() => {}} />
    ));
    expect(getAllByText(/\d+ min de lectura/).length).toBeGreaterThan(0);
  });

  it("renders signal gauge bars (10 of them)", () => {
    const news = createMockNews({ signalLevel: 7 });
    const { container } = render(() => (
      <ArticleDetail news={news} onBack={() => {}} />
    ));
    const bars = container.querySelectorAll("section div.h-12 > div");
    expect(bars.length).toBe(10);
  });
});
