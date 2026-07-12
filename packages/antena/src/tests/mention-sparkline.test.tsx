import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import MentionSparkline from "../components/entity/MentionSparkline";

afterEach(cleanup);

const today = () => new Date().toISOString().slice(0, 10);
const dayMinus = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

describe("MentionSparkline", () => {
  it("renders an SVG element", () => {
    const { container } = render(() => (
      <MentionSparkline
        days={2}
        data={[
          { day: dayMinus(1), count: 3 },
          { day: today(), count: 5 },
        ]}
      />
    ));
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 120 30");
  });

  it("draws a polyline for the data", () => {
    const { container } = render(() => (
      <MentionSparkline
        days={3}
        data={[
          { day: dayMinus(2), count: 1 },
          { day: dayMinus(1), count: 5 },
          { day: today(), count: 2 },
        ]}
      />
    ));
    const polyline = container.querySelector("polyline");
    expect(polyline).toBeTruthy();
    const points = polyline?.getAttribute("points") ?? "";
    expect(points.split(" ").length).toBeGreaterThanOrEqual(2);
  });

  it("renders one dot per data point when days matches data length", () => {
    const { container } = render(() => (
      <MentionSparkline
        days={4}
        data={[
          { day: dayMinus(3), count: 1 },
          { day: dayMinus(2), count: 5 },
          { day: dayMinus(1), count: 2 },
          { day: today(), count: 7 },
        ]}
      />
    ));
    const dots = container.querySelectorAll("circle");
    expect(dots.length).toBe(4);
  });

  it("shows 'Sin menciones recientes' when data is empty", () => {
    const { container, getByText } = render(() => (
      <MentionSparkline data={[]} />
    ));
    expect(getByText("Sin menciones recientes")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders a single point (no NaN in polyline)", () => {
    const { container } = render(() => (
      <MentionSparkline
        days={1}
        data={[{ day: today(), count: 4 }]}
      />
    ));
    const polyline = container.querySelector("polyline");
    const points = polyline?.getAttribute("points") ?? "";
    expect(points).not.toContain("NaN");
    expect(container.querySelectorAll("circle").length).toBe(1);
  });
});