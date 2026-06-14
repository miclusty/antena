// ═══════════════════════════════════════════
// API Client for AKIRA + Hono API
// ═══════════════════════════════════════════

// API_BASE is the Workers API. We default to localhost:8787 (wrangler dev
// default) — NOT 5000, which is the Python AKIRA port. Set
// PUBLIC_API_BASE in .env.production to point at api.antena.com.ar.
const API_BASE_FALLBACK = "http://localhost:8787";
const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.PUBLIC_API_BASE as string) || API_BASE_FALLBACK;
// AKIRA_BASE points at the Python extractor (NOT the API). It only runs
// on the dev machine, not in production. Caller code must check for null.
const AKIRA_BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.PUBLIC_AKIRA_BASE as string) || 'http://localhost:5000';

export interface ApiNewsCard {
  id: string;
  location_id: number;
  title: string;
  summary: string;
  body?: string;
  image_url: string | null;
  bias_score: number | null;
  is_gacetilla: number;
  cluster_id: string | null;
  category: string | null;
  source_ids: string | null;
  source_names?: string[];
  source_name?: string | null;
  source_url?: string | null;
  source_id?: number | null;
  location_name?: string | null;
  location_province?: string | null;
  published_at: string | null;
  created_at: string;
  sources_count?: number;
  quality_score?: number | null;
  // Engagement counters from /api/news/{id}/vote and /repost.
  // Default 0 in older D1 rows (migration 0002 added the columns
  // — rows written before that migration return 0 via the
  // column DEFAULT 0 in the schema).
  upvotes?: number;
  downvotes?: number;
  reposts?: number;
}

export interface MasterArticle {
  id: string;
  cluster_id: string;
  title: string;
  summary: string;
  body?: string;
  sources_count: number;
  bias_min: number;
  bias_max: number;
  bias_avg: number;
  created_at: string;
}

export interface ApiLocation {
  id: number;
  name: string;
  province: string;
  country: string;
  type: string;
  parent_id: number | null;
  lat: number | null;
  lng: number | null;
  population: number | null;
}

export interface ApiCategory {
  id: number;
  slug: string;
  name: string;
  icon: string;
}

export interface FeedResponse {
  news: ApiNewsCard[];
  total: number;
  page: number;
  per_page: number;
  location: string | null;
  category: string | null;
  /** Server-side timestamp of when this response was generated.
   *  The /api/news/feed handler in routes/news.ts always sets it
   *  (used for cache diagnostics and for the "actualizado hace X"
   *  hint in the "estás al día" divider). Older cached responses
   *  may omit it; treat as null in that case. */
  served_at?: string;
}

export interface StatsResponse {
  status: string;
  stats: {
    total_news: number;
    active_sources: number;
    total_locations: number;
    news_last_hour: number;
    news_today: number;
    news_week: number;
    total_clusters: number;
  };
}

// ═══════════════════════════════════════════
// API Functions
// ═══════════════════════════════════════════

export async function fetchFeed(options?: {
  location_id?: number;
  category?: string;
  limit?: number;
  offset?: number;
  bias?: string;
  time?: string;  // 'hour' | 'today' | 'week' | 'all'
  min_quality?: number;  // 0.0 to 1.0 minimum quality score filter
  following?: boolean;   // restrict to the caller's followed sources
  foryou?: boolean;      // personalized quality-ranked feed ("Para vos")
}): Promise<FeedResponse> {
  const params = new URLSearchParams();
  if (options?.location_id) params.set('location_id', String(options.location_id));
  if (options?.category) params.set('category', options.category);
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.bias) params.set('bias', options.bias);
  if (options?.time && options.time !== 'all') params.set('time', options.time);
  if (options?.min_quality !== undefined) params.set('min_quality', String(options.min_quality));
  if (options?.following) {
    params.set('following', 'true');
    if (typeof window !== 'undefined') {
      const deviceId = getAntenaDeviceId();
      if (deviceId) params.set('device_id', deviceId);
    }
  }
  if (options?.foryou) {
    // Sends device_id so the server can later do per-user
    // personalization (e.g. demote already-read items) without
    // requiring a second round-trip from the client. The current
    // SQL uses device_id only for variety scoring; future work
    // (S0.1+2 votes) will join against user_engagement.
    params.set('foryou', 'true');
    if (typeof window !== 'undefined') {
      const deviceId = getAntenaDeviceId();
      if (deviceId) params.set('device_id', deviceId);
    }
  }

  const res = await fetch(`${API_BASE}/api/news/feed?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status}`);
  return res.json();
}

export async function fetchNewsById(id: string): Promise<ApiNewsCard> {
  const res = await fetch(`${API_BASE}/api/news/${id}`);
  if (!res.ok) throw new Error(`News not found: ${id}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export async function fetchNewsByIds(ids: string[]): Promise<ApiNewsCard[]> {
  const results = await Promise.allSettled(
    ids.map(id => fetch(`${API_BASE}/api/news/${id}`).then(r => r.json()))
  );
  return results
    .filter((r): r is PromiseFulfilledResult<ApiNewsCard> => r.status === 'fulfilled' && !r.value.error)
    .map(r => r.value);
}

export async function fetchNewsByCluster(id: string): Promise<{ cluster_id: string; news: ApiNewsCard[] }> {
  const res = await fetch(`${API_BASE}/api/news/${id}/cluster`);
  if (!res.ok) throw new Error(`Cluster not found: ${id}`);
  return res.json();
}

export async function fetchLocations(): Promise<ApiLocation[]> {
  const res = await fetch(`${API_BASE}/api/locations/tree`);
  if (!res.ok) throw new Error('Failed to fetch locations');
  return res.json();
}

export async function fetchCategories(): Promise<ApiCategory[]> {
  const res = await fetch(`${API_BASE}/api/categories`);
  if (!res.ok) throw new Error('Failed to fetch categories');
  return res.json();
}

export async function fetchMasterArticle(clusterId: string): Promise<MasterArticle | null> {
  try {
    const res = await fetch(`${API_BASE}/api/synthesis/master/${clusterId}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.title) return null;
    return data;
  } catch {
    return null;
  }
}

export async function fetchStats(): Promise<StatsResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/stats/health`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
  } catch {
    return {
      status: 'ok',
      stats: { total_news: 0, active_sources: 0, total_locations: 0, news_last_hour: 0, news_today: 0, news_week: 0, total_clusters: 0 },
    };
  }
}

export interface BreakingResponse {
  news: ApiNewsCard[];
  total: number;
  lastUpdated: string;
}

export interface TrendingResponse {
  news: ApiNewsCard[];
  total: number;
}

export interface ApiCity {
  id: number;
  name: string;
  province: string;
  count: number;
}

export interface CitiesResponse {
  cities: ApiCity[];
}

export interface SearchResponse {
  q: string;
  results: ApiNewsCard[];
  total: number;
}

export interface FeaturedStoryResponse {
  featured: {
    primary: ApiNewsCard;
    clusterId: string;
    sourcesCount: number;
    cardCount: number;
    sourceNames: string[];
    allCards: ApiNewsCard[];
  } | null;
  message?: string;
}

export async function fetchSearch(q: string, limit = 20): Promise<SearchResponse> {
  if (!q || q.length < 2) return { q, results: [], total: 0 };
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    return res.json();
  } catch {
    return { q, results: [], total: 0 };
  }
}

export async function fetchFeaturedStory(): Promise<FeaturedStoryResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/news/featured`);
    if (!res.ok) throw new Error(`Failed to fetch featured: ${res.status}`);
    return res.json();
  } catch {
    return { featured: null };
  }
}

export async function fetchBreaking(limit = 20): Promise<BreakingResponse> {
  const res = await fetch(`${API_BASE}/api/news/breaking?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to fetch breaking: ${res.status}`);
  return res.json();
}

export async function fetchTrending(limit = 10, hours = 24): Promise<TrendingResponse> {
  const res = await fetch(`${API_BASE}/api/news/trending?limit=${limit}&hours=${hours}`);
  if (!res.ok) throw new Error(`Failed to fetch trending: ${res.status}`);
  return res.json();
}

export async function fetchCities(): Promise<ApiCity[]> {
  const res = await fetch(`${API_BASE}/api/locations/cities`);
  if (!res.ok) throw new Error('Failed to fetch cities');
  const data = await res.json();
  return data.cities ?? [];
}

export async function fetchBlindspot(limit = 10) {
  const res = await fetch(`${API_BASE}/api/news/blindspot?limit=${limit}`);
  return (await res.json()) as { items: any[]; total: number };
}

// ─── Source follows ────────────────────────────────────────
// Until we have real auth, follows are scoped to a device_id —
// a UUID generated on first visit and stored in localStorage.
// The feed endpoint (with ?following=true) reads it back to
// filter the feed to the user's followed sources.

const DEVICE_ID_KEY = "antena-device-id";

function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      localStorage.setItem(DEVICE_ID_KEY, id);
    } catch {
      /* private mode — keep in-memory only */
    }
  }
  return id;
}

export function getAntenaDeviceId(): string {
  return getDeviceId();
}

export interface FollowedSource {
  sourceId: number;
  sourceName: string | null;
  sourceUrl: string | null;
  sourceDomain: string | null;
  createdAt: string;
}

export interface ApiSourceEntry {
  id: number;
  name: string;
  url: string;
  type?: string;
  reliability_score?: number;
  bias_score?: number;
  is_active?: number;
  news_count?: number;
  location_name?: string | null;
  province?: string | null;
}

export interface ApiSourceProfile {
  source: ApiSourceEntry;
  news: ApiNewsCard[];
}

export async function fetchSources(limit = 50): Promise<ApiSourceEntry[]> {
  try {
    const res = await fetch(`${API_BASE}/api/stats/sources?limit=${limit}`);
    if (!res.ok) return [];
    return (await res.json()) as ApiSourceEntry[];
  } catch {
    return [];
  }
}

export async function fetchSourceProfile(id: number): Promise<ApiSourceProfile | null> {
  try {
    const res = await fetch(`${API_BASE}/api/stats/sources/${id}`);
    if (!res.ok) return null;
    return (await res.json()) as ApiSourceProfile;
  } catch {
    return null;
  }
}

export async function fetchFollows(): Promise<FollowedSource[]> {
  const deviceId = getDeviceId();
  if (!deviceId) return [];
  try {
    const res = await fetch(
      `${API_BASE}/api/me/follows?device_id=${encodeURIComponent(deviceId)}`
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { follows: FollowedSource[] };
    return body.follows ?? [];
  } catch {
    return [];
  }
}

export async function followSource(sourceId: number): Promise<boolean> {
  const deviceId = getDeviceId();
  if (!deviceId) return false;
  try {
    const res = await fetch(
      `${API_BASE}/api/sources/${sourceId}/follow?device_id=${encodeURIComponent(deviceId)}`,
      { method: "POST" }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function unfollowSource(sourceId: number): Promise<boolean> {
  const deviceId = getDeviceId();
  if (!deviceId) return false;
  try {
    const res = await fetch(
      `${API_BASE}/api/sources/${sourceId}/follow?device_id=${encodeURIComponent(deviceId)}`,
      { method: "DELETE" }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchFeedFiltered(
  options: { following?: boolean; sourceIds?: number[]; category?: string; location_id?: number; limit?: number; offset?: number }
): Promise<FeedResponse> {
  const params = new URLSearchParams();
  if (options.following) {
    const deviceId = getDeviceId();
    if (deviceId) params.set("following", "true");
    params.set("device_id", deviceId);
  }
  if (options.sourceIds && options.sourceIds.length > 0) {
    params.set("source_ids", options.sourceIds.join(","));
  }
  if (options.category) params.set("category", options.category);
  if (options.location_id) params.set("location_id", String(options.location_id));
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  const res = await fetch(`${API_BASE}/api/news/feed?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch feed: ${res.status}`);
  return res.json();
}

// ─── Engagement: votes + reposts ────────────────────────────
// Per-device signals. The frontend keeps a local signal of the
// user's current vote (1 / -1 / 0) so the UI updates immediately;
// the server response is the source of truth for the displayed
// counts. On error, we revert the local signal.

export interface VoteResponse {
  upvotes: number;
  downvotes: number;
  myVote: -1 | 0 | 1;
}

export async function fetchVote(
  newsId: string,
  vote: -1 | 0 | 1,
): Promise<VoteResponse | null> {
  const deviceId = getDeviceId();
  if (!deviceId) return null;
  try {
    const res = await fetch(`${API_BASE}/api/news/${newsId}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, vote }),
    });
    if (!res.ok) return null;
    return (await res.json()) as VoteResponse;
  } catch {
    return null;
  }
}

export async function fetchRepost(newsId: string): Promise<{ reposts: number; alreadyReposted: boolean } | null> {
  const deviceId = getDeviceId();
  if (!deviceId) return null;
  try {
    const res = await fetch(`${API_BASE}/api/news/${newsId}/repost`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchUnrepost(newsId: string): Promise<{ reposts: number; removed: boolean } | null> {
  const deviceId = getDeviceId();
  if (!deviceId) return null;
  try {
    const res = await fetch(`${API_BASE}/api/news/${newsId}/repost?device_id=${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
