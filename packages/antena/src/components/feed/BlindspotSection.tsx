/** @jsxImportSource solid-js */
import { For, Show, createSignal } from 'solid-js';
import type { NewsItem } from '../../lib/types';
import EmptyState from '../common/EmptyState';
import MaterialIcon from '../common/MaterialIcon';

export interface BlindspotItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  sourceUrl?: string;
  sourceId?: number | null;
  category?: string;
  biasColor?: string;
}

interface BlindspotSectionProps {
  items: BlindspotItem[];
  loading: boolean;
  onItemClick: (item: NewsItem) => void;
}

/**
 * "Lo que no estás viendo" — news from sources the user doesn't
 * follow. Designed to surface coverage gaps in their information
 * diet. Sits between Trending and the main feed.
 */
export default function BlindspotSection(props: BlindspotSectionProps) {
  const [collapsed, setCollapsed] = createSignal(false);

  return (
    <section
      class="border-b border-border-base"
      style={{ background: 'var(--bg-base)' }}
    >
      <header class="flex items-center justify-between px-4 pt-3 pb-2">
        <div class="flex items-center gap-2 min-w-0">
          <MaterialIcon name="visibility_off" size="lg" class="text-lg shrink-0" style={{ color: 'var(--warning)' }} aria-hidden="true" />
          <h2
            class="text-[10px] font-extrabold uppercase tracking-widest truncate"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Lo que no estás viendo
          </h2>
        </div>
        <button
          onClick={() => setCollapsed(c => !c)}
          class="text-[11px] font-semibold px-2 py-1 rounded-md"
          style={{ color: 'var(--accent)' }}
          aria-label={collapsed() ? 'Expandir blindspot' : 'Colapsar blindspot'}
        >
          {collapsed() ? 'Ver' : 'Ocultar'}
        </button>
      </header>

      <Show when={!collapsed()}>
        <Show
          when={!props.loading}
          fallback={
            <div class="px-4 pb-3 space-y-2">
              {[1, 2, 3].map((i) => (
                <div class="h-12 rounded-md bg-bg-hover animate-pulse" />
              ))}
            </div>
          }
        >
          <Show
            when={props.items.length > 0}
            fallback={
              <div class="px-4 pb-3">
                <EmptyState
                  icon="visibility"
                  title="Estás al día"
                  description="No detectamos cobertura nueva de medios que no seguís."
                />
              </div>
            }
          >
            <ul class="px-4 pb-3 space-y-2">
              <For each={props.items.slice(0, 5)}>
                {(item) => (
                  <li>
                    <button
                      type="button"
                      onClick={() => props.onItemClick({
                        id: item.id,
                        title: item.title,
                        summary: item.summary,
                        body: item.summary,
                        category: item.category ?? '',
                        source: item.source,
                        sourceId: item.sourceId ?? null,
                        sourceUrl: item.sourceUrl,
                        time: '',
                        location: '',
                        bias: '',
                        biasScore: null,
                        biasColor: item.biasColor ?? 'var(--text-tertiary)',
                        biasGradientColor: item.biasColor ?? 'var(--text-tertiary)',
                        intensity: 0,
                        signalLevel: 0,
                        isGacetilla: false,
                        isClickbait: false,
                        propagation: [],
                        voces: [],
                        clusterId: '',
                        sourcesCount: 1,
                        imageUrl: undefined,
                        publishedAt: '',
                      })}
                      class="w-full text-left p-2.5 rounded-lg border transition-colors"
                      style={{
                        background: 'var(--bg-elevated)',
                        'border-color': 'var(--border-base)',
                      }}
                    >
                      <p class="text-[13px] font-semibold leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                        {item.title}
                      </p>
                      <p class="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                        {item.source}{item.category ? ` · ${item.category}` : ''}
                      </p>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
