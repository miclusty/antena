export interface Location {
  id: number;
  name: string;
  province: string;
  department: string | null;
  lat: number;
  lng: number;
  type: "pais" | "provincia" | "departamento" | "ciudad" | "pueblo";
  population: number | null;
  country: string;
}

export interface NewsCard {
  id: string;
  location_id: number | null;
  title: string;
  summary: string;
  summary_html?: string;
  body?: string | null;
  image_url: string | null;
  // Homepage of the medium (e.g. https://www.example.com).
  // The home base — same for all cards from this source.
  source_url?: string | null;
  // Specific article URL (e.g. https://www.example.com/news/2026/foo).
  // Distinct from source_url; used by re-extraction jobs
  // to re-fetch the exact article when the cascade improves.
  article_url?: string | null;
  bias_score: number | null;
  is_gacetilla: number;
  cluster_id: string | null;
  category: string | null;
  source_ids: string | null;
  source_id?: number | null;
  source_name?: string | null;
  sources_count?: number;
  quality_score?: number | null;
  published_at: string | null;
  created_at: string;
  // SEO slug + slug_date (Phase 2 Task 25). Populated by
  // AKIRA's `make_slug()` and the backfill script; empty for
  // legacy rows that haven't been migrated yet. The canonical
  // article URL is `/noticia/{slug_date}/{slug}`.
  slug: string;
  slug_date: string;
  // Joined fields
  location_name?: string | null;
  location_province?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
}

export interface Source {
  id: number;
  name: string;
  url: string;
  location_id: number | null;
  reliability_score: number;
  is_active: number;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
}

export interface FeedResponse {
  news: NewsCard[];
  location: Location | null;
  category: string | null;
  total: number;
  page: number;
  per_page: number;
}

export interface IngestRequest {
  id: string;
  location_id: number;
  title: string;
  summary: string;
  image_url?: string;
  image_data?: string;
  bias_score?: number;
  is_gacetilla?: boolean;
  cluster_id?: string;
  category?: string;
  source_ids?: string;
  published_at?: string;
}

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  IMAGES: R2Bucket;
  VECTORS: VectorizeIndex;
  ANALYTICS: AnalyticsEngineDataset;
  IMAGE_QUEUE: Queue;
  ENVIRONMENT: "development" | "staging" | "production";
  API_KEY?: string;
  PULSO_API_KEY?: string;
  MINIMAX_API_KEY?: string;
  AKIRA_URL?: string;
  DISCORD_WEBHOOK_URL?: string;
}

export type Bindings = Env;
