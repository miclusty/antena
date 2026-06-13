// @ts-nocheck
/** @jsxImportSource solid-js */
import { createResource, For, Show } from 'solid-js';
import type { NewsItem } from '../../lib/types';
import { useBookmarks } from '../../lib/bookmarks';
import { fetchNewsByIds } from '../../lib/api';
import { mapNewsCard } from '../../lib/mappers';
import NewsCard from '../common/NewsCard';
import EmptyState from '../common/EmptyState';
import { useHaptic } from '../../lib/haptic';

interface BookmarksViewProps {
  onBack: () => void;
  onNewsClick: (news: NewsItem) => void;
}

export default function BookmarksView(props: BookmarksViewProps) {
  const haptic = useHaptic();
  const { bookmarks, removeBookmark, clearBookmarks } = useBookmarks();

  const [bookmarkedNews] = createResource(
    () => bookmarks().length > 0 ? bookmarks() : null,
    async (ids) => {
      if (!ids) return [] as NewsItem[];
      try { return (await fetchNewsByIds(ids)).map(mapNewsCard); }
      catch { return [] as NewsItem[]; }
    },
    { initialValue: [] as NewsItem[] }
  );

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
            Guardados ({bookmarks().length})
          </span>
          <Show when={bookmarks().length > 0}>
            <button
              onClick={clearBookmarks}
              class="text-xs transition-colors"
              style={{ color: 'var(--error)' }}
            >
              Limpiar
            </button>
          </Show>
        </div>
      </header>

      <main class="max-w-[680px] mx-auto px-4 py-4">
        <Show when={bookmarkedNews.loading}>
          <div class="flex flex-col gap-2">
            <For each={[1, 2, 3]}>
              {() => (
                <div class="rounded-xl border p-3 animate-pulse" style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}>
                  <div class="h-3 w-20 rounded mb-2" style={{ background: 'var(--border-base)' }} />
                  <div class="h-4 w-3/4 rounded mb-1" style={{ background: 'var(--border-base)' }} />
                  <div class="h-3 w-1/2 rounded" style={{ background: 'var(--border-base)' }} />
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={!bookmarkedNews.loading && bookmarks().length === 0}>
          <EmptyState
            icon="bookmark"
            title="No tenes noticias guardadas"
            description="Toca el icono de bookmark en cualquier noticia para guardarla y leerla después."
            action={{ label: 'Ver noticias', onClick: () => props.onBack() }}
          />
        </Show>

        <Show when={!bookmarkedNews.loading && bookmarkedNews()?.length === 0 && bookmarks().length > 0}>
          <EmptyState
            icon="wifi_off"
            title="Sin resultados"
            description="No se pudieron cargar las noticias guardadas."
            action={{ label: 'Volver', onClick: () => props.onBack() }}
          />
        </Show>

        <Show when={!bookmarkedNews.loading && bookmarkedNews()?.length}>
          <div class="flex flex-col gap-2">
            <p class="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
              {bookmarks().length} noticia{bookmarks().length !== 1 ? 's' : ''} guardada{bookmarks().length !== 1 ? 's' : ''}
            </p>
            <For each={bookmarkedNews()}>
              {(news) => (
                <NewsCard
                  news={news}
                  onClick={() => props.onNewsClick(news)}
                  isBookmarked={true}
                  onBookmark={() => removeBookmark(news.id)}
                />
              )}
            </For>
          </div>
        </Show>
      </main>
    </div>
  );
}
