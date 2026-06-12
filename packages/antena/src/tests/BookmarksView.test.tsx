import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import BookmarksView from "../components/bookmarks/BookmarksView";
import { createMockNews, mockNavigatorVibrate } from "./helpers";
import { useBookmarks } from "../lib/bookmarks";

vi.mock("../lib/api", async () => {
  return {
    fetchNewsByIds: vi.fn().mockImplementation((ids: string[]) => {
      return Promise.resolve(ids.map((id) => ({
        id,
        location_id: 1,
        title: `Mock ${id}`,
        summary: "summary",
        body: "body",
        image_url: null,
        bias_score: 0,
        is_gacetilla: 0,
        cluster_id: null,
        category: "Generales",
        source_ids: "src-1",
        source_name: "Mock",
        source_url: null,
        location_name: null,
        location_province: null,
        published_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        sources_count: 1,
        quality_score: 0.5,
      })));
    }),
  };
});

afterEach(cleanup);

describe("BookmarksView", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
    mockNavigatorVibrate();
  });

  it("shows empty state when no bookmarks", () => {
    const { getByText } = render(() => (
      <BookmarksView onBack={() => {}} onNewsClick={() => {}} />
    ));
    expect(getByText("No tenes noticias guardadas")).toBeInTheDocument();
  });

  it("renders header with count", () => {
    const { getByText } = render(() => (
      <BookmarksView onBack={() => {}} onNewsClick={() => {}} />
    ));
    expect(getByText("Guardados (0)")).toBeInTheDocument();
  });

  it("renders Limpiar button when bookmarks exist", () => {
    const bookmarks = ["a", "b"];
    localStorage.setItem("antena-bookmarks", JSON.stringify(bookmarks));

    const { getByText } = render(() => (
      <BookmarksView onBack={() => {}} onNewsClick={() => {}} />
    ));
    expect(getByText("Limpiar")).toBeInTheDocument();
  });

  it("calls onBack when back button is clicked", () => {
    const onBack = vi.fn();
    const { getByLabelText } = render(() => (
      <BookmarksView onBack={onBack} onNewsClick={() => {}} />
    ));
    fireEvent.click(getByLabelText("Volver"));
    expect(onBack).toHaveBeenCalled();
  });

  it("renders bookmark count in header", () => {
    const bookmarks = ["a", "b", "c"];
    localStorage.setItem("antena-bookmarks", JSON.stringify(bookmarks));

    const { getByText } = render(() => (
      <BookmarksView onBack={() => {}} onNewsClick={() => {}} />
    ));
    expect(getByText("Guardados (3)")).toBeInTheDocument();
  });
});

describe("useBookmarks", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
    mockNavigatorVibrate();
  });

  it("returns empty bookmarks initially", () => {
    const { bookmarks } = useBookmarks();
    expect(bookmarks()).toEqual([]);
  });

  it("loads existing bookmarks from localStorage", () => {
    localStorage.setItem("antena-bookmarks", JSON.stringify(["x", "y"]));
    const { bookmarks } = useBookmarks();
    expect(bookmarks()).toEqual(["x", "y"]);
  });

  it("toggleBookmark adds and removes", () => {
    const { bookmarks, toggleBookmark, isBookmarked } = useBookmarks();
    toggleBookmark("a");
    expect(bookmarks()).toContain("a");
    expect(isBookmarked("a")).toBe(true);
    toggleBookmark("a");
    expect(bookmarks()).not.toContain("a");
    expect(isBookmarked("a")).toBe(false);
  });

  it("removeBookmark removes without adding", () => {
    const { bookmarks, toggleBookmark, removeBookmark } = useBookmarks();
    toggleBookmark("a");
    removeBookmark("a");
    expect(bookmarks()).not.toContain("a");
  });

  it("clearBookmarks empties the list", () => {
    const { bookmarks, toggleBookmark, clearBookmarks } = useBookmarks();
    toggleBookmark("a");
    toggleBookmark("b");
    clearBookmarks();
    expect(bookmarks()).toEqual([]);
  });
});
