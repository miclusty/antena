/** @jsxImportSource solid-js */
import { createSignal, createResource, For, Show, onMount } from 'solid-js';
import EmptyState from '../common/EmptyState';
import { fetchSearch, type ApiNewsCard } from '../../lib/api';
import { mapNewsCard } from '../../lib/mappers';
import NewsCard from '../common/NewsCard';

const HISTORY_KEY = 'antena-search-history';
const MAX_HISTORY = 8;

function readHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function pushHistory(q: string) {
  if (typeof window === 'undefined' || !q.trim()) return;
  try {
    const cur = readHistory().filter((x) => x !== q);
    const next = [q, ...cur].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch { /* private mode */ }
}

function readQueryFromUrl(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('q') ?? '';
}

function writeQueryToUrl(q: string) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (q) url.searchParams.set('q', q);
  else url.searchParams.delete('q');
  window.history.pushState({}, '', url.toString());
}

export default function SearchView() {
  const [query, setQuery] = createSignal(readQueryFromUrl());
  const [history, setHistory] = createSignal<string[]>(readHistory());
  const [submitted, setSubmitted] = createSignal(query().length >= 2);

  const [results] = createResource(
    () => (submitted() && query().length >= 2 ? query() : null),
    async (q: string) => {
      const res = await fetchSearch(q, 30);
      return res.results.map(mapNewsCard);
    },
  );

  onMount(() => {
    const onPop = () => {
      setQuery(readQueryFromUrl());
      setSubmitted(readQueryFromUrl().length >= 2);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) return;
    setQuery(trimmed);
    setSubmitted(true);
    writeQueryToUrl(trimmed);
    pushHistory(trimmed);
    setHistory(readHistory());
  };

  const onInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    setQuery(e.currentTarget.value);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') submit(query());
  };

  const clear = () => {
    setQuery('');
    setSubmitted(false);
    writeQueryToUrl('');
  };

  const selectHistory = (h: string) => {
    setQuery(h);
    submit(h);
  };

  return (
    <div class="w-full">
      {/* Search input */}
      <div class="sticky top-0 z-20 px-4 py-3 border-b border-border-base" style={{ background: 'var(--bg-base)' }}>
        <div class="flex items-center gap-2">
          <div class="flex-1 flex items-center gap-2 px-3 py-2 rounded-full" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-base)' }}>
            <span
              class="material-symbols-rounded text-xl leading-none"
              style={{ color: 'var(--text-tertiary)', 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }}
              aria-hidden="true"
            >
              search
            </span>
            <input
              type="search"
              value={query()}
              onInput={onInput}
              onKeyDown={onKeyDown}
              placeholder="Buscar en Antena…"
              class="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--text-primary)' }}
              aria-label="Buscar"
              autofocus
            />
            <Show when={query().length > 0}>
              <button
                type="button"
                onClick={clear}
                class="text-xs px-2 py-0.5 rounded-full"
                style={{ color: 'var(--text-tertiary)' }}
                aria-label="Limpiar"
              >
                limpiar
              </button>
            </Show>
          </div>
        </div>

        {/* Recent searches */}
        <Show when={!submitted() && history().length > 0}>
          <div class="mt-3">
            <p class="text-[10px] font-extrabold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
              Recientes
            </p>
            <div class="flex flex-wrap gap-1.5">
              <For each={history()}>
                {(h) => (
                  <button
                    type="button"
                    onClick={() => selectHistory(h)}
                    class="text-[12px] font-medium px-2.5 py-1 rounded-full"
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-base)' }}
                  >
                    {h}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>

      {/* Results */}
      <Show
        when={submitted()}
        fallback={
          <div class="px-4 py-6">
            <EmptyState
              icon="search"
              title="Empezá a escribir"
              description="Buscá por palabra, lugar, persona o medio. Enter para buscar."
            />
          </div>
        }
      >
        <Show
          when={!results.loading}
          fallback={
            <div class="px-4 py-3 text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>
              Buscando...
            </div>
          }
        >
          <Show
            when={(results() ?? []).length > 0}
            fallback={
              <div class="px-4 py-6">
                <EmptyState
                  icon="search_off"
                  title="Sin resultados"
                  description={`No encontramos nada para "${query()}". Probá con otras palabras.`}
                />
              </div>
            }
          >
            <div class="px-4 py-3 text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>
              {(results() ?? []).length} resultados
            </div>
            <For each={results() ?? []}>
              {(item) => (
                <NewsCard
                  news={item}
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.location.href = `/?view=article&id=${item.id}`;
                    }
                  }}
                />
              )}
            </For>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
