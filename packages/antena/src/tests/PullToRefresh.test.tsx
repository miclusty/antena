import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import PullToRefresh from "../components/PullToRefresh";

const touch = (el: Element, type: string, clientY: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { configurable: true, value: [{ clientY }] });
  Object.defineProperty(event, "changedTouches", { configurable: true, value: [{ clientY }] });
  el.dispatchEvent(event);
  return event;
};

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "standalone", { configurable: true, value: undefined });
});

describe("PullToRefresh", () => {
  it("prevents native overscroll while pulling", () => {
    const { container } = render(() => <PullToRefresh onRefresh={vi.fn()}><div>feed</div></PullToRefresh>);
    const root = container.firstElementChild as HTMLElement;
    touch(root, "touchstart", 0);
    const move = touch(root, "touchmove", 120);
    expect(move.defaultPrevented).toBe(true);
  });

  it("is disabled inside iOS standalone PWA", async () => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { container } = render(() => <PullToRefresh onRefresh={onRefresh}><div>feed</div></PullToRefresh>);
    const root = container.firstElementChild as HTMLElement;
    touch(root, "touchstart", 0);
    touch(root, "touchmove", 200);
    touch(root, "touchend", 200);
    await Promise.resolve();
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
