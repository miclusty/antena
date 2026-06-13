import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Stub the analytics module so any trackEvent/card_view/article_open call
// becomes a no-op. The original code calls fetch('/api/track') which
// happy-dom tries to resolve as http://localhost:3000/api/track — but
// there's no server in test env, creating an unhandled rejection that
// fails CI runs. Mocking the module is the only reliable fix.
vi.mock("../lib/analytics", () => ({
  trackEvent: vi.fn(),
  trackCardView: vi.fn(),
  trackArticleOpen: vi.fn(),
  trackArticleComplete: vi.fn(),
  trackBookmark: vi.fn(),
  trackShare: vi.fn(),
  trackSearch: vi.fn(),
  trackVote: vi.fn(),
  trackSourceOpen: vi.fn(),
  trackTimeOnFeed: vi.fn(),
  initAnalytics: vi.fn(),
}));

// Stub the cloudflare module to avoid Worker-only imports in test env.
vi.mock("../lib/cloudflare", () => ({}));

// Stub fetch globally as a backup. We have to override BOTH globalThis
// and window because happy-dom installs its own fetch on the window.
const mockFetch = vi.fn(() =>
  Promise.resolve(new Response("{}", { status: 200 }))
);
vi.stubGlobal("fetch", mockFetch);

// happy-dom provides localStorage/sessionStorage on window but not as globals.
// Use vi.stubGlobal so the property is added to the actual globalThis
// (visible to lib modules that reference `localStorage` directly).

const memoryStore: Record<string, string> = {};
const memorySession: Record<string, string> = {};
function makeStorage(store: Record<string, string>): Storage {
  return {
    length: 0,
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    getItem: (k) => store[k] ?? null,
    key: (i) => Object.keys(store)[i] ?? null,
    removeItem: (k) => { delete store[k]; },
    setItem: (k, v) => { store[k] = String(v); },
  };
}

if (typeof globalThis.localStorage === "undefined") {
  vi.stubGlobal("localStorage", makeStorage(memoryStore));
}
if (typeof globalThis.sessionStorage === "undefined") {
  vi.stubGlobal("sessionStorage", makeStorage(memorySession));
}

if (typeof globalThis.IntersectionObserver === "undefined") {
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  }
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
}

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  if (!("vibrate" in navigator)) {
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: () => true,
    });
  }
}
