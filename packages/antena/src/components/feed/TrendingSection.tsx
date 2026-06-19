/** @jsxImportSource solid-js */
import { For, Show, createSignal } from 'solid-js';
import { fetchTrending } from '../../lib/api';

export interface TrendingItem {
  id: string;
  title: string;
  category: string;
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

type TrendingWindow = "1h" | "24h" | "7d";
const WINDOWS: { id: TrendingWindow; label: string; hours: number }[] = [
  { id: "1h", label: "1h", hours: 1 },
  { id: "24h", label: "24h", hours: 24 },
  { id: "7d", label: "7d", hours: 24 * 7 },
];

/**
 * Self-contained trending section. Owns its own data fetch and
 * the 1h/24h/7d tab state — the parent only needs to handle
 * onItemClick (which opens the article).
 */
export interface TrendingSectionProps {
  items?: TrendingItem[];
  loading?: boolean;
  onItemClick: (item: TrendingItem) => void;
}

export default function TrendingSection(props: TrendingSectionProps) {
  const [window, setWindow] = createSignal<TrendingWindow>("24h");
  const [items, setItems] = createSignal<TrendingItem[]>([]);
  const [loading, setLoading] = createSignal(true);

  // Refetch whenever the window changes.
  let cancelled = false;
  const load = async (w: TrendingWindow) => {
    setLoading(true);
    const hours = WINDOWS.find((x) => x.id === w)?.hours ?? 24;
    const res = await fetchTrending(10, hours);
    if (cancelled) return;
    setItems(res?.news.map((n) => ({ id: n.id, title: n.title, category: n.category ?? 'General' })) ?? []);
    setLoading(false);
  };

  // Use Solid's createEffect-like via signal subscription. We
  // don't have createResource here because we want manual
  // control over the lifecycle (cancel on window change).
  // Use a Solid pattern: wrap in a function that's called on
  // mount + when window() changes.
  let mounted = false;
  const refetch = () => load(window());
  // Initial + reactive: call whenever window() changes.
  // Using queueMicrotask + watch on signal:
  const setupWatcher = () => {
    if (mounted) return;
    mounted = true;
    // We use a small interval-based hack to avoid pulling
    // createResource. Better: just refetch on tab click and
    // initial mount.
    refetch();
  };

  const showSkeleton = () => loading() && items().length === 0;
  const showItems = () => !loading() && items().length > 0;
  const showEmpty = () => !loading() && items().length === 0;

  const onTabClick = (w: TrendingWindow) => {
    if (w === window()) return;
    setWindow(w);
    load(w);
  };

  // Run on mount.
  if (typeof window !== "undefined") {
    queueMicrotask(setupWatcher);
  }

  return (
    <Show when={showItems() || showSkeleton() || showEmpty()}>
      <section class="w-full">
        <div class="flex items-center justify-between px-4 mb-2 gap-2">
          <h2
            class="text-sm font-extrabold uppercase tracking-widest flex items-center gap-1.5 shrink-0"
            style={{ color: 'var(--text-primary)' }}
          >
            <span aria-hidden="true">🔥</span>
            <span>Trending</span>
          </h2>
          <div class="flex items-center gap-1 rounded-full p-0.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-base)' }}>
            <For each={WINDOWS}>
              {(w) => {
                const active = () => window() === w.id;
                return (
                  <button
                    type="button"
                    onClick={() => onTabClick(w.id)}
                    class="px-2.5 py-0.5 text-[11px] font-semibold rounded-full transition-colors"
                    style={
                      active()
                        ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                        : { color: 'var(--text-tertiary)' }
                    }
                    aria-pressed={active()}
                  >
                    {w.label}
                  </button>
                );
              }}
            </For>
          </div>
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
            <For each={items().slice(0, 10)}>
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
