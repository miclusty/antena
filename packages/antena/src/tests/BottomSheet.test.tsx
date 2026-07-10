import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import BottomSheet from "../components/common/BottomSheet";
import { mockNavigatorVibrate } from "./helpers";

afterEach(cleanup);

describe("BottomSheet", () => {
  beforeEach(() => {
    mockNavigatorVibrate();
  });

  // BottomSheet uses Portal, so the dialog lives in document.body, not container
  const findDialog = () => document.querySelector('[role="dialog"]') as HTMLElement;
  const findBackdrop = () => document.querySelector('[role="presentation"]') as HTMLElement;

  it("does not render when open is false", () => {
    render(() => (
      <BottomSheet open={false} onClose={() => {}}>
        <div>content</div>
      </BottomSheet>
    ));
    expect(findDialog()).toBeNull();
  });

  it("renders when open is true", () => {
    render(() => (
      <BottomSheet open={true} onClose={() => {}}>
        <div>content</div>
      </BottomSheet>
    ));
    expect(findDialog()).toBeInTheDocument();
  });

  it("renders children inside the sheet", () => {
    render(() => (
      <BottomSheet open={true} onClose={() => {}}>
        <p>Hello sheet</p>
      </BottomSheet>
    ));
    expect(document.body.textContent).toContain("Hello sheet");
  });

  it("renders title when provided", () => {
    render(() => (
      <BottomSheet open={true} onClose={() => {}} title="My Sheet">
        <p>x</p>
      </BottomSheet>
    ));
    expect(document.body.textContent).toContain("My Sheet");
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = vi.fn();
    render(() => (
      <BottomSheet open={true} onClose={onClose}>
        <p>x</p>
      </BottomSheet>
    ));
    const backdrop = findBackdrop();
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("does NOT call onClose when sheet body is clicked (stopPropagation)", () => {
    const onClose = vi.fn();
    render(() => (
      <BottomSheet open={true} onClose={onClose}>
        <p>x</p>
      </BottomSheet>
    ));
    const dialog = findDialog();
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(() => (
      <BottomSheet open={true} onClose={onClose}>
        <p>x</p>
      </BottomSheet>
    ));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onClose on Escape when closed", () => {
    const onClose = vi.fn();
    render(() => (
      <BottomSheet open={false} onClose={onClose}>
        <p>x</p>
      </BottomSheet>
    ));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("applies full height variant", () => {
    render(() => (
      <BottomSheet open={true} onClose={() => {}} height="full">
        <p>x</p>
      </BottomSheet>
    ));
    expect(findDialog().className).toContain("h-[90vh]");
  });

  it("applies half height variant", () => {
    render(() => (
      <BottomSheet open={true} onClose={() => {}} height="half">
        <p>x</p>
      </BottomSheet>
    ));
    expect(findDialog().className).toContain("h-[50vh]");
  });

  it("applies default height (auto) variant", () => {
    render(() => (
      <BottomSheet open={true} onClose={() => {}}>
        <p>x</p>
      </BottomSheet>
    ));
    expect(findDialog().className).toContain("max-h-[85vh]");
  });

  it("adds keyboard padding to the scroll area when an input receives focus", () => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { height: 500, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 800 });
    render(() => (
      <BottomSheet open={true} onClose={() => {}}>
        <input aria-label="Nombre" />
      </BottomSheet>
    ));
    fireEvent.focus(document.querySelector('input[aria-label="Nombre"]') as HTMLInputElement);
    const scrollArea = findDialog().querySelector(".overflow-y-auto") as HTMLElement;
    expect(scrollArea.getAttribute("style") ?? "").toContain("300px");
  });

  it("uses default title 'Menu' as aria-label", () => {
    render(() => (
      <BottomSheet open={true} onClose={() => {}}>
        <p>x</p>
      </BottomSheet>
    ));
    expect(findDialog().getAttribute("aria-label")).toBe("Menu");
  });
});
