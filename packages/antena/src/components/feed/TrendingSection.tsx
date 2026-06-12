/** @jsxImportSource solid-js */
import { For, Show } from 'solid-js';

export interface TrendingItem {
  id: string;
  title: string;
  category: string;
}

export interface TrendingSectionProps {
  items: TrendingItem[];
  loading: boolean;
  onItemClick: (item: TrendingItem) => void;
}

const CAT_COLOR: Record<string, string> = {
  'Política': 'var(--cat-politica)',
  'Economía': 'var(--cat-economia)',
  'Deportes': 'var(--cat-deportes)',
  'Policiales': 'var(--cat-policiales)',
  'Cultura': 'var(--cat-cultura)',
  'Tecnología': 'var(--cat-tecnologia)',
  'Sociedad': 'var(--cat-sociedad)',
  'Internacional': 'var(--cat-internacional)',
  'Clima': '#0EA5E9',
  'Espectáculos': '#EC4899',
};

function catColor(cat: string): string {
  return CAT_COLOR[cat] || 'var(--accent)';
}

export default function TrendingSection(props: TrendingSectionProps) {
  const hasItems = () => !props.loading && props.items.length > 0;
  const showSkeleton = () => props.loading && props.items.length === 0;

  return (
    <Show when={hasItems() || showSkeleton()}>
      <section class="w-full">
        <div class="flex items-center justify-between px-4 mb-2">
          <h2
            class="text-sm font-extrabold uppercase tracking-widest flex items-center gap-1.5"
            style={{ color: 'var(--text-primary)' }}
          >
            <span aria-hidden="true">🔥</span>
            <span>Lo más visto hoy</span>
          </h2>
          <button
            type="button"
            class="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--accent)' }}
            aria-label="Ver todo el trending"
          >
            Ver todo
          </button>
        </div>
        <div
          class="flex gap-2 overflow-x-auto px-4 pb-2 snap-x snap-mandatory"
          style={{ 'scrollbar-width': 'none', '-ms-overflow-style': 'none' }}
        >
          <Show
            when={!showSkeleton()}
            fallback={
              <For each={Array.from({ length: 4 })}>
                {() => (
                  <div
                    class="snap-start shrink-0 w-44 h-28 rounded-[var(--radius-md)] skeleton-shimmer"
                    style={{
                      background: 'linear-gradient(90deg, var(--bg-hover) 0%, var(--border-base) 50%, var(--bg-hover) 100%)',
                      'background-size': '200% 100%',
                    }}
                    aria-hidden="true"
                  />
                )}
              </For>
            }
          >
            <For each={props.items.slice(0, 10)}>
              {(item) => (
                <button
                  type="button"
                  onClick={() => props.onItemClick(item)}
                  class="snap-start shrink-0 w-44 h-28 rounded-[var(--radius-md)] border border-border-base text-left p-3 flex flex-col gap-1.5 transition-all duration-200 active:scale-[0.98] hover:shadow-sm"
                  style={{ background: 'var(--bg-elevated)' }}
                  aria-label={item.title}
                >
                  <div class="flex items-center gap-1.5">
                    <span
                      class="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ 'background-color': catColor(item.category) }}
                      aria-hidden="true"
                    />
                    <span
                      class="text-[9px] font-extrabold uppercase tracking-widest truncate"
                      style={{ color: catColor(item.category) }}
                    >
                      {item.category}
                    </span>
                  </div>
                  <p
                    class="text-sm font-semibold leading-snug line-clamp-2"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {item.title}
                  </p>
                </button>
              )}
            </For>
          </Show>
        </div>
      </section>
    </Show>
  );
}
