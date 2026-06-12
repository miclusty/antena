import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import BottomNav, { type TabId } from "../components/common/BottomNav";
import { mockNavigatorVibrate } from "./helpers";

describe("BottomNav", () => {
  beforeEach(() => {
    mockNavigatorVibrate();
  });

  it("renders all 4 tabs", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(() => (
      <BottomNav activeTab="home" onTabChange={onChange} />
    ));
    expect(getByLabelText("Inicio")).toBeInTheDocument();
    expect(getByLabelText("Buscar")).toBeInTheDocument();
    expect(getByLabelText("Guardados")).toBeInTheDocument();
    expect(getByLabelText("Menú")).toBeInTheDocument();
  });

  it("marks active tab with aria-current='page'", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(() => (
      <BottomNav activeTab="search" onTabChange={onChange} />
    ));
    expect(getByLabelText("Buscar")).toHaveAttribute("aria-current", "page");
    expect(getByLabelText("Inicio")).not.toHaveAttribute("aria-current");
  });

  it("calls onTabChange with the correct tab id on click", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(() => (
      <BottomNav activeTab="home" onTabChange={onChange} />
    ));
    fireEvent.click(getByLabelText("Guardados"));
    expect(onChange).toHaveBeenCalledWith("bookmarks");

    fireEvent.click(getByLabelText("Menú"));
    expect(onChange).toHaveBeenCalledWith("menu");

    fireEvent.click(getByLabelText("Buscar"));
    expect(onChange).toHaveBeenCalledWith("search");
  });

  it("applies active styling (fill icon) only to active tab", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(() => (
      <BottomNav activeTab="bookmarks" onTabChange={onChange} />
    ));
    const bookmarksIcon = getByLabelText("Guardados").querySelector("span");
    const homeIcon = getByLabelText("Inicio").querySelector("span");
    expect(bookmarksIcon?.getAttribute("style")).toContain("'FILL' 1");
    expect(homeIcon?.getAttribute("style")).toContain("'FILL' 0");
  });

  it("supports all 4 TabId values", () => {
    const tabs: TabId[] = ["home", "search", "bookmarks", "menu"];
    for (const tab of tabs) {
      cleanup();
      const onChange = vi.fn();
      const { getByLabelText } = render(() => (
        <BottomNav activeTab={tab} onTabChange={onChange} />
      ));
      expect(getByLabelText(tab === "home" ? "Inicio" : tab === "search" ? "Buscar" : tab === "bookmarks" ? "Guardados" : "Menú"))
        .toHaveAttribute("aria-current", "page");
    }
  });
});
