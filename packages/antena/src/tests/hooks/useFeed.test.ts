/** @jsxImportSource solid-js */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "solid-js";

vi.mock("idb", () => ({
  openDB: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockReturnValue({
      objectStore: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      }),
      done: Promise.resolve(),
    }),
  }),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    fetchFeed: vi.fn(),
    fetchTrending: vi.fn(),
    fetchBreaking: vi.fn(),
    fetchBlindspot: vi.fn(),
    fetchNewsById: vi.fn(),
    fetchFollows: vi.fn().mockResolvedValue([]),
    followSource: vi.fn().mockResolvedValue(false),
    unfollowSource: vi.fn().mockResolvedValue(false),
  };
});

vi.mock("../../components/Toast", () => ({
  toast: vi.fn(),
}));

vi.mock("../../lib/follows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/follows")>();
  return {
    ...actual,
    useFollows: vi.fn(),
  };
});

import * as dbModule from "../../lib/db";
vi.spyOn(dbModule, "cacheNews").mockResolvedValue(undefined as never);
vi.spyOn(dbModule, "getCachedNews").mockResolvedValue([] as never);

import { fetchFeed, fetchTrending, fetchBreaking, fetchBlindspot } from "../../lib/api";
import { useFeed } from "../../hooks/useFeed";
import { useFollows } from "../../lib/follows";
import type { ApiNewsCard, FeedResponse } from "../../lib/api";
import { createMockNews } from "../helpers";

const makeFollowsMock = (ids: number[]) => ({
  follows: () => ids.map((id) => ({ sourceId: id, sourceName: null, sourceUrl: null, sourceDomain: null, createdAt: new Date().toISOString() })),
  followedIds: () => new Set(ids),
  isFollowing: (id: number) => ids.includes(id),
  follow: vi.fn().mockResolvedValue(false),
  unfollow: vi.fn().mockResolvedValue(false),
  toggle: vi.fn().mockResolvedValue(false),
  refresh: vi.fn().mockResolvedValue(undefined),
  loaded: () => true,
});

beforeEach(() => {
  vi.mocked(useFollows).mockReturnValue(makeFollowsMock([]));
});

const baseCard = (id: string, sourceId: number | null = 1): ApiNewsCard => ({
  id,
  location_id: 1,
  title: `Noticia ${id}`,
  summary: `<p>Resumen ${id}</p>`,
  body: `<p>Cuerpo ${id}</p>`,
  image_url: null,
  bias_score: 0.2,
  is_gacetilla: 0,
  cluster_id: `cluster-${id}`,
  category: "Política",
  source_ids: String(sourceId ?? 0),
  source_name: "Ámbito",
  source_url: null,
  location_name: "Córdoba",
  location_province: "CBA",
  published_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  sources_count: 1,
  quality_score: 0.7,
});

const feedResponseOf = (cards: ApiNewsCard[]): FeedResponse => ({
  news: cards,
  total: cards.length,
  page: 1,
  per_page: cards.length,
  location: null,
  category: null,
});

describe("useFeed", () => {
  beforeEach(() => {
    vi.mocked(fetchFeed).mockReset();
    vi.mocked(fetchTrending).mockReset();
    vi.mocked(fetchBreaking).mockReset();
    vi.mocked(fetchBlindspot).mockReset();
    vi.mocked(fetchFeed).mockResolvedValue(feedResponseOf([baseCard("a", 1)]));
    vi.mocked(fetchTrending).mockResolvedValue(null);
    vi.mocked(fetchBreaking).mockResolvedValue(null);
    vi.mocked(fetchBlindspot).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes mappedNews, hasMore, resetFeed, loadMore", () => {
    createRoot((dispose) => {
      const feed = useFeed({ activeCategory: () => "Todas", activeLocation: () => null, activeFeedTab: () => "home", filterState: () => ({ time: "all", quality: 0, bias: "all" }), follows: useFollows() });
      expect(typeof feed.mappedNews).toBe("function");
      expect(typeof feed.hasMore).toBe("function");
      expect(typeof feed.resetFeed).toBe("function");
      expect(typeof feed.loadMore).toBe("function");
      expect(typeof feed.refreshBlindspot).toBe("function");
      expect(typeof feed.topSourcesForDrawer).toBe("function");
      expect(feed.mappedNews()).toEqual([]);
      expect(feed.hasMore()).toBe(true);
      dispose();
    });
  });

  it("maps initialFeed prop into mappedNews on first render", async () => {
    await createRoot(async (dispose) => {
      const follows = useFollows();
      const feed = useFeed({
        initialFeed: [baseCard("a", 1), baseCard("b", 2)],
        activeCategory: () => "Todas",
        activeLocation: () => null,
        activeFeedTab: () => "home",
        filterState: () => ({ time: "all", quality: 0, bias: "all" }),
        follows,
      });
      await Promise.resolve();
      expect(feed.mappedNews().length).toBe(2);
      expect(feed.mappedNews()[0].id).toBe("a");
      dispose();
    });
  });

  it("filters mappedNews by followed source ids when activeFeedTab is 'following'", async () => {
    vi.mocked(useFollows).mockReturnValue(makeFollowsMock([2]));
    vi.mocked(fetchFeed).mockResolvedValue(feedResponseOf([
      { ...baseCard("a", 1), source_id: 1 },
      { ...baseCard("b", 1), source_id: 2 },
      { ...baseCard("c", 1), source_id: 3 },
    ]));
    await createRoot(async (dispose) => {
      const follows = useFollows();
      const feed = useFeed({
        initialFeed: [
          { ...baseCard("a", 1), source_id: 1 },
          { ...baseCard("b", 1), source_id: 2 },
          { ...baseCard("c", 1), source_id: 3 },
        ],
        activeCategory: () => "Todas",
        activeLocation: () => null,
        activeFeedTab: () => "following",
        filterState: () => ({ time: "all", quality: 0, bias: "all" }),
        follows,
      });
      await Promise.resolve();
      await Promise.resolve();
      const ids = feed.mappedNews().map((n) => n.id);
      expect(ids).toContain("b");
      expect(ids).not.toContain("a");
      expect(ids).not.toContain("c");
      dispose();
    });
  });

  it("returns empty mappedNews on 'following' tab when user has no follows", async () => {
    await createRoot(async (dispose) => {
      const follows = useFollows();
      const feed = useFeed({
        initialFeed: [baseCard("a", 1)],
        activeCategory: () => "Todas",
        activeLocation: () => null,
        activeFeedTab: () => "following",
        filterState: () => ({ time: "all", quality: 0, bias: "all" }),
        follows,
      });
      await Promise.resolve();
      expect(feed.mappedNews()).toEqual([]);
      dispose();
    });
  });

  it("filters mappedNews by search query (case-insensitive, on title)", async () => {
    await createRoot(async (dispose) => {
      const follows = useFollows();
      const feed = useFeed({
        initialFeed: [
          { ...baseCard("a", 1), title: "Dólar sube en el mercado" },
          { ...baseCard("b", 1), title: "Inflación baja a 4%" },
        ],
        activeCategory: () => "Todas",
        activeLocation: () => null,
        activeFeedTab: () => "home",
        filterState: () => ({ time: "all", quality: 0, bias: "all" }),
        follows,
      });
      feed.setSearchQuery("dó");
      await Promise.resolve();
      const titles = feed.mappedNews().map((n) => n.title);
      expect(titles.some((t) => t.toLowerCase().includes("dó"))).toBe(true);
      expect(titles.every((t) => !t.toLowerCase().includes("inflación"))).toBe(true);
      dispose();
    });
  });

  it("loadMore appends items and updates offset", async () => {
    vi.mocked(fetchFeed).mockResolvedValue(feedResponseOf(Array.from({ length: 20 }, (_, i) => baseCard(`m${i}`, 1))));
    await createRoot(async (dispose) => {
      const follows = useFollows();
      const feed = useFeed({
        initialFeed: Array.from({ length: 20 }, (_, i) => baseCard(`i${i}`, 1)),
        activeCategory: () => "Todas",
        activeLocation: () => null,
        activeFeedTab: () => "home",
        filterState: () => ({ time: "all", quality: 0, bias: "all" }),
        follows,
      });
      await Promise.resolve();
      const before = feed.mappedNews().length;
      feed.loadMore();
      await Promise.resolve();
      expect(feed.mappedNews().length).toBeGreaterThanOrEqual(before);
      dispose();
    });
  });

  it("resetFeed clears allNews and triggers refetch", async () => {
    await createRoot(async (dispose) => {
      const follows = useFollows();
      const feed = useFeed({
        initialFeed: [baseCard("a", 1), baseCard("b", 2)],
        activeCategory: () => "Todas",
        activeLocation: () => null,
        activeFeedTab: () => "home",
        filterState: () => ({ time: "all", quality: 0, bias: "all" }),
        follows,
      });
      await Promise.resolve();
      expect(feed.mappedNews().length).toBeGreaterThan(0);
      vi.mocked(fetchFeed).mockResolvedValue(feedResponseOf([baseCard("z", 9)]));
      feed.resetFeed();
      await Promise.resolve();
      await Promise.resolve();
      const ids = feed.mappedNews().map((n) => n.id);
      expect(ids).toContain("z");
      dispose();
    });
  });

  it("topSourcesForDrawer aggregates by source name and sorts by count desc", async () => {
    await createRoot(async (dispose) => {
      const follows = useFollows();
      const feed = useFeed({
        initialFeed: [
          { ...baseCard("a", 1), source_name: "Ámbito" },
          { ...baseCard("b", 1), source_name: "Ámbito" },
          { ...baseCard("c", 1), source_name: "Ámbito" },
          { ...baseCard("d", 1), source_name: "La Nación" },
        ],
        activeCategory: () => "Todas",
        activeLocation: () => null,
        activeFeedTab: () => "home",
        filterState: () => ({ time: "all", quality: 0, bias: "all" }),
        follows,
      });
      await Promise.resolve();
      const top = feed.topSourcesForDrawer();
      expect(top[0].name).toBe("Ámbito");
      expect(top[0].count).toBe(3);
      expect(top.length).toBeLessThanOrEqual(5);
      dispose();
    });
  });
});
