/** @jsxImportSource solid-js */
import { For, Show, createSignal, onMount } from "solid-js";
import type { NewsItem } from "../../lib/types";
import NewsCard from "../common/NewsCard";
import EmptyState from "../common/EmptyState";
import { useHaptic } from "../../lib/haptic";
import { readHistory, clearHistory, type HistoryEntry } from "../../lib/history";
import { formatRelativeFromIso } from "../../lib/relative-time";

interface HistoryViewProps {
  onBack: () => void;
  onNewsClick: (news: NewsItem) => void;
}

/**
 * History view — articles the user has opened. Backed by
 * localStorage (lib/history.ts) so it works offline and never
 * requires a server round-trip. Rendered in the same style as
 * the bookmarks list.
 */
export default function HistoryView(props: HistoryViewProps) {
  const haptic = useHaptic();
  const [items, setItems] = createSignal<HistoryEntry[]>(readHistory());

  onMount(() => {
    // Refresh on mount in case the user opened something
    // while the view was off-screen (e.g. notification click).
    setItems(readHistory());
  });

  // Convert history entries (small shape) to NewsItems for
  // NewsCard. We fill in defaults for fields the card needs
  // but the history doesn't track.
  const asNewsItem = (e: HistoryEntry): NewsItem => ({
    id: e.id,
    title: e.title,
    summary: e.summary,
    body: e.summary,
    category: e.category,
    source: e.source,
    sourceId: null,
    sourceUrl: undefined,
    time: formatRelativeFromIso(new Date(e.viewedAt).toISOString()),
    location: "",
    bias: "",
    biasScore: null,
    biasColor: "var(--text-tertiary)",
    biasGradientColor: "var(--text-tertiary)",
    intensity: 0,
    signalLevel: 0,
    isGacetilla: false,
    isClickbait: false,
    propagation: [],
    voces: [],
    clusterId: "",
    sourcesCount: 1,
    imageUrl: e.imageUrl,
    publishedAt: e.publishedAt,
  });

  return (
    <div class="min-h-screen pb-24" style={{ background: 'var(--bg-base)' }}>
      <header
        class="sticky top-0 z-40 border-b"
        style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
      >
        <div class="max-w-[680px] mx-auto flex items-center px-4 h-12">
          <button
            onClick={() => { haptic.vibrate('tap'); props.onBack(); }}
            class="flex size-9 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Volver"
          >
            <span class="material-symbols-rounded text-xl leading-none" style={{ 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }}>arrow_back</span>
          </button>
          <span class="flex-1 text-center text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Historial ({items().length})
          </span>
          <Show when={items().length > 0}>
            <button
              onClick={() => {
                haptic.vibrate('tap');
                clearHistory();
                setItems([]);
              }}
              class="text-xs transition-colors"
              style={{ color: 'var(--error)' }}
              aria-label="Limpiar historial"
            >
              Limpiar
            </button>
          </Show>
        </div>
      </header>

      <main class="max-w-[680px] mx-auto py-4">
        <Show
          when={items().length > 0}
          fallback={
            <div class="px-4">
              <EmptyState
                icon="history"
                title="Sin historial todavía"
                description="Las noticias que abras van a aparecer acá. Tu historial se guarda solo en este dispositivo."
              />
            </div>
          }
        >
          <p class="text-xs mb-2 px-4" style={{ color: 'var(--text-tertiary)' }}>
            {items().length} noticia{items().length !== 1 ? 's' : ''} vista{items().length !== 1 ? 's' : ''} en este dispositivo
          </p>
          <For each={items()}>
            {(e) => (
              <NewsCard
                news={asNewsItem(e)}
                onClick={() => props.onNewsClick(asNewsItem(e))}
              />
            )}
          </For>
        </Show>
      </main>
    </div>
  );
}
