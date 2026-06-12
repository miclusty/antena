// ═══════════════════════════════════════════
// Core types
// ═══════════════════════════════════════════

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  source: string;
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
  voices: VoiceBreakdown[];
  clusterId: string;
  sourcesCount: number;
  imageUrl?: string;
  publishedAt: string;
}

export interface PropagationEvent {
  time: string;
  label: string;
  text: string;
  isOrigin: boolean;
}

export type { VoiceBreakdown } from './bias';

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
