import { describe, it, expect, vi, beforeEach } from "vitest";
import { useHaptic } from "../lib/haptic";

describe("useHaptic", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes isSupported and vibrate", () => {
    const { isSupported, vibrate } = useHaptic();
    expect(typeof isSupported).toBe("boolean");
    expect(typeof vibrate).toBe("function");
  });

  it("returns isSupported true when navigator.vibrate exists", () => {
    const spy = vi.spyOn(navigator, "vibrate").mockImplementation(() => true);
    const { isSupported } = useHaptic();
    expect(isSupported).toBe(true);
    spy.mockRestore();
  });

  it("calls navigator.vibrate with number for numeric pattern", () => {
    const spy = vi.spyOn(navigator, "vibrate").mockImplementation(() => true);
    const { vibrate } = useHaptic();
    vibrate(50);
    expect(spy).toHaveBeenCalledWith(50);
    spy.mockRestore();
  });

  it("calls navigator.vibrate with array for array pattern", () => {
    const spy = vi.spyOn(navigator, "vibrate").mockImplementation(() => true);
    const { vibrate } = useHaptic();
    vibrate([100, 50, 100]);
    expect(spy).toHaveBeenCalledWith([100, 50, 100]);
    spy.mockRestore();
  });

  it("translates 'tap' string to 15ms pattern", () => {
    const spy = vi.spyOn(navigator, "vibrate").mockImplementation(() => true);
    const { vibrate } = useHaptic();
    vibrate("tap");
    expect(spy).toHaveBeenCalledWith(15);
    spy.mockRestore();
  });

  it("translates 'selection' string to 10ms pattern", () => {
    const spy = vi.spyOn(navigator, "vibrate").mockImplementation(() => true);
    const { vibrate } = useHaptic();
    vibrate("selection");
    expect(spy).toHaveBeenCalledWith(10);
    spy.mockRestore();
  });

  it("translates 'success' string to array pattern", () => {
    const spy = vi.spyOn(navigator, "vibrate").mockImplementation(() => true);
    const { vibrate } = useHaptic();
    vibrate("success");
    expect(spy).toHaveBeenCalledWith([15, 50, 15]);
    spy.mockRestore();
  });

  it("translates 'error' string to longer array pattern", () => {
    const spy = vi.spyOn(navigator, "vibrate").mockImplementation(() => true);
    const { vibrate } = useHaptic();
    vibrate("error");
    expect(spy).toHaveBeenCalledWith([30, 50, 30, 50, 30]);
    spy.mockRestore();
  });

  it("translates 'long' string to 50ms", () => {
    const spy = vi.spyOn(navigator, "vibrate").mockImplementation(() => true);
    const { vibrate } = useHaptic();
    vibrate("long");
    expect(spy).toHaveBeenCalledWith(50);
    spy.mockRestore();
  });

  it("translates 'double' string to [15, 100, 15]", () => {
    const spy = vi.spyOn(navigator, "vibrate").mockImplementation(() => true);
    const { vibrate } = useHaptic();
    vibrate("double");
    expect(spy).toHaveBeenCalledWith([15, 100, 15]);
    spy.mockRestore();
  });

  it("returns true when vibrate succeeds", () => {
    const spy = vi.spyOn(navigator, "vibrate").mockImplementation(() => true);
    const { vibrate } = useHaptic();
    expect(vibrate("tap")).toBe(true);
    spy.mockRestore();
  });

  it("returns false when vibrate throws", () => {
    const spy = vi.spyOn(navigator, "vibrate").mockImplementation(() => {
      throw new Error("not allowed");
    });
    const { vibrate } = useHaptic();
    expect(vibrate("tap")).toBe(false);
    spy.mockRestore();
  });

  it("returns false when navigator.vibrate is missing", () => {
    const savedVibrate = (navigator as unknown as { vibrate?: unknown }).vibrate;
    delete (navigator as unknown as { vibrate?: unknown }).vibrate;
    const { vibrate, isSupported } = useHaptic();
    expect(isSupported).toBe(false);
    expect(vibrate("tap")).toBe(false);
    (navigator as unknown as { vibrate?: unknown }).vibrate = savedVibrate;
  });
});
