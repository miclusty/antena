/** @jsxImportSource solid-js */
import { For, Show } from 'solid-js';
import type { NewsItem } from '../../lib/types';
import { useReadLater } from '../../lib/read-later';
import NewsCard from '../common/NewsCard';
import EmptyState from '../common/EmptyState';
import { useHaptic } from '../../lib/haptic';
import MaterialIcon from '../common/MaterialIcon';

interface ReadLaterViewProps {
  onBack: () => void;
  onNewsClick: (news: NewsItem) => void;
}

export default function ReadLaterView(props: ReadLaterViewProps) {
  const haptic = useHaptic();
  const { queue, markRead, clear } = useReadLater();

  return (
    <div class="min-h-screen pb-24" style={{ background: 'var(--bg-base)' }}>
      <header
        class="sticky top-0 border-b"
        style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)', 'z-index': 'var(--z-sticky)' }}
      >
        <div class="max-w-[680px] mx-auto flex items-center px-4 h-12">
          <button
            onClick={() => { haptic.vibrate('tap'); props.onBack(); }}
            class="flex size-9 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Volver"
          >
            <MaterialIcon name="arrow_back" size="xl" class="text-xl " style={{ }} />
          </button>
          <span class="flex-1 text-center text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Leer después ({queue().length})
          </span>
          <Show when={queue().length > 0}>
            <button
              onClick={clear}
              class="text-xs transition-colors"
              style={{ color: 'var(--error)' }}
              aria-label="Limpiar toda la cola"
            >
              Limpiar
            </button>
          </Show>
        </div>
      </header>

      <main class="max-w-[680px] mx-auto px-4 py-4">
        <Show when={queue().length === 0}>
          <EmptyState
            icon="schedule"
            title="Tu cola está vacía"
            description="Toca el icono del reloj en cualquier noticia para leerla más tarde."
            action={{ label: 'Ver noticias', onClick: () => props.onBack() }}
          />
        </Show>

        <Show when={queue().length > 0}>
          <div class="flex flex-col gap-2">
            <p class="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
              {queue().length} noticia{queue().length !== 1 ? 's' : ''} en cola · se irán quitando a medida que las leas
            </p>
            <For each={queue()}>
              {(news) => (
                <NewsCard
                  news={news}
                  onClick={() => {
                    // Opening from the queue auto-marks it as
                    // read; the user can re-add it from the
                    // article if they want to keep it.
                    markRead(news.id);
                    props.onNewsClick(news);
                  }}
                />
              )}
            </For>
          </div>
        </Show>
      </main>
    </div>
  );
}
