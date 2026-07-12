// ═══════════════════════════════════════════
// API Client for AKIRA + Hono API
// ═══════════════════════════════════════════

// API_BASE is the Workers API. Production points to
// akira-api.miclusty.workers.dev. Set PUBLIC_API_BASE in
// .env.production to override. The localhost fallback is
// only used in dev (wrangler dev → 8787).
const API_BASE_FALLBACK = "https://akira-api.miclusty.workers.dev";
const API_BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.PUBLIC_API_BASE as string) || API_BASE_FALLBACK;

// safeFetch: wrap every API call in this so a network
// error becomes `null` instead of an unhandled promise
// rejection bubbling out to the console. The browser
// logs unhandled rejections aggressively and they're
// a Top-3 cause of "Why is my console full of red?"
// support tickets for news sites.
async function safeFetch(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  }
}

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
  // Useful feedback (S3.5). Default 0.
  useful_yes?: number;
  useful_no?: number;
  /** Set to true when at least one user has reported this
   *  article (S3.6). Mostly used for admin visibility. */
  is_reported?: boolean;
  // Byline (S3.7). Empty string when the source didn't
  // expose an author. ANTENA hides the row when empty.
  author?: string;
  // Raw HTML body (S3.3). Used by the TOC to compute
  // headings AND to render the body with anchor IDs. The
  // mapper strips a sanitized version for the plain-text
  // summary and keeps the original here for HTML rendering.
  body_html?: string;
  // Canonical URL pieces (migration 0007). When both are
  // present, the canonical URL is /<slug_date>/<slug>/
  // (slashes, not dashes — see AGENTS.md).
  slug?: string | null;
  slug_date?: string | null;
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

  const res = await safeFetch(`${API_BASE}/api/news/feed?${params}`);
  if (!res) return { news: [], total: 0, page: 0, per_page: 0, location: null, category: null, served_at: new Date().toISOString() };
  return res.json();
}

export async function fetchNewsById(id: string): Promise<ApiNewsCard | null> {
  const res = await safeFetch(`${API_BASE}/api/news/${id}`);
  if (!res) return null;
  const data = await res.json();
  if (data.error) return null;
  return data;
}

// ─── LLM-friendly markdown export (Task 16) ─────────────────────
// Static path generation calls /api/news/feed to build the slug
// tree (the DB has no slug/slug_date columns). The GET handler
// then fetches the full article by id and renders markdown with
// YAML frontmatter.
export interface ArticleMarkdown {
  id: string;
  title: string;
  slug: string;
  slug_date: string;
  summary: string;
  body: string | null;
  source_name: string | null;
  source_url: string | null;
  author: string | null;
  category: string | null;
  location_name: string | null;
  published_at: string;
  sources: { name: string; url: string }[];
}

export async function fetchArticleMarkdownData(
  id: string,
  apiBase: string,
): Promise<ArticleMarkdown | null> {
  try {
    const res = await fetch(`${apiBase}/api/news/${id}`, {
      headers: { 'User-Agent': 'AntenaSSRBatcher/1.0' },
    });
    if (!res.ok) return null;
    const data = await res.json() as ArticleMarkdown & { news?: ArticleMarkdown; error?: string };
    if (data.error) return null;
    // API may return either { news: {...} } (legacy) or the card directly.
    return (data.news ?? data) as ArticleMarkdown;
  } catch {
    return null;
  }
}

export async function fetchNewsByIds(ids: string[]): Promise<ApiNewsCard[]> {
  const results = await Promise.allSettled(
    ids.map(id => safeFetch(`${API_BASE}/api/news/${id}`).then(r => r ? r.json() : null))
  );
  return results
    .filter((r): r is PromiseFulfilledResult<ApiNewsCard> => r.status === 'fulfilled' && !r.value.error)
    .map(r => r.value);
}

export async function fetchNewsByCluster(id: string): Promise<{ cluster_id: string; news: ApiNewsCard[] } | null> {
  const res = await safeFetch(`${API_BASE}/api/news/${id}/cluster`);
  if (!res) return null;
  return res.json();
}

export async function fetchLocations(): Promise<ApiLocation[]> {
  const res = await safeFetch(`${API_BASE}/api/locations/tree`);
  if (!res) return [];
  return res.json();
}

export async function fetchCategories(): Promise<ApiCategory[]> {
  const res = await safeFetch(`${API_BASE}/api/categories`);
  if (!res) return [];
  return res.json();
}

export async function fetchMasterArticle(clusterId: string): Promise<MasterArticle | null> {
  const res = await safeFetch(`${API_BASE}/api/synthesis/master/${clusterId}`);
  if (!res) return null;
  const data = await res.json();
  // The worker returns `{ synthesis: null, reason: ... }`
  // (200) when AKIRA isn't configured in this environment,
  // and `{ synthesis: null, reason: "not_found" }` (404)
  // when AKIRA is reachable but no master exists yet.
  // Both are "no master" — return null and let the UI
  // show the raw news card.
  if (data?.synthesis === null) return null;
  if (!data?.title) return null;
  return data;
}

export async function fetchStats(): Promise<StatsResponse> {
  const res = await safeFetch(`${API_BASE}/api/stats/health`);
  if (!res) {
    return {
      status: 'ok',
      stats: { total_news: 0, active_sources: 0, total_locations: 0, news_last_hour: 0, news_today: 0, news_week: 0, total_clusters: 0 },
    };
  }
  return res.json();
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

export async function fetchSearch(q: string, limit = 20, filters?: {
  category?: string;
  source_id?: number;
  time?: "hour" | "today" | "week" | "all";
}): Promise<SearchResponse> {
  if (!q || q.length < 2) return { q, results: [], total: 0 };
  const params = new URLSearchParams();
  params.set("q", q);
  params.set("limit", String(limit));
  if (filters?.category) params.set("category", filters.category);
  if (filters?.source_id) params.set("source_id", String(filters.source_id));
  if (filters?.time && filters.time !== "all") params.set("time", filters.time);
  const res = await safeFetch(`${API_BASE}/api/search?${params}`);
  if (!res) return { q, results: [], total: 0 };
  return res.json();
}

export async function fetchFeaturedStory(): Promise<FeaturedStoryResponse> {
  const res = await safeFetch(`${API_BASE}/api/news/featured`);
  if (!res) return { featured: null };
  return res.json();
}

export async function fetchBreaking(limit = 20): Promise<BreakingResponse | null> {
  const res = await safeFetch(`${API_BASE}/api/news/breaking?limit=${limit}`);
  if (!res) return null;
  return res.json();
}

export async function fetchTrending(limit = 10, hours = 24): Promise<TrendingResponse | null> {
  const res = await safeFetch(`${API_BASE}/api/news/trending?limit=${limit}&hours=${hours}`);
  if (!res) return null;
  return res.json();
}

export async function fetchCities(): Promise<ApiCity[]> {
  const res = await safeFetch(`${API_BASE}/api/locations/cities`);
  if (!res) return [];
  const data = await res.json();
  return data.cities ?? [];
}

export async function fetchBlindspot(limit = 10): Promise<{ items: unknown[]; total: number } | null> {
  const res = await safeFetch(`${API_BASE}/api/news/blindspot?limit=${limit}`);
  if (!res) return null;
  return res.json();
}

// ─── Emerging themes (S3.9) ───────────────────────────────────
// "Emerging" = cluster with multiple distinct sources converging
// within the last few hours. Sourced from AKIRA's emerging_themes
// detector (see packages/akira/core/emerging_themes.py). Surfaced
// in the TrendingSection as a 1h-or-so overlay.
//
// Returns null when the network fails so callers can fall back to
// fetchTrending() without an exception.

export interface EmergingCluster {
  cluster_id: string;
  title: string | null;
  velocity_score: number;
  new_articles_in_window: number;
  distinct_sources_in_window: number;
  credibility_avg: number;
  first_seen_at: string | null;
  last_updated_at: string | null;
}

export interface EmergingResponse {
  emerging: EmergingCluster[];
  computed_at: string;
  window_hours: number;
  /** "materialized" = served from the cron-filled mirror table;
   *  "live" = computed on the fly when the mirror is stale.
   *  Surfaced in dev tools to verify the cron is firing. */
  source: "materialized" | "live";
}

export async function fetchEmerging(windowHours = 6, minScore = 0): Promise<EmergingResponse | null> {
  const res = await safeFetch(`${API_BASE}/api/emerging?window_hours=${windowHours}&min_score=${minScore}`);
  if (!res) return null;
  try {
    return (await res.json()) as EmergingResponse;
  } catch {
    return null;
  }
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
  credibility_score?: number;
  credibility_updated_at?: string | null;
  retraction_count?: number;
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

async function postJson<T>(path: string, body: Record<string, unknown> = {}): Promise<T | null> {
  const deviceId = getDeviceId();
  if (!deviceId) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, ...body }),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchVote(
  newsId: string,
  vote: -1 | 0 | 1,
): Promise<VoteResponse | null> {
  return postJson<VoteResponse>(`/api/news/${newsId}/vote`, { vote });
}

export async function fetchRepost(newsId: string): Promise<{ reposts: number; alreadyReposted: boolean } | null> {
  return postJson<{ reposts: number; alreadyReposted: boolean }>(`/api/news/${newsId}/repost`, {});
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

// ─── Article feedback + reports (S3.5 + S3.6) ──────────────────
// Per-device signals. Local optimistic update on click; the
// server response carries the canonical counts.

export type UsefulVote = 0 | 1;

export interface FeedbackResponse {
  useful_yes: number;
  useful_no: number;
  myUseful: UsefulVote;
}

export async function fetchFeedback(
  newsId: string,
  useful: UsefulVote,
): Promise<FeedbackResponse | null> {
  const deviceId = getDeviceId();
  if (!deviceId) return null;
  try {
    const res = await fetch(`${API_BASE}/api/news/${newsId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, useful }),
    });
    if (!res.ok) return null;
    return (await res.json()) as FeedbackResponse;
  } catch {
    return null;
  }
}

export type ReportReason = "incorrect" | "clickbait" | "duplicate" | "spam" | "other";

export async function fetchReport(
  newsId: string,
  reason: ReportReason,
  note?: string,
): Promise<boolean> {
  const deviceId = getDeviceId();
  if (!deviceId) return false;
  try {
    const res = await fetch(`${API_BASE}/api/news/${newsId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: deviceId, reason, note }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface BiasKeyQuote {
  source: string;
  quote: string;
}

export interface BiasNarrative {
  cluster_id: string;
  narrative: string;
  key_quotes: BiasKeyQuote[];
  source: string;
  generated_at: string | null;
}

export async function fetchBiasNarrative(
  clusterId: string,
): Promise<BiasNarrative | null> {
  try {
    const res = await fetch(`${API_BASE}/api/clusters/${clusterId}/bias-narrative`);
    if (!res.ok) return null;
    return (await res.json()) as BiasNarrative;
  } catch {
    return null;
  }
}

// ─── Contradictions (numerical/factual disagreements) ─────────────
// The detector runs in AKIRA (core/contradiction_detector.py) and
// writes a JSON payload to clusters.contradictions_json. The shape:
//   { subject, unit, values, entries, confidence }
export interface ContradictionEntry {
  source: string;
  value: number;
  raw_text: string;
}

export interface Contradiction {
  subject: string;
  unit: string | null;
  values: number[];
  entries: ContradictionEntry[];
  confidence: number;
}

export interface ContradictionsResponse {
  cluster_id: string;
  contradictions: Contradiction[];
  count: number;
  stored_count: number;
  generated_at: string | null;
}

export async function fetchContradictions(
  clusterId: string,
): Promise<ContradictionsResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/clusters/${clusterId}/contradictions`);
    if (!res.ok) return null;
    return (await res.json()) as ContradictionsResponse;
  } catch {
    return null;
  }
}

// ─── Entity graph ──────────────────────────────────────────────────
// Powers "Personas/entidades mencionadas" panels on article pages,
// "Personas que más cubre" leaderboards on source profiles, and
// the /api/entities/search autocomplete.
//
// The fields on `EntitySummary` are intentionally narrow — just enough
// to render a chip + link. Bigger payloads (timeline, related entities)
// live on EntityDetail.

export interface EntitySummary {
  id: number;
  name: string;
  type: "person" | "place" | "org" | "event";
  mention_count: number;
  recent_count?: number;
  card_count?: number;
}

export interface EntityDetail extends EntitySummary {
  first_seen?: string | null;
  last_seen?: string | null;
  related?: EntitySummary[];
}

export interface EntityTimelinePoint {
  day: string;
  count: number;
}

export async function fetchTopEntities(options?: {
  limit?: number;
  days?: number;
  type?: "person" | "place" | "org" | "event";
}): Promise<EntitySummary[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.days !== undefined) params.set("days", String(options.days));
  if (options?.type) params.set("type", options.type);
  try {
    const res = await fetch(`${API_BASE}/api/entities/top?${params}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { entities?: EntitySummary[] };
    return data.entities ?? [];
  } catch {
    return [];
  }
}

export async function fetchEntityDetail(id: number): Promise<EntityDetail | null> {
  try {
    const res = await fetch(`${API_BASE}/api/entities/${id}?include=related&related_limit=10`);
    if (!res.ok) return null;
    return (await res.json()) as EntityDetail;
  } catch {
    return null;
  }
}

export async function fetchEntityTimeline(
  id: number,
  days = 30,
): Promise<EntityTimelinePoint[]> {
  try {
    const res = await fetch(`${API_BASE}/api/entities/${id}/timeline?days=${days}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { timeline?: EntityTimelinePoint[] };
    return data.timeline ?? [];
  } catch {
    return [];
  }
}

export async function searchEntities(
  q: string,
  limit = 10,
): Promise<EntitySummary[]> {
  if (!q || q.trim().length < 2) return [];
  try {
    const res = await fetch(`${API_BASE}/api/entities/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: EntitySummary[] };
    return data.results ?? [];
  } catch {
    return [];
  }
}

export async function fetchEntitiesByCard(
  newsId: string,
  limit = 5,
): Promise<EntitySummary[]> {
  try {
    const res = await fetch(`${API_BASE}/api/entities/by-card/${encodeURIComponent(newsId)}?limit=${limit}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { entities?: (EntitySummary & { confidence?: number })[] };
    return (data.entities ?? []).map(({ confidence: _confidence, ...rest }) => rest as EntitySummary);
  } catch {
    return [];
  }
}

export async function fetchEntitiesBySource(
  sourceId: number,
  limit = 5,
): Promise<EntitySummary[]> {
  try {
    const res = await fetch(`${API_BASE}/api/entities/by-source/${sourceId}?limit=${limit}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { entities?: EntitySummary[] };
    return data.entities ?? [];
  } catch {
    return [];
  }
}
