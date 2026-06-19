import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import EmptyState from "../components/common/EmptyState";

afterEach(cleanup);

describe("EmptyState", () => {
  it("renders title and description", () => {
    const { getByText } = render(() => (
      <EmptyState
        title="No hay nada"
        description="Probá de nuevo más tarde"
      />
    ));
    expect(getByText("No hay nada")).toBeInTheDocument();
    expect(getByText("Probá de nuevo más tarde")).toBeInTheDocument();
  });

  it("renders action button when action prop is provided", () => {
    const onClick = vi.fn();
    const { getByText } = render(() => (
      <EmptyState
        title="Title"
        action={{ label: "Click me", onClick }}
      />
    ));
    const button = getByText("Click me");
    expect(button).toBeInTheDocument();
    expect(button.tagName).toBe("BUTTON");
  });

  it("renders the 7 named illustrations (antenna, signal, radio, wave, satellite, search, bookmark)", () => {
    const icons = ["antenna", "signal", "radio", "wave", "satellite", "search", "bookmark"] as const;
    for (const icon of icons) {
      cleanup();
      const { container } = render(() => (
        <EmptyState title="t" icon={icon} />
      ));
      const svg = container.querySelector("svg");
      expect(svg, `icon "${icon}" should render an SVG`).toBeTruthy();
    }
  });

  it("renders SVG for any icon name", () => {
    const { container } = render(() => (
      <EmptyState title="t" icon="unknown-icon" />
    ));
    const svg = container.querySelector("svg use");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("href")).toBe("#unknown-icon");
  });

  it("renders without icon when no icon prop is provided", () => {
    const { container } = render(() => (
      <EmptyState title="Just a title" />
    ));
    expect(container.querySelector("svg")).toBeNull();
  });

  it("invokes action callback when button is clicked", () => {
    const onClick = vi.fn();
    const { getByText } = render(() => (
      <EmptyState title="t" action={{ label: "Go", onClick }} />
    ));
    getByText("Go").click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
