/** @jsxImportSource solid-js */
import { For, Show } from 'solid-js';
import SourceLogo from '../common/SourceLogo';

export interface BreakingItem {
  id: string;
  title: string;
  source: string;
  biasScore?: number;
  createdAt: string;
}

export interface BreakingViewProps {
  items: BreakingItem[];
  onItemClick: (item: BreakingItem) => void;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '--:--';
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  } catch {
    return '--:--';
  }
}

export default function BreakingView(props: BreakingViewProps) {
  return (
    <section class="w-full">
      <div class="flex items-center gap-2 px-4 py-3 border-b border-border-base">
        <span
          class="w-2 h-2 rounded-full animate-pulse shrink-0"
          style={{
            'background-color': 'var(--live-red)',
            'box-shadow': 'var(--live-pulse)',
          }}
          aria-hidden="true"
        />
        <h2
          class="text-xs font-extrabold uppercase tracking-widest"
          style={{ color: 'var(--live-red)' }}
        >
          En vivo ahora
        </h2>
        <span
          class="ml-auto text-[10px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Últimas 2 horas
        </span>
      </div>

      <Show
        when={props.items.length > 0}
        fallback={
          <div
            class="px-6 py-12 text-center"
            style={{ color: 'var(--text-secondary)' }}
          >
            <p class="text-sm font-medium">
              Sin novedades en las últimas 2 horas.
            </p>
            <p class="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Volvé más tarde.
            </p>
          </div>
        }
      >
        <ul class="divide-y divide-border-base/40" role="list">
          <For each={props.items}>
            {(item) => (
              <li>
                <button
                  type="button"
                  onClick={() => props.onItemClick(item)}
                  class="w-full flex items-start gap-3 px-4 py-3 text-left min-h-[64px] transition-colors duration-150 active:scale-[0.99] hover:bg-bg-hover"
                  aria-label={item.title}
                >
                  <span
                    class="text-[11px] font-bold uppercase tracking-wider shrink-0 mt-1 font-mono"
                    style={{ color: 'var(--live-red)' }}
                  >
                    {formatTime(item.createdAt)}
                  </span>
                  <div class="shrink-0 mt-0.5">
                    <SourceLogo
                      source={item.source}
                      biasScore={item.biasScore ?? null}
                      size={24}
                      showBiasDot={false}
                    />
                  </div>
                  <p
                    class="text-sm font-medium leading-snug line-clamp-2 flex-1 min-w-0"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {item.title}
                  </p>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
