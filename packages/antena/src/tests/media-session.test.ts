import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("detectDoubleTap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true when the same action fires within 300ms", async () => {
    const { detectDoubleTap } = await import("../lib/media-session");
    detectDoubleTap("next"); // first tap
    vi.advanceTimersByTime(200);
    const isDouble = detectDoubleTap("next"); // second tap
    expect(isDouble).toBe(true);
  });

  it("returns false when the same action fires after 300ms", async () => {
    const { detectDoubleTap } = await import("../lib/media-session");
    detectDoubleTap("next");
    vi.advanceTimersByTime(500);
    const isDouble = detectDoubleTap("next");
    expect(isDouble).toBe(false);
  });

  it("returns false when different actions fire quickly", async () => {
    const { detectDoubleTap } = await import("../lib/media-session");
    detectDoubleTap("next");
    vi.advanceTimersByTime(100);
    const isDouble = detectDoubleTap("prev");
    expect(isDouble).toBe(false);
  });

  it("does not register a double-tap on the very first call", async () => {
    const { detectDoubleTap } = await import("../lib/media-session");
    expect(detectDoubleTap("next")).toBe(false);
  });

  it("treats three rapid taps as: false, true, false (alternating)", async () => {
    const { detectDoubleTap } = await import("../lib/media-session");
    expect(detectDoubleTap("next")).toBe(false);
    vi.advanceTimersByTime(100);
    expect(detectDoubleTap("next")).toBe(true);
    vi.advanceTimersByTime(100);
    expect(detectDoubleTap("next")).toBe(false);
  });
});

describe("installMediaSession", () => {
  let setActionHandlerCalls: Array<{ action: string; handler: unknown }>;
  let mockMetadata: MediaMetadata | null;

  beforeEach(() => {
    vi.resetModules();
    setActionHandlerCalls = [];
    mockMetadata = null;

    // Mock navigator.mediaSession
    (globalThis as any).navigator = {
      mediaSession: {
        setActionHandler: vi.fn((action: string, handler: unknown) => {
          setActionHandlerCalls.push({ action, handler });
        }),
        set metadata(value: MediaMetadata | null) {
          mockMetadata = value;
        },
        get metadata() {
          return mockMetadata;
        },
      },
    };
  });

  it("is a no-op when navigator.mediaSession is unavailable", async () => {
    (globalThis as any).navigator = {};
    const { installMediaSession } = await import("../lib/media-session");
    expect(() =>
      installMediaSession({
        play: vi.fn(),
        pause: vi.fn(),
        next: vi.fn(),
        prev: vi.fn(),
        nextFavorite: vi.fn(),
        prevFavorite: vi.fn(),
        getMetadata: () => null,
      }),
    ).not.toThrow();
  });

  it("registers handlers for play, pause, nexttrack, previoustrack", async () => {
    const { installMediaSession } = await import("../lib/media-session");
    installMediaSession({
      play: vi.fn(),
      pause: vi.fn(),
      next: vi.fn(),
      prev: vi.fn(),
      nextFavorite: vi.fn(),
      prevFavorite: vi.fn(),
      getMetadata: () => null,
    });
    const actions = setActionHandlerCalls.map((c) => c.action);
    expect(actions).toContain("play");
    expect(actions).toContain("pause");
    expect(actions).toContain("nexttrack");
    expect(actions).toContain("previoustrack");
  });

  it("calls next on a single nexttrack press", async () => {
    const { installMediaSession } = await import("../lib/media-session");
    const next = vi.fn();
    installMediaSession({
      play: vi.fn(),
      pause: vi.fn(),
      next,
      prev: vi.fn(),
      nextFavorite: vi.fn(),
      prevFavorite: vi.fn(),
      getMetadata: () => null,
    });
    const nexttrack = setActionHandlerCalls.find((c) => c.action === "nexttrack")!;
    (nexttrack.handler as () => void)();
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls nextFavorite on a double nexttrack press", async () => {
    vi.useFakeTimers();
    const { installMediaSession } = await import("../lib/media-session");
    const next = vi.fn();
    const nextFavorite = vi.fn();
    installMediaSession({
      play: vi.fn(),
      pause: vi.fn(),
      next,
      prev: vi.fn(),
      nextFavorite,
      prevFavorite: vi.fn(),
      getMetadata: () => null,
    });
    const nexttrack = setActionHandlerCalls.find((c) => c.action === "nexttrack")!;
    (nexttrack.handler as () => void)();
    vi.advanceTimersByTime(200);
    (nexttrack.handler as () => void)();
    expect(next).toHaveBeenCalledOnce();
    expect(nextFavorite).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("calls nextFavorite on previoustrack double-press too", async () => {
    vi.useFakeTimers();
    const { installMediaSession } = await import("../lib/media-session");
    const prev = vi.fn();
    const nextFavorite = vi.fn();
    installMediaSession({
      play: vi.fn(),
      pause: vi.fn(),
      next: vi.fn(),
      prev,
      nextFavorite,
      prevFavorite: vi.fn(),
      getMetadata: () => null,
    });
    const previoustrack = setActionHandlerCalls.find((c) => c.action === "previoustrack")!;
    (previoustrack.handler as () => void)();
    vi.advanceTimersByTime(200);
    (previoustrack.handler as () => void)();
    expect(prev).toHaveBeenCalledOnce();
    expect(nextFavorite).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
