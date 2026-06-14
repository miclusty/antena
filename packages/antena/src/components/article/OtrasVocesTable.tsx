/** @jsxImportSource solid-js */
import { For, Show } from 'solid-js';
import type { NewsItem } from '../../lib/types';
import { useHaptic } from '../../lib/haptic';
import MaterialIcon from '../common/MaterialIcon';

interface OtrasVocesTableProps {
  sources: NewsItem[];
  currentId: string;
  onSelect?: (article: NewsItem) => void;
}

// Side-by-side comparison view for the "Otras voces"
// BottomSheet. Each source is a column with: bias dot,
// source name, headline, summary excerpt (first 180 chars),
// and a "Leer completo" button. The container is a
// horizontal scroll so 2+ sources fit on phone screens
// without truncation.
//
// We intentionally truncate summaries to 180 chars to
// keep each column roughly the same height; the user
// can tap "Leer completo" to get the full article.
const EXCERPT_LEN = 180;

export default function OtrasVocesTable(props: OtrasVocesTableProps) {
  const haptic = useHaptic();

  const truncate = (text: string) => {
    if (text.length <= EXCERPT_LEN) return text;
    const cut = text.slice(0, EXCERPT_LEN);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 80 ? cut.slice(0, lastSpace) : cut) + '…';
  };

  return (
    <div
      class="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory"
      role="list"
      aria-label={`${props.sources.length} coberturas de la misma historia`}
    >
      <For each={props.sources}>
        {(article) => {
          const isCurrent = article.id === props.currentId;
          const biasColor = article.biasColor || '#8A8D97';
          return (
            <article
              role="listitem"
              class="snap-start shrink-0 w-[78vw] sm:w-[320px] rounded-2xl border p-4 flex flex-col gap-3"
              style={{
                background: 'var(--bg-elevated)',
                'border-color': isCurrent ? 'var(--accent)' : 'var(--border-base)',
              }}
            >
              {/* Source header */}
              <header class="flex items-center gap-2 min-w-0">
                <div
                  class="w-2 h-2 rounded-full shrink-0"
                  style={{ 'background-color': biasColor }}
                  aria-hidden="true"
                />
                <span
                  class="text-[13px] font-semibold truncate flex-1 min-w-0"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {article.source}
                </span>
                <Show when={isCurrent}>
                  <span
                    class="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                    style={{
                      background: 'var(--accent)',
                      color: 'var(--bg-base)',
                    }}
                  >
                    Leyendo
                  </span>
                </Show>
              </header>

              {/* Bias label */}
              <div
                class="text-[10px] font-semibold uppercase tracking-wider self-start px-1.5 py-0.5 rounded"
                style={{
                  'background-color': biasColor + '20',
                  color: biasColor,
                }}
              >
                {article.bias}
              </div>

              {/* Headline */}
              <h3
                class="text-[15px] font-semibold leading-snug"
                style={{ color: 'var(--text-primary)' }}
              >
                {article.title.replace('📢 ', '')}
              </h3>

              {/* Excerpt */}
              <p
                class="text-[13px] leading-relaxed flex-1"
                style={{ color: 'var(--text-secondary)' }}
              >
                {truncate(article.summary || article.body || '')}
              </p>

              {/* Footer: time + read button */}
              <footer class="flex items-center justify-between gap-2 pt-2 border-t" style={{ 'border-color': 'var(--border-base)' }}>
                <span
                  class="text-[10px]"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {article.time}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    haptic.vibrate('tap');
                    props.onSelect?.(article);
                  }}
                  class="text-[12px] font-semibold inline-flex items-center gap-1 px-2.5 py-1 rounded-full transition-colors"
                  style={{
                    background: isCurrent ? 'var(--bg-hover)' : 'var(--accent)',
                    color: isCurrent ? 'var(--text-secondary)' : 'var(--bg-base)',
                    cursor: isCurrent ? 'default' : 'pointer',
                  }}
                  disabled={isCurrent}
                  aria-label={`Leer cobertura de ${article.source}`}
                >
                  {isCurrent ? 'Estás acá' : 'Leer completo'}
                  <Show when={!isCurrent}>
                    <MaterialIcon name="arrow_forward" size="sm" class="text-[14px] " style={{ }} aria-hidden="true" />
                  </Show>
                </button>
              </footer>
            </article>
          );
        }}
      </For>
    </div>
  );
}
