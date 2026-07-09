import type { APIRoute } from 'astro';
import { fetchArticleMarkdownData } from '../../../../lib/api';

export const prerender = true;

const SITE = 'https://www.antena.com.ar';
const FALLBACK_API = 'https://akira-api.miclusty.workers.dev';

function resolveApiBase(): string {
  const fromEnv = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env.PUBLIC_API_BASE;
  if (!fromEnv || fromEnv.includes('localhost')) return FALLBACK_API;
  return fromEnv;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function slugDate(publishedAt: string | null | undefined): string {
  const d = publishedAt ? new Date(publishedAt) : new Date();
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export async function getStaticPaths() {
  const apiBase = resolveApiBase();
  const paths: { params: { year: string; month: string; day: string; slug: string }; props: { id: string } }[] = [];
  try {
    const res = await fetch(`${apiBase}/api/news/feed?limit=100`, {
      headers: { 'User-Agent': 'AntenaSSRBatcher/1.0' },
    });
    if (res.ok) {
      const data = await res.json() as {
        news: { id: string; title: string; published_at: string | null }[];
      };
      const seen = new Set<string>();
      for (const item of data.news ?? []) {
        if (!item.id || !item.title) continue;
        const sd = slugDate(item.published_at);
        const sl = slugify(item.title);
        if (!sl) continue;
        const [year, month, day] = sd.split('-');
        const key = `${year}/${month}/${day}/${sl}`;
        if (seen.has(key)) continue;
        seen.add(key);
        paths.push({ params: { year, month, day, slug: sl }, props: { id: item.id } });
      }
    }
  } catch (e) {
    console.error('[md-route] getStaticPaths fetch error:', e);
  }
  return paths;
}

function yamlEscape(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

export const GET: APIRoute = async ({ props }) => {
  const { id } = (props ?? {}) as { id?: string };
  if (!id) {
    return new Response('Not found', { status: 404 });
  }

  const article = await fetchArticleMarkdownData(id, resolveApiBase());
  if (!article) {
    return new Response('Not found', { status: 404 });
  }

  const sd = article.slug_date ?? slugDate(article.published_at);
  const sl = article.slug ?? slugify(article.title);
  const [year, month, day] = sd.split('-');
  const canonicalUrl = `${SITE}/${year}/${month}/${day}/${sl}`;

  const articleWithDerived = { ...article, slug_date: sd, slug: sl };

  const sourcesYaml = (article.sources ?? []).map(
    (s) => `  - name: ${yamlEscape(s.name)}\n    url: ${s.url}`
  ).join('\n');

  const frontmatter = [
    '---',
    `id: ${articleWithDerived.id}`,
    `title: ${yamlEscape(articleWithDerived.title)}`,
    `slug: ${articleWithDerived.slug}`,
    `slug_date: ${articleWithDerived.slug_date}`,
    `canonical_url: ${canonicalUrl}`,
    `author: ${yamlEscape(articleWithDerived.author ?? articleWithDerived.source_name ?? 'Antena')}`,
    `category: ${articleWithDerived.category ?? 'General'}`,
    `location: ${articleWithDerived.location_name ?? 'Argentina'}`,
    `published_at: ${articleWithDerived.published_at}`,
    `source_name: ${articleWithDerived.source_name ?? ''}`,
    `source_url: ${articleWithDerived.source_url ?? ''}`,
    'sources:',
    sourcesYaml || '  []',
    '---',
  ].join('\n');

  const body = articleWithDerived.body ? `\n\n${stripHtml(articleWithDerived.body)}` : '';
  const sourcesMd = (articleWithDerived.sources ?? []).length
    ? `\n\n## Fuentes\n\n${(articleWithDerived.sources ?? []).map((s) => `- [${s.name}](${s.url})`).join('\n')}\n`
    : '';

  const md = `${frontmatter}\n\n# ${articleWithDerived.title}\n\n> ${stripHtml(articleWithDerived.summary)}${body}${sourcesMd}\n---\n\nEste artículo es una síntesis de ${(articleWithDerived.sources ?? []).length || 'varias'} fuentes. Antena es un agregador, no genera contenido original.\n\nMás info: https://www.antena.com.ar/about\n`;

  return new Response(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
};
