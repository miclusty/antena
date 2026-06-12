import type { NewsItem } from './types';

const BRAND = 'Antena';

function formatBias(bias: number | null): string {
  if (bias == null) return '';
  const sign = bias > 0 ? '+' : '';
  return ` (sesgo: ${sign}${bias.toFixed(2)})`;
}

function buildOrigin(news: NewsItem): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/noticia/${news.id}`;
  }
  return `/noticia/${news.id}`;
}

export function buildWhatsAppUrl(news: NewsItem): string {
  const sources = news.sourcesCount > 1
    ? ` — ${news.sourcesCount} medios cubren esto en ${BRAND}`
    : '';
  const bias = formatBias(news.biasScore);
  const text = `*${news.title}*${sources}${bias}\n\n${BRAND}.ar`;
  const url = buildOrigin(news);
  return `https://wa.me/?text=${encodeURIComponent(text + '\n' + url)}`;
}

export interface ShareMessages {
  whatsapp: string;
  telegram: string;
  web: string;
}

export function buildShareMessage(news: NewsItem): ShareMessages {
  const url = buildOrigin(news);
  return {
    whatsapp: buildWhatsAppUrl(news),
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(news.title)}`,
    web: `/noticia/${news.id}`,
  };
}
