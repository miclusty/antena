/** @jsxImportSource solid-js */
import { For } from 'solid-js';
import type { NewsItem } from '../../lib/types';
import { useHaptic } from '../../lib/haptic';

interface ClusterViewProps {
  clusterId: string;
  articles: NewsItem[];
  onArticleSelect?: (article: NewsItem) => void;
}

export default function ClusterView(props: ClusterViewProps) {
  const haptic = useHaptic();
  return (
    <section
      class="rounded-xl border p-4 mb-4"
      style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
    >
      <h2
        class="text-[10px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1.5"
        style={{ color: 'var(--text-tertiary)' }}
      >
        <span
          class="material-symbols-rounded text-base leading-none"
          style={{ 'font-variation-settings': "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20", color: 'var(--accent)' }}
        >
          hub
        </span>
        Otras fuentes sobre esta noticia
      </h2>
      <p class="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
        {props.articles.length} fuentes cubren esta historia
      </p>

      <div class="flex flex-col gap-1.5">
        <For each={props.articles.slice(1, 8)}>
          {(article) => (
            <button
              onClick={() => { haptic.vibrate('tap'); props.onArticleSelect?.(article); }}
              class="group flex items-stretch gap-3 min-h-[56px] pl-2 pr-3 py-2.5 rounded-lg transition-all text-left border border-transparent hover:bg-bg-hover hover:border-border-base active:scale-[0.99] active:bg-bg-hover"
            >
              {/* Bias color stripe (left edge) */}
              <div
                class="w-1 rounded-full shrink-0 self-stretch"
                style={{ 'background-color': article.biasColor }}
                aria-hidden="true"
              />
              <div class="flex-1 min-w-0">
                <h3
                  class="text-[14px] font-semibold line-clamp-2 leading-snug"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {article.title.replace('📢 ', '')}
                </h3>
                <div class="flex items-center gap-1.5 mt-1.5">
                  <span class="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{article.source}</span>
                  <span class="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
                  <span class="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{article.time}</span>
                  <span class="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
                  <span
                    class="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{
                      'background-color': (article.biasColor || '#8A8D97') + '20',
                      color: article.biasColor || '#8A8D97',
                    }}
                  >
                    {article.bias}
                  </span>
                </div>
              </div>
              <span
                class="material-symbols-rounded text-lg leading-none self-center opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: 'var(--text-tertiary)', 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }}
                aria-hidden="true"
              >
                chevron_right
              </span>
            </button>
          )}
        </For>
      </div>

      {props.articles.length > 8 && (
        <div class="mt-3 pt-3 text-center" style={{ 'border-top': '1px solid var(--border-base)' }}>
          <span class="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Y {props.articles.length - 8} fuentes más...
          </span>
        </div>
      )}
    </section>
  );
}
