/** @jsxImportSource solid-js */
import { For, Show, createMemo } from 'solid-js';
import EmptyState from '../common/EmptyState';
import Skeleton from '../common/Skeleton';
import NewsCard from '../common/NewsCard';
import type { SearchResult } from '../../lib/search';
import type { NewsItem } from '../../lib/types';

interface SearchResultsProps {
  query: string;
  results: SearchResult[];
  loading: boolean;
  onSelectResult: (result: SearchResult) => void;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlight(text: string, q: string) {
  if (!q.trim()) return text;
  const terms = q
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map(escapeRegExp);
  if (terms.length === 0) return text;
  const re = new RegExp(`(${terms.join('|')})`, 'gi');
  const parts = text.split(re);
  return (
    <For each={parts}>
      {(p) => (
        <Show
          when={re.test(p)}
          fallback={<>{p}</>}
        >
          <mark
            class="font-bold"
            style={{ background: 'var(--accent-muted)', color: 'var(--text-primary)' }}
          >
            {p}
          </mark>
        </Show>
      )}
    </For>
  );
}

function resultToNewsItem(r: SearchResult): NewsItem {
  return {
    id: r.id,
    title: r.title,
    summary: r.summary,
    body: '',
    category: r.category || '',
    source: r.sourceName || r.source || '',
    sourceUrl: undefined,
    time: r.publishedAt || '',
    location: '',
    bias: '',
    biasScore: null,
    biasColor: 'var(--text-tertiary)',
    biasGradientColor: 'var(--text-tertiary)',
    intensity: 0,
    signalLevel: 0,
    isGacetilla: false,
    isClickbait: false,
    propagation: [],
    voices: [],
    clusterId: '',
    sourcesCount: 1,
    imageUrl: r.imageUrl,
    publishedAt: r.publishedAt || '',
  };
}

export default function SearchResults(props: SearchResultsProps) {
  const hasQuery = createMemo(() => props.query.trim().length > 0);
  const hasResults = createMemo(() => props.results.length > 0);

  return (
    <div class="w-full">
      <Show when={props.loading}>
        <div class="px-5 py-3 text-xs text-text-tertiary uppercase tracking-wider font-semibold">
          Buscando...
        </div>
        <For each={Array.from({ length: 5 })}>
          {() => <Skeleton variant="card" />}
        </For>
      </Show>

      <Show when={!props.loading && hasQuery() && !hasResults()}>
        <EmptyState
          icon="search"
          title="No encontramos nada"
          description="No hay resultados para tu busqueda. Proba con otras palabras clave."
        />
      </Show>

      <Show when={!props.loading && hasQuery() && hasResults()}>
        <div class="px-5 py-3 text-xs text-text-tertiary uppercase tracking-wider font-semibold">
          {props.results.length} resultados
        </div>
        <ul class="flex flex-col">
          <For each={props.results}>
            {(r) => (
              <li class="list-none">
                <button
                  type="button"
                  onClick={() => props.onSelectResult(r)}
                  class="w-full text-left px-5 py-3.5 border-b border-border-base hover:bg-bg-hover active:bg-bg-hover transition-colors min-h-[44px]"
                >
                  <div class="text-[15px] font-semibold leading-snug text-text-primary">
                    {highlight(r.title, props.query)}
                  </div>
                  <Show when={r.summary}>
                    <p class="text-[13px] text-text-secondary mt-1 leading-relaxed line-clamp-2">
                      {highlight(r.summary, props.query)}
                    </p>
                  </Show>
                  <div class="flex items-center gap-1.5 mt-1.5 text-[11px] text-text-tertiary">
                    <Show when={r.source || r.sourceName}>
                      <span class="font-medium text-text-secondary">
                        {r.sourceName || r.source}
                      </span>
                      <span>·</span>
                    </Show>
                    <Show when={r.category}>
                      <span style={{ color: 'var(--accent)' }}>{r.category}</span>
                    </Show>
                  </div>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={!props.loading && !hasQuery()}>
        <EmptyState
          icon="search"
          title="Sintoniza tu busqueda"
          description="Escribi algo arriba para buscar en Antena. Probá con una palabra, un lugar o una persona."
        />
      </Show>
    </div>
  );
}
