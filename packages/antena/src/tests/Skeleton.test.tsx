import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import Skeleton from "../components/common/Skeleton";

afterEach(cleanup);

describe("Skeleton", () => {
  it("renders with default card variant", () => {
    const { container } = render(() => <Skeleton />);
    const root = container.firstElementChild as HTMLElement;
    // For single count, the inner CardSkeleton has aria-busy
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(root).toBeTruthy();
  });

  it("renders card variant", () => {
    const { container } = render(() => <Skeleton variant="card" />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it("renders cluster variant", () => {
    const { container } = render(() => <Skeleton variant="cluster" />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it("renders hero variant", () => {
    const { container } = render(() => <Skeleton variant="hero" />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it("renders text variant", () => {
    const { container } = render(() => <Skeleton variant="text" />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it("renders avatar variant", () => {
    const { container } = render(() => <Skeleton variant="avatar" />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it("renders multiple skeletons when count > 1", () => {
    const { container } = render(() => <Skeleton variant="card" count={3} />);
    const cards = container.querySelectorAll('[aria-busy="true"]');
    expect(cards.length).toBeGreaterThanOrEqual(3);
  });

  it("includes screen-reader-only 'Cargando...' text", () => {
    const { container } = render(() => <Skeleton count={2} />);
    const srOnly = container.querySelectorAll(".sr-only");
    expect(srOnly.length).toBeGreaterThan(0);
    const hasLoadingText = Array.from(srOnly).some(el => el.textContent?.includes("Cargando"));
    expect(hasLoadingText).toBe(true);
  });

  it("uses shimmer class for animated background", () => {
    const { container } = render(() => <Skeleton variant="card" />);
    expect(container.querySelector(".skeleton-shimmer")).toBeInTheDocument();
  });
});
