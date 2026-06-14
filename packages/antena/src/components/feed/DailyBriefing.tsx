/** @jsxImportSource solid-js */
import { For, Show, createMemo } from "solid-js";
import type { NewsItem } from "../../lib/types";

interface DailyBriefingProps {
  news: NewsItem[];
  onItemClick: (item: NewsItem) => void;
}

/**
 * "Resumen del día" — top stories from the last 24 hours, ranked
 * by signal (sources_count + recency). Computed client-side from
 * the already-loaded feed so no extra round-trip is needed.
 *
 * Algorithm:
 *   1. Filter items published in the last 24h.
 *   2. Score = sources_count * 2 + hoursAgo(0..1) — newer multi-
 *      source stories dominate, but a fresh single-source story
 *      can still surface.
 *   3. Take top 5.
 *
 * The section only renders when there are ≥3 candidates; otherwise
 * it's noise.
 */
export default function DailyBriefing(props: DailyBriefingProps) {
  const top = createMemo<NewsItem[]>(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const candidates = props.news.filter((n) => {
      const t = new Date(n.publishedAt || n.time || Date.now()).getTime();
      return t >= cutoff;
    });
    if (candidates.length < 3) return [];

    return candidates
      .map((n) => {
        const t = new Date(n.publishedAt || n.time || Date.now()).getTime();
        const hoursAgo = Math.max(0, (Date.now() - t) / 3600_000);
        const recency = Math.max(0, 1 - hoursAgo / 24); // 1 = just now, 0 = 24h ago
        const score = (n.sourcesCount || 1) * 2 + recency;
        return { n, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.n);
  });

  return (
    <Show when={top().length > 0}>
      <section
        class="border-b border-border-base"
        style={{ background: 'var(--bg-base)' }}
      >
        <header class="flex items-center justify-between px-4 pt-3 pb-2">
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="material-symbols-rounded text-lg leading-none shrink-0"
              style={{ color: 'var(--accent)', 'font-variation-settings': "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20" }}
              aria-hidden="true"
            >
              today
            </span>
            <h2
              class="text-[10px] font-extrabold uppercase tracking-widest truncate"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Resumen del día
            </h2>
          </div>
        </header>
        <ol class="px-4 pb-3 space-y-2">
          <For each={top()}>
            {(item, idx) => (
              <li>
                <button
                  type="button"
                  onClick={() => props.onItemClick(item)}
                  class="w-full text-left p-2.5 rounded-lg flex items-start gap-3 border transition-colors"
                  style={{
                    background: 'var(--bg-elevated)',
                    'border-color': 'var(--border-base)',
                  }}
                >
                  <span
                    class="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-extrabold"
                    style={{
                      background: idx() < 3 ? 'var(--accent)' : 'var(--bg-hover)',
                      color: idx() < 3 ? '#fff' : 'var(--text-secondary)',
                    }}
                  >
                    {idx() + 1}
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="text-[14px] font-semibold leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                      {item.title}
                    </p>
                    <p class="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {item.source}
                      <Show when={item.sourcesCount > 1}>
                        <span class="ml-1.5" style={{ color: 'var(--accent)' }}>
                          · {item.sourcesCount} fuentes
                        </span>
                      </Show>
                    </p>
                  </div>
                </button>
              </li>
            )}
          </For>
        </ol>
      </section>
    </Show>
  );
}
