import { vi } from "vitest";
import type { NewsItem } from "../lib/types";

export function createMockNews(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: "news-1",
    title: "Mock news article",
    summary: "This is a mock summary",
    body: "This is a mock body with more content",
    category: "Política",
    source: "Mock Source",
    sourceUrl: "https://example.com/article",
    time: "Hace 2h",
    location: "Córdoba, CBA",
    bias: "Oficialista",
    biasScore: 0.3,
    biasColor: "#75AADB",
    biasGradientColor: "rgb(117,170,219)",
    intensity: 4,
    signalLevel: 5,
    isGacetilla: false,
    isClickbait: false,
    clusterId: "cluster-1",
    sourcesCount: 3,
    imageUrl: "https://example.com/img.jpg",
    publishedAt: new Date().toISOString(),
    voces: [
      { label: "Oficialista", color: "#75AADB", pct: 50 },
      { label: "Neutral", color: "#968C83", pct: 25 },
      { label: "Opositor", color: "#F5C542", pct: 25 },
    ],
    propagation: [],
    ...overrides,
  };
}

export function mockNavigatorShare(supported = true) {
  const shareMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "share", {
    configurable: true,
    writable: true,
    value: supported ? shareMock : undefined,
  });
  return shareMock;
}

export function mockNavigatorClipboard() {
  const writeTextMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: { writeText: writeTextMock },
  });
  return writeTextMock;
}

export function mockNavigatorVibrate() {
  const vibrateMock = vi.fn().mockReturnValue(true);
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    writable: true,
    value: vibrateMock,
  });
  return vibrateMock;
}

export function mockIntersectionObserver() {
  const observeMock = vi.fn();
  const unobserveMock = vi.fn();
  const disconnectMock = vi.fn();
  class MockIO {
    observe = observeMock;
    unobserve = unobserveMock;
    disconnect = disconnectMock;
    takeRecords = () => [];
    root = null;
    rootMargin = "";
    thresholds = [];
  }
  (globalThis as unknown as { IntersectionObserver: typeof MockIO }).IntersectionObserver = MockIO;
  return { observeMock, unobserveMock, disconnectMock };
}

export function mockFetchOnce(data: unknown, status = 200) {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => data,
  });
}
