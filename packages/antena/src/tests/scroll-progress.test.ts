import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { createScrollProgress } from "../lib/scroll-progress";

type IOCallback = (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;

interface FakeIOInstance {
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  trigger: (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;
}

function installFakeIO() {
  const instances: FakeIOInstance[] = [];
  class FakeIO {
    cb: IOCallback;
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    constructor(cb: IOCallback) {
      this.cb = cb;
      instances.push(this as unknown as FakeIOInstance);
    }
    trigger(entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) {
      this.cb(entries);
    }
  }
  (globalThis as unknown as { IntersectionObserver: typeof FakeIO }).IntersectionObserver = FakeIO;
  return {
    instances,
    fireAll(entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) {
      for (const i of instances) i.trigger(entries);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createScrollProgress", () => {
  it("returns a ref callback and a passed signal that starts false", () => {
    installFakeIO();
    createRoot((dispose) => {
      const [ref, passed] = createScrollProgress(0.6);
      expect(typeof ref).toBe("function");
      expect(passed()).toBe(false);
      dispose();
    });
  });

  it("does not create an observer until the ref is invoked with an element", () => {
    const fake = installFakeIO();
    createRoot((dispose) => {
      createScrollProgress(0.6);
      expect(fake.instances.length).toBe(0);
      dispose();
    });
  });

  it("creates an observer and observes the sentinel when the ref is called", () => {
    const fake = installFakeIO();
    createRoot((dispose) => {
      const [ref] = createScrollProgress(0.6);
      const sentinel = document.createElement("div");
      ref(sentinel);
      expect(fake.instances.length).toBe(1);
      expect(fake.instances[0].observe).toHaveBeenCalledWith(sentinel);
      dispose();
    });
  });

  it("sets passed=true when the sentinel enters the viewport above the threshold", () => {
    const fake = installFakeIO();
    createRoot((dispose) => {
      const [ref, passed] = createScrollProgress(0.6);
      ref(document.createElement("div"));
      expect(passed()).toBe(false);
      fake.fireAll([{ isIntersecting: true, intersectionRatio: 0.7 }]);
      expect(passed()).toBe(true);
      dispose();
    });
  });

  it("does NOT set passed=true when intersectionRatio is below threshold", () => {
    const fake = installFakeIO();
    createRoot((dispose) => {
      const [ref, passed] = createScrollProgress(0.6);
      ref(document.createElement("div"));
      fake.fireAll([{ isIntersecting: true, intersectionRatio: 0.3 }]);
      expect(passed()).toBe(false);
      dispose();
    });
  });

  it("does NOT set passed=true when isIntersecting is false", () => {
    const fake = installFakeIO();
    createRoot((dispose) => {
      const [ref, passed] = createScrollProgress(0.6);
      ref(document.createElement("div"));
      fake.fireAll([{ isIntersecting: false, intersectionRatio: 1.0 }]);
      expect(passed()).toBe(false);
      dispose();
    });
  });

  it("is one-way: passed stays true once it becomes true (sticky reveal)", () => {
    const fake = installFakeIO();
    createRoot((dispose) => {
      const [ref, passed] = createScrollProgress(0.6);
      ref(document.createElement("div"));
      fake.fireAll([{ isIntersecting: true, intersectionRatio: 0.9 }]);
      expect(passed()).toBe(true);
      // Scrolling back up: the sentinel exits the viewport
      fake.fireAll([{ isIntersecting: false, intersectionRatio: 0 }]);
      expect(passed()).toBe(true); // still true
      dispose();
    });
  });

  it("disconnects the observer on cleanup", () => {
    const fake = installFakeIO();
    let disposeFn: (() => void) | null = null;
    createRoot((dispose) => {
      disposeFn = dispose;
      const [ref] = createScrollProgress(0.6);
      ref(document.createElement("div"));
    });
    expect(fake.instances.length).toBe(1);
    const inst = fake.instances[0];
    expect(inst.disconnect).not.toHaveBeenCalled();
    disposeFn!();
    expect(inst.disconnect).toHaveBeenCalled();
  });
});
