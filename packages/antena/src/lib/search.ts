// ═══════════════════════════════════════════
// Search query helpers
// ═══════════════════════════════════════════
// Hits the /api/search endpoint (see packages/api/src/routes/search.ts
// and searchQuerySchema in packages/api/src/lib/schemas.ts). Returns
// FTS5 + Vectorize hybrid results.
//
// We re-declare the SearchQuery schema here instead of cross-package
// importing — keeps the Antena bundle self-contained and avoids the
// `@cloudflare/workers-types` / zod version drift between Workers
// and browser runtimes.

import { z } from 'zod';

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export interface SearchResult {
  id: string;
  title: string;
  summary: string;
  category?: string;
  source?: string;
  sourceName?: string;
  imageUrl?: string;
  publishedAt?: string;
  score?: number;
}

export interface SearchResponse {
  q: string;
  results: SearchResult[];
  total: number;
}

export async function searchNews(
  query: string,
  limit = 20
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`/api/search?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Search failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as SearchResponse;
}

export function parseSearchQuery(input: unknown): SearchQuery {
  return searchQuerySchema.parse(input);
}
