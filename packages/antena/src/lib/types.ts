// ═══════════════════════════════════════════
// Core types
// ═══════════════════════════════════════════

export interface VoiceBreakdown {
  label: string;
  color: string;
  pct: number;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  source: string;
  sourceId?: number | null;
  sourceUrl?: string;
  time: string;
  location: string;
  bias: string;
  biasScore: number | null;
  biasColor: string;
  biasGradientColor: string;
  intensity: number;
  signalLevel: number;
  isGacetilla: boolean;
  gacetillaConf?: number;
  isClickbait: boolean;
  clickbaitAnswer?: string;
  propagation: PropagationEvent[];
  // Pre-existing inconsistency: the field is named `voces` in the
  // type (Spanish) but the rest of the code uses `voices` (English)
  // — see ArticleDetail.tsx and BiasBreakdownBar.tsx. We support
  // both names via a union so existing call sites keep working
  // while new code can use either.
  voces: VoiceBreakdown[];
  voices?: VoiceBreakdown[];
  clusterId: string;
  sourcesCount: number;
  imageUrl?: string;
  publishedAt: string;
  // Engagement counters (server-side, denormalized on news_cards).
  upvotes?: number;
  downvotes?: number;
  reposts?: number;
  // Useful feedback (S3.5).
  useful_yes?: number;
  useful_no?: number;
  /** Local override of the device's current vote. Used to
   *  color the buttons while waiting for the server response. */
  myVote?: -1 | 0 | 1;
  /** Local override of the device's useful vote (S3.5). */
  myUseful?: 0 | 1;
  // Byline / author (S3.7). Empty string means "no byline".
  author?: string;
  // Canonical URL pieces. When present, build the
  // canonical /<slug_date>/<slug>/ URL instead of the
  // legacy ?view=article&id=<uuid>.
  slug?: string | null;
  slugDate?: string | null;
  // Raw HTML body (S3.3). The TOC + scroll-to-heading
  // rendering uses this; the plain `body` is the
  // HTML-stripped fallback for places that don't render
  // HTML (TTS, summaries, etc.).
  body_html?: string;
  // Heading list extracted from body_html (S3.3). Empty
  // when the body has no h2/h3. The TOC component renders
  // only when this has ≥2 entries.
  headings?: { level: 2 | 3; text: string; id: string }[];
}

interface _ForceLspRefetch {
  body_html?: string;
  headings?: { level: 2 | 3; text: string; id: string }[];
}
void (null as unknown as _ForceLspRefetch);

export interface PropagationEvent {
  time: string;
  label: string;
  text: string;
  isOrigin: boolean;
}

export interface Category {
  name: string;
  icon: string;
  slug: string;
}

export interface Location {
  name: string;
  slug: string;
  icon: string;
}

// ═══════════════════════════════════════════
// API types
// ═══════════════════════════════════════════

export interface ApiResponse<T> {
  data: T;
  total: number;
  page: number;
  hasMore: boolean;
}

export interface FeedParams {
  category?: string;
  location?: string;
  page?: number;
  limit?: number;
}

// ═══════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════

export const CATEGORIES: Category[] = [
  { name: 'Todas', icon: 'grid_view', slug: 'all' },
  { name: 'Política', icon: 'gavel', slug: 'politica' },
  { name: 'Economía', icon: 'trending_up', slug: 'economia' },
  { name: 'Deportes', icon: 'sports_soccer', slug: 'deportes' },
  { name: 'Policiales', icon: 'local_police', slug: 'policiales' },
  { name: 'Cultura', icon: 'theater_comedy', slug: 'cultura' },
  { name: 'Tecnología', icon: 'devices', slug: 'tecnologia' },
  { name: 'Sociedad', icon: 'groups', slug: 'sociedad' },
];

export const LOCATIONS: Location[] = [
  { name: 'Córdoba', slug: 'cordoba', icon: 'home' },
  { name: 'Buenos Aires', slug: 'buenos-aires', icon: 'work' },
];
