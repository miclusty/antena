/** @jsxImportSource solid-js */
import { For, Show, createSignal } from "solid-js";
import type { EntityTimelinePoint } from "../../lib/api";

// ═══════════════════════════════════════════
// MentionSparkline
// ═══════════════════════════════════════════
// 30-day (or N-day) mention-count sparkline for the entity
// profile page. Pure SVG — no chart library, no animation
// library, ~120×30px when scaled. Each data point is a dot
// you can hover to read the exact count for that day.
//
// The viewBox is fixed at 120×30; consumers size it via
// CSS (typically h-8 w-32 / w-40) so it stays crisp on
// retina without ballooning the DOM.

const VB_W = 120;
const VB_H = 30;
const PAD_Y = 3;

export interface MentionSparklineProps {
  data: EntityTimelinePoint[];
  days?: number;
}

export default function MentionSparkline(props: MentionSparklineProps) {
  const [hover, setHover] = createSignal<{ day: string; count: number; x: number; y: number } | null>(null);

  // The timeline endpoint may not return one entry per day — gaps
  // mean "no mentions that day". Pad with zeros so the polyline
  // x-axis is evenly spaced across the window.
  const padded = (): EntityTimelinePoint[] => {
    const days = props.days ?? 30;
    const byDay = new Map<string, number>();
    for (const p of props.data) byDay.set(p.day, p.count);
    const out: EntityTimelinePoint[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      out.push({ day: key, count: byDay.get(key) ?? 0 });
    }
    return out;
  };

  const max = (): number => {
    let m = 0;
    for (const p of padded()) if (p.count > m) m = p.count;
    return m;
  };

  const points = (): { x: number; y: number; day: string; count: number }[] => {
    const series = padded();
    const n = series.length;
    if (n === 0) return [];
    const m = max();
    const range = m === 0 ? 1 : m;
    const stepX = VB_W / Math.max(1, n - 1);
    return series.map((p, i) => ({
      x: n === 1 ? VB_W / 2 : i * stepX,
      y: VB_H - PAD_Y - ((p.count / range) * (VB_H - PAD_Y * 2)),
      day: p.day,
      count: p.count,
    }));
  };

  const polyPoints = (): string => {
    return points()
      .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(" ");
  };

  return (
    <div class="relative inline-block" data-testid="mention-sparkline">
      <Show
        when={padded().some((p) => p.count > 0)}
        fallback={
          <p
            class="text-xs italic"
            style={{ color: "var(--text-tertiary)" }}
            role="status"
          >
            Sin menciones recientes
          </p>
        }
      >
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          width="120"
          height="30"
          aria-label={`Menciones por día (${props.data.length} puntos en los últimos ${props.days ?? 30} días)`}
          role="img"
        >
          {/* Baseline */}
          <line
            x1="0"
            y1={VB_H - PAD_Y}
            x2={VB_W}
            y2={VB_H - PAD_Y}
            stroke="var(--border-base)"
            stroke-width="0.5"
          />
          {/* Polyline */}
          <polyline
            points={polyPoints()}
            fill="none"
            stroke="var(--accent)"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          {/* Dots (interactive) */}
          <For each={points()}>
            {(p) => (
              <circle
                cx={p.x}
                cy={p.y}
                r="1.8"
                fill="var(--accent)"
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(p)}
                onBlur={() => setHover(null)}
                tabindex={0}
                aria-label={`${p.day}: ${p.count} menciones`}
              >
                <title>{`${p.day}: ${p.count} menciones`}</title>
              </circle>
            )}
          </For>
        </svg>
        <Show when={hover()}>
          {(h) => (
            <div
              class="absolute -top-7 left-0 px-2 py-1 rounded text-[10px] font-semibold whitespace-nowrap pointer-events-none"
              style={{ background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border-base)" }}
            >
              {h().day}: {h().count}
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}