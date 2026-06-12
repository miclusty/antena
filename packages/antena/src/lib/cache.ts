// ═══════════════════════════════════════════
// Client-side cache helpers (TanStack Query)
// ═══════════════════════════════════════════
// Note: server-side caching (caches.default) lives in
// packages/api/src/lib/cache.ts. This file is for the Antena
// browser app — it configures TanStack Query's in-memory cache,
// query keys, and per-endpoint defaults.

import { QueryClient } from '@tanstack/solid-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

export interface FeedParams {
  location_id?: number;
  category?: string;
  limit?: number;
  offset?: number;
  bias?: string;
  time?: string;
  min_quality?: number;
}

export const feedQueryKey = (params: FeedParams) => ['feed', params] as const;
export const articleQueryKey = (id: string) => ['article', id] as const;
export const clusterQueryKey = (id: string) => ['cluster', id] as const;
export const locationsQueryKey = () => ['locations'] as const;
export const categoriesQueryKey = () => ['categories'] as const;
export const searchQueryKey = (q: string, limit?: number) => ['search', { q, limit: limit ?? 20 }] as const;
export const statsQueryKey = () => ['stats'] as const;
export const bookmarksQueryKey = () => ['bookmarks'] as const;
