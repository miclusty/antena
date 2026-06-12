// ═══════════════════════════════════════════
// Web vitals + read-event beacon helpers
// ═══════════════════════════════════════════
// Sends metrics to /api/track (Pages Function in Phase 6) which
// forwards to Cloudflare Analytics Engine via ctx.env.ANALYTICS.
// Uses sendBeacon for reliable page-unload events, fetch with
// keepalive for inline events.

import { onCLS, onINP, onLCP, onFCP, onTTFB } from 'web-vitals';
import type { Metric } from 'web-vitals';

export type TrackEventType =
  | 'card_view'
  | 'article_open'
  | 'article_complete'
  | 'bookmark'
  | 'share';

export interface TrackEventPayload {
  type: TrackEventType;
  newsId?: string;
  category?: string;
  source?: string;
  dwellTime?: number;
  scrollDepth?: number;
}

const TRACK_ENDPOINT = '/api/track';

function beacon(body: string): boolean {
  if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    try {
      const blob = new Blob([body], { type: 'application/json' });
      return navigator.sendBeacon(TRACK_ENDPOINT, blob);
    } catch {
      return false;
    }
  }
  return false;
}

function fetchBeacon(body: string): void {
  if (typeof fetch === 'undefined') return;
  try {
    void fetch(TRACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    });
  } catch {
    // best-effort
  }
}

function sendVital(metric: Metric): void {
  const body = JSON.stringify({
    type: 'vital',
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    navigationType: metric.navigationType,
  });
  fetchBeacon(body);
}

export function initAnalytics(): void {
  if (typeof window === 'undefined') return;
  try {
    onCLS(sendVital);
    onINP(sendVital);
    onLCP(sendVital);
    onFCP(sendVital);
    onTTFB(sendVital);
  } catch {
    // web-vitals not available in this environment
  }
}

export function trackEvent(event: TrackEventPayload): void {
  const body = JSON.stringify(event);
  if (!beacon(body)) fetchBeacon(body);
}

export function trackCardView(newsId: string, category?: string): void {
  trackEvent({ type: 'card_view', newsId, category });
}

export function trackArticleOpen(newsId: string, source?: string): void {
  trackEvent({ type: 'article_open', newsId, source });
}

export function trackArticleComplete(
  newsId: string,
  dwellTime: number,
  scrollDepth: number
): void {
  trackEvent({ type: 'article_complete', newsId, dwellTime, scrollDepth });
}

export function trackBookmark(newsId: string): void {
  trackEvent({ type: 'bookmark', newsId });
}

export function trackShare(newsId: string, source?: string): void {
  trackEvent({ type: 'share', newsId, source });
}
