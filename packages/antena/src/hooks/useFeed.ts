/** @jsxImportSource solid-js */
import { createSignal, createMemo, createResource, createEffect, untrack } from "solid-js";
import {
  fetchFeed,
  fetchTrending,
  fetchBreaking,
  fetchBlindspot,
  fetchEmerging,
  type ApiNewsCard,
  type FeedResponse,
} from "../lib/api";
import { mapNewsCard } from "../lib/mappers";
import { cacheNews, getCachedNews } from "../lib/db";
import { toast } from "../components/Toast";
import { buildFeedFilterParams, type FeedFilterState } from "../lib/feed-filters";
import type { NewsItem } from "../lib/types";
import { useFollows } from "../lib/follows";

export type FeaturedCluster = {
  primary: NewsItem;
  clusterId: string;
  sourcesCount: number;
  sourceNames: string[];
};

export type TrendingItem = { id: string; title: string; category: string };
export type BreakingItem = {
  id: string;
  title: string;
  source: string;
  biasScore?: number;
  createdAt: string;
};
export type BlindspotItem = {
  id: string;
  title: string;
  summary: string;
  source: string;
  sourceUrl?: string;
  sourceId?: number | null;
  category?: string;
  biasColor?: string;
};

export type UseFeedOptions = {
  initialFeed?: unknown[];
  initialBlindspot?: unknown[];
  activeCategory: () => string;
  activeLocation: () => string | null;
  activeFeedTab: () => string;
  filterState: () => FeedFilterState;
  follows: ReturnType<typeof useFollows>;
};

const mapBlindspot = (items: Array<Record<string, unknown>>): BlindspotItem[] =>
  items.map((it) => ({
    id: String(it.id),
    title: String(it.title ?? ""),
    summary: String(it.summary ?? ""),
    source: String(it.source_name ?? it.source ?? "Fuente"),
    sourceUrl: (it.source_url as string | undefined) ?? undefined,
    sourceId: (it.source_id as number | null | undefined) ?? null,
    category: (it.category as string | undefined) ?? undefined,
    biasColor: (it.biasColor as string | undefined) ?? undefined,
  }));

export function useFeed(opts: UseFeedOptions) {
  const [searchQuery, setSearchQuery] = createSignal("");

  const [allNews, setAllNews] = createSignal<NewsItem[]>(
    (opts.initialFeed ?? []).map((n) => mapNewsCard(n as ApiNewsCard)),
  );
  const [offset, setOffset] = createSignal(0);
  const [hasMore, setHasMore] = createSignal(true);
  const [isLoadingMore, setIsLoadingMore] = createSignal(false);

  const [trendingItems, setTrendingItems] = createSignal<TrendingItem[]>([]);
  const [breakingItems, setBreakingItems] = createSignal<BreakingItem[]>([]);
  const [blindspotItems, setBlindspotItems] = createSignal<BlindspotItem[]>(
    mapBlindspot((opts.initialBlindspot ?? []) as Array<Record<string, unknown>>),
  );
  const [blindspotLoading, setBlindspotLoading] = createSignal(false);

  // ─── Emerging clusters (S3.9) ───────────────────────────────────
  // Set of cluster_ids flagged "emerging" by the AKIRA detector
  // (see packages/akira/core/emerging_themes.py). Used by news
  // cards to show the 🚨 Emergente badge. Refreshed every 15 min
  // to roughly match the AKIRA cron cadence — we deliberately
  // don't refresh on every feed refetch because the data is
  // inherently low-cadence (clusters don't go from trending to
  // emerging in 30s).
  const [emergingClusterIds, setEmergingClusterIds] = createSignal<Set<string>>(
    new Set(),
  );
  const EMERGING_REFRESH_MS = 15 * 60 * 1000;

  const refreshEmerging = async () => {
    try {
      const r = await fetchEmerging(6, 0);
      if (r?.emerging) {
        setEmergingClusterIds(new Set(r.emerging.map((c) => c.cluster_id)));
      }
    } catch {
      /* network blip — keep stale set */
    }
  };

  if (typeof window !== "undefined") {
    queueMicrotask(refreshEmerging);
    setInterval(refreshEmerging, EMERGING_REFRESH_MS);
  }

  const initialFeedResp: FeedResponse = {
    news: (opts.initialFeed ?? []) as ApiNewsCard[],
    total: (opts.initialFeed?.length ?? 0),
    page: 0,
    per_page: 15,
    location: null,
    category: null,
  };

  const [feed, { refetch }] = createResource(
    () =>
      `${opts.activeCategory()}:${searchQuery()}:${opts.activeLocation() ?? "all"}:${opts.activeFeedTab()}:${opts.follows.followedIds().size}:${JSON.stringify(opts.filterState())}`,
    async (): Promise<FeedResponse> => {
      try {
        if (opts.activeFeedTab() === "explore") {
          const trending = await fetchTrending(20, 168);
          if (trending) {
            return {
              news: trending.news as unknown as ApiNewsCard[],
              location: null,
              category: null,
              total: trending.total,
              page: 1,
              per_page: 20,
            };
          }
        }
        const catParam = opts.activeCategory() === "Todas" ? undefined : opts.activeCategory();
        const result = await fetchFeed({
          category: catParam,
          location_id: opts.activeLocation() ? parseInt(opts.activeLocation()!) : undefined,
          limit: 20,
          offset: 0,
          following: opts.activeFeedTab() === "following",
          foryou: opts.activeFeedTab() !== "home",
          ...buildFeedFilterParams(opts.filterState()),
        });
        return result as FeedResponse;
      } catch (e) {
        if (typeof window === "undefined") throw e;
        if (!navigator.onLine) {
          const cached = await getCachedNews(50);
          if (cached?.length) {
            toast("Sin conexión — mostrando artículos guardados", "warning");
            return {
              news: cached as unknown as ApiNewsCard[],
              total: cached.length,
              page: 1,
              per_page: cached.length,
              location: null,
              category: null,
            };
          }
        }
        throw e;
      }
    },
    { initialValue: initialFeedResp },
  );

  createEffect(() => {
    const data = feed();
    if (data?.news && offset() === 0) {
      setAllNews(data.news.map(mapNewsCard));
      setHasMore(data.news.length >= 20);
      cacheNews(data.news).catch(() => {});

      const newsList = data.news as unknown as ApiNewsCard[];
      setTrendingItems(
        newsList
          .filter((n) => (n.sources_count ?? 1) >= 1)
          .slice(0, 10)
          .map((n) => ({ id: n.id, title: n.title, category: n.category ?? "General" })),
      );
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      setBreakingItems(
        newsList
          .filter((n) => new Date(n.created_at).getTime() >= twoHoursAgo)
          .map((n) => ({
            id: n.id,
            title: n.title,
            source: n.source_name ?? "Fuente",
            biasScore: n.bias_score ?? undefined,
            createdAt: n.created_at,
          })),
      );
    }
  });

  const refreshBlindspot = async () => {
    if (blindspotItems().length === 0) setBlindspotLoading(true);
    try {
      const res = await fetchBlindspot(10);
      if (res) setBlindspotItems(mapBlindspot(res.items as unknown as Array<Record<string, unknown>>));
    } catch {
      setBlindspotItems([]);
    } finally {
      setBlindspotLoading(false);
    }
  };

  createEffect(() => {
    opts.follows.followedIds();
    untrack(() => {
      void refreshBlindspot();
    });
  });

  const resetFeed = () => {
    setOffset(0);
    setAllNews([]);
    setHasMore(true);
    refetch();
  };

  const loadMore = async () => {
    if (!hasMore() || isLoadingMore()) return;
    setIsLoadingMore(true);
    try {
      const nextOffset = allNews().length;
      const catParam = opts.activeCategory() === "Todas" ? undefined : opts.activeCategory();
      const result = await fetchFeed({
        category: catParam,
        location_id: opts.activeLocation() ? parseInt(opts.activeLocation()!) : undefined,
        limit: 20,
        offset: nextOffset,
        following: opts.activeFeedTab() === "following",
        foryou: opts.activeFeedTab() !== "home",
        ...buildFeedFilterParams(opts.filterState()),
      });
      const newItems = (result.news ?? []).map(mapNewsCard);
      setAllNews((prev) => [...prev, ...newItems]);
      setOffset(nextOffset + newItems.length);
      setHasMore(newItems.length >= 20);
    } catch (e) {
      console.warn("[useFeed] loadMore failed:", e);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const featuredCluster = createMemo<FeaturedCluster | null>(() => {
    const data = feed();
    if (!data?.news) return null;
    const newsList = data.news as unknown as ApiNewsCard[];
    const featured = newsList.find((n) => (n.sources_count ?? 0) >= 3);
    if (!featured) return null;
    return {
      primary: mapNewsCard(featured),
      clusterId: featured.cluster_id ?? "",
      sourcesCount: featured.sources_count ?? 1,
      sourceNames: (featured.source_names ?? (featured.source_name ? [featured.source_name] : [])).slice(0, 5),
    };
  });

  const mappedNews = createMemo<NewsItem[]>(() => {
    let items = allNews();
    const tab = opts.activeFeedTab();
    if (tab === "following") {
      const followedIds = opts.follows.followedIds();
      if (followedIds.size > 0) {
        items = items.filter((n) => n.sourceId != null && followedIds.has(n.sourceId));
      } else {
        items = [];
      }
    }
    const q = searchQuery().toLowerCase().trim();
    if (q) {
      items = items.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.summary.toLowerCase().includes(q) ||
          n.category.toLowerCase().includes(q),
      );
    }

    // Tag emerging-cluster cards so NewsCard can render the badge.
    // We do this AFTER filters so the badge stays visible even when
    // a user has narrowed to "All"; the `isEmerging` flag is purely
    // informational and doesn't change ordering.
    const emergingIds = emergingClusterIds();
    if (emergingIds.size > 0) {
      items = items.map((n) => (emergingIds.has(n.clusterId) ? { ...n, isEmerging: true } : n));
    }
    return items;
  });

  const topSourcesForDrawer = createMemo<{ name: string; count: number; biasColor: string }[]>(() => {
    const counts: Record<string, { name: string; count: number; biasColor: string }> = {};
    for (const n of mappedNews()) {
      if (!counts[n.source]) counts[n.source] = { name: n.source, count: 0, biasColor: n.biasColor };
      counts[n.source].count++;
    }
    return Object.values(counts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  });

  const refreshBreaking = async () => {
    try {
      const r = await fetchBreaking(50);
      if (r) setBreakingItems(r.news as unknown as BreakingItem[]);
    } catch {
      // keep last known breaking list
    }
  };

  return {
    allNews,
    offset,
    hasMore,
    isLoadingMore,
    feed,
    featuredCluster,
    mappedNews,
    topSourcesForDrawer,
    trendingItems,
    breakingItems,
    blindspotItems,
    blindspotLoading,
    emergingClusterIds,
    searchQuery,
    setSearchQuery,
    resetFeed,
    loadMore,
    refreshBlindspot,
    refreshBreaking,
    refreshEmerging,
  };
}
