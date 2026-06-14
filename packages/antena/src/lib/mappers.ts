// ═══════════════════════════════════════════
// Type Mappers: API Response → Frontend Types
// ═══════════════════════════════════════════

import type { ApiNewsCard, ApiCategory, ApiLocation } from './api';
import type { NewsItem, Category, Location, PropagationEvent } from './types';
import { getBiasInfo, getBiasGradientColor, type VoiceBreakdown, VOICE_COLORS, VOICE_LABELS } from './bias';
import { SOURCE_NAMES } from './config';

// ═══════════════════════════════════════════
// Strip HTML tags from text
// ═══════════════════════════════════════════

export function stripHtml(html: string): string {
  if (!html) return '';
  let text = html;

  text = text.replace(/\[(Facebook|Twitter|Instagram|LinkedIn|YouTube|TikTok)[^\]]*\]\([^)]*\)/gi, '');
  text = text.replace(/\[\]/g, '');
  text = text.replace(/<[^>]*>/g, '');
  text = text.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8230;/g, '...')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8216;/g, "'")
    .replace(/&#8211;/g, '-')
    .replace(/&#8212;/g, '—');
  const postIdx = text.indexOf('The post');
  if (postIdx !== -1) text = text.slice(0, postIdx);
  text = text.replace(/\s*Leer más\s*/gi, '');
  text = text.replace(/\s+/g, ' ').trim();

  const sentences = text.match(/[^.!?]*[.!?]+/g) || [text];
  const targetLen = 280;
  let result = '';
  for (const s of sentences) {
    if ((result + s).length > targetLen + 20 && result.length > 100) break;
    result += (result ? ' ' : '') + s.trim();
  }
  if (result.length < text.length && result.length > 50) result += '...';

  return result || text;
}

// ═══════════════════════════════════════════
// Bias mapping: score (-1 to 1) → categorical
// ═══════════════════════════════════════════

export function mapBias(score: number | null | undefined) {
  const info = getBiasInfo(score);
  return {
    label: info.label,
    color: info.color,
    gradientColor: getBiasGradientColor(score),
    intensity: info.intensity,
  };
}

// ═══════════════════════════════════════════
// Time formatter: ISO → "Hace 2h"
// ═══════════════════════════════════════════

export function formatTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const now = new Date();
  const then = new Date(dateStr);
  const diffMs = now.getTime() - then.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Ahora';
  if (diffMin < 60) return `Hace ${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `Hace ${diffD}d`;
}

// ═══════════════════════════════════════════
// Signal level: computed from source count + quality score
// Higher quality + more sources = stronger signal (1-10 scale)
//
// Signal Level Computation:
//   - Base: source count (1-5 scale based on source_ids count)
//     - 1 source = 1, 2 sources = 3, 3 sources = 4, 5 sources = 6, 10+ = 8, 20+ = 10
//   - Quality multiplier: quality_score (0.0-1.0) boosts signal
//     - quality >= 0.7 (high): +1 boost
//     - quality >= 0.4 (medium): no change
//     - quality < 0.4 (low/very_low): -1 penalty
//   - Gacetillas (press releases) always receive -2 penalty
//   - Final score clamped to 1-10 range
//
// Quality Tiers (from akira_cleaner.py):
//   - high: quality_score >= 0.7
//   - medium: 0.4 <= quality_score < 0.7
//   - low: 0.2 <= quality_score < 0.4
//   - very_low: quality_score < 0.2
// ═══════════════════════════════════════════

export function computeSignalLevel(
  sourceIds: string | null,
  qualityScore: number | null | undefined = null,
  isGacetilla: boolean = false
): number {
  // Base score from source count
  let signal: number;
  if (!sourceIds) {
    signal = 1;
  } else {
    const count = sourceIds.split(',').filter(Boolean).length;
    if (count >= 20) signal = 10;
    else if (count >= 10) signal = 8;
    else if (count >= 5) signal = 6;
    else if (count >= 3) signal = 4;
    else if (count >= 2) signal = 3;
    else signal = 1;
  }

  // Quality adjustment
  if (qualityScore !== null && qualityScore !== undefined) {
    if (qualityScore >= 0.7) signal += 1;      // high quality boost
    else if (qualityScore < 0.4) signal -= 1;  // low quality penalty
    // medium (0.4-0.7): no change
  }

  // Gacetilla penalty (press releases have inherent signal inflation)
  if (isGacetilla) signal -= 2;

  // Clamp to 1-10
  return Math.max(1, Math.min(10, signal));
}

// ═══════════════════════════════════════════
// Source name lookup
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// Category extraction from title
// ═══════════════════════════════════════════

function extractCategory(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('deporte') || t.includes('gol') || t.includes('copa') || t.includes('goleó') || t.includes('venció') || t.includes('canotaje')) return 'Deportes';
  if (t.includes('dólar') || t.includes('econom') || t.includes('pago') || t.includes('inversión') || t.includes('coparticipación')) return 'Economía';
  if (t.includes('polít') || t.includes('concejo') || t.includes('municipio') || t.includes('intendente') || t.includes('gobierno') || t.includes('presidencia') || t.includes('boletín oficial')) return 'Política';
  if (t.includes('polic') || t.includes('detien') || t.includes('crimen') || t.includes('asesin')) return 'Policiales';
  if (t.includes('cultur') || t.includes('educación') || t.includes('licenciatura') || t.includes('escuela')) return 'Cultura';
  if (t.includes('tecnol') || t.includes('iphone') || t.includes('ia ') || t.includes('digital')) return 'Tecnología';
  if (t.includes('veterano') || t.includes('malvinas') || t.includes('homenaje') || t.includes('guerra')) return 'Sociedad';
  return 'Generales';
}

// ═══════════════════════════════════════════
// Map API NewsCard → Frontend NewsItem
// ═══════════════════════════════════════════

export function mapNewsCard(card: ApiNewsCard): NewsItem {
  const bias = mapBias(card.bias_score);
  const sourceCount = card.sources_count || (card.source_ids ? card.source_ids.split(',').filter(Boolean).length : 1);
  const isGacetillaFlag = card.is_gacetilla === 1;
  const signalLevel = computeSignalLevel(card.source_ids, card.quality_score, isGacetillaFlag);

  let sourceName = 'Fuente';
  if (card.source_names && card.source_names.length > 0) {
    sourceName = card.source_names[0];
  } else if (card.source_name) {
    sourceName = card.source_name;
  } else if (card.source_ids) {
    const srcId = card.source_ids.split(',')[0].trim();
    sourceName = SOURCE_NAMES[srcId] || `Fuente ${srcId}`;
  }

  let location = '';
  if (card.location_name) {
    // Avoid "Córdoba, Córdoba" when the city and province names
    // happen to be identical (e.g. Córdoba Capital / Córdoba province).
    if (card.location_province && card.location_province !== card.location_name) {
      location = `${card.location_name}, ${card.location_province}`;
    } else {
      location = card.location_name;
    }
  }

  const category = card.category || extractCategory(card.title);

  return {
    id: card.id,
    title: card.title,
    summary: stripHtml(card.summary),
    body: stripHtml(card.body || card.summary),
    category,
    source: sourceName,
    sourceId: card.source_id ?? null,
    sourceUrl: card.source_url || undefined,
    time: formatTime(card.published_at || card.created_at),
    location,
    bias: bias.label,
    biasScore: card.bias_score ?? null,
    biasColor: bias.color,
    biasGradientColor: bias.gradientColor,
    intensity: bias.intensity,
    signalLevel,
    isGacetilla: card.is_gacetilla === 1,
    gacetillaConf: card.is_gacetilla === 1 ? 70 : undefined,
    isClickbait: false,
    clusterId: card.cluster_id || '',
    sourcesCount: sourceCount,
    imageUrl: card.image_url || undefined,
    publishedAt: card.published_at || card.created_at,
    voces: computeVoices([{ bias_score: card.bias_score }]),
    propagation: [],
    upvotes: card.upvotes ?? 0,
    downvotes: card.downvotes ?? 0,
    reposts: card.reposts ?? 0,
  };
}

// ═══════════════════════════════════════════
// Compute voice breakdown from bias score
// ═══════════════════════════════════════════

export function computeVoices(clusterArticles: { bias_score: number | null }[]): VoiceBreakdown[] {
  if (!clusterArticles?.length) {
    return [
      { label: VOICE_LABELS.officialist, color: VOICE_COLORS.officialist, pct: 33 },
      { label: VOICE_LABELS.neutral, color: VOICE_COLORS.neutral, pct: 34 },
      { label: VOICE_LABELS.opposition, color: VOICE_COLORS.opposition, pct: 33 },
    ];
  }

  let officialist = 0;
  let neutral = 0;
  let opposition = 0;

  for (const a of clusterArticles) {
    const score = a.bias_score;
    if (score === null || score === undefined) { neutral++; continue; }
    if (score > 0.1) officialist++;
    else if (score < -0.1) opposition++;
    else neutral++;
  }

  const total = officialist + neutral + opposition || 1;
  return [
    { label: VOICE_LABELS.officialist, color: VOICE_COLORS.officialist, pct: Math.round((officialist / total) * 100) },
    { label: VOICE_LABELS.neutral, color: VOICE_COLORS.neutral, pct: Math.round((neutral / total) * 100) },
    { label: VOICE_LABELS.opposition, color: VOICE_COLORS.opposition, pct: Math.round((opposition / total) * 100) },
  ];
}

// ═══════════════════════════════════════════
// Map API Category → Frontend Category
// ═══════════════════════════════════════════

export function mapCategory(cat: ApiCategory): Category {
  return {
    name: cat.name,
    icon: cat.icon || 'grid_view',
    slug: cat.slug,
  };
}

// ═══════════════════════════════════════════
// Map API Location → Frontend Location
// ═══════════════════════════════════════════

export function mapLocation(loc: ApiLocation): Location {
  return {
    name: loc.name,
    slug: loc.name.toLowerCase().replace(/\s+/g, '-'),
    icon: loc.type === 'provincia' ? 'map' : 'location_on',
  };
}
