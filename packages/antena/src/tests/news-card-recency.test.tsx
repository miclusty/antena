import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import NewsCard from "../components/common/NewsCard";
import { createMockNews, mockNavigatorVibrate } from "./helpers";

// Mock fetch so the trackEvent call inside NewsCard doesn't hit the network.
const mockFetch = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
globalThis.fetch = mockFetch as unknown as typeof fetch;

afterEach(cleanup);
beforeEach(() => {
  mockNavigatorVibrate();
  mockFetch.mockClear();
  mockFetch.mockReturnValue(Promise.resolve(new Response("{}", { status: 200 })));
});

describe("NewsCard recency badge", () => {
  it("shows 'AHORA' for stories published less than 60 minutes ago", () => {
    const recent = createMockNews({
      publishedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    const { getByText } = render(() => <NewsCard news={recent} onClick={() => {}} />);
    expect(getByText("AHORA")).toBeInTheDocument();
  });

  it("shows the hour count for stories 1-24h old", () => {
    const threeHoursAgo = createMockNews({
      publishedAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
    });
    const { getByText } = render(() => <NewsCard news={threeHoursAgo} onClick={() => {}} />);
    expect(getByText("3h")).toBeInTheDocument();
  });

  it("shows the day count for stories 1-7 days old", () => {
    const twoDaysAgo = createMockNews({
      publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
    });
    const { getByText } = render(() => <NewsCard news={twoDaysAgo} onClick={() => {}} />);
    expect(getByText("2d")).toBeInTheDocument();
  });

  it("shows 'Xd atrás' (stale marker) for stories older than 7 days", () => {
    const tenDaysAgo = createMockNews({
      publishedAt: new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString(),
    });
    const { getByText } = render(() => <NewsCard news={tenDaysAgo} onClick={() => {}} />);
    expect(getByText("10d atrás")).toBeInTheDocument();
  });
});

describe("NewsCard multi-source badge", () => {
  it("shows 'X medios' pill when sourcesCount >= 2", () => {
    const news = createMockNews({ sourcesCount: 3 });
    const { getByText } = render(() => <NewsCard news={news} onClick={() => {}} />);
    expect(getByText("3 medios")).toBeInTheDocument();
  });

  it("does NOT show multi-source badge when sourcesCount === 1", () => {
    const news = createMockNews({ sourcesCount: 1 });
    const { container } = render(() => <NewsCard news={news} onClick={() => {}} />);
    expect(container.textContent ?? "").not.toMatch(/\b1 medios\b/);
  });
});

describe("NewsCard stale card highlight", () => {
  it("applies an amber border highlight class to cards > 48h old", () => {
    const fiveDaysAgo = createMockNews({
      publishedAt: new Date(Date.now() - 5 * 24 * 60 * 60_000).toISOString(),
    });
    const { container } = render(() => <NewsCard news={fiveDaysAgo} onClick={() => {}} />);
    const article = container.querySelector("article");
    expect(article?.className ?? "").toMatch(/amber/i);
  });

  it("does NOT apply the amber border for cards < 48h old", () => {
    const fresh = createMockNews({
      publishedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
    });
    const { container } = render(() => <NewsCard news={fresh} onClick={() => {}} />);
    const article = container.querySelector("article");
    expect(article?.className ?? "").not.toMatch(/amber/i);
  });
});
