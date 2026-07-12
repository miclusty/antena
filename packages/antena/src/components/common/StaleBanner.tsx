/** @jsxImportSource solid-js */
import { Show } from "solid-js";

interface StaleBannerProps {
  /** Number of days since the most recent article was published.
   *  Renders "23 días" so users see exactly how stale the feed is. */
  daysSinceLastNews: number | null;
  /** Optional callback to retry the feed (forces a refetch). */
  onRetry?: () => void;
}

/**
 * Pinned banner that surfaces above the feed when AKIRA hasn't
 * extracted fresh news in >48h. Mirrors the existing accent palette
 * (amber-500 in Tailwind = `#F59E0B`, the `--warning` token) so it
 * reads as a warning rather than an error. The retry button is a
 * last-ditch UX — usually the AKIRA cron will fill the gap within
 * 2 hours on its own.
 */
export default function StaleBanner(props: StaleBannerProps) {
  const daysText = () => {
    const d = props.daysSinceLastNews;
    if (d == null) return "varios días";
    if (d === 1) return "1 día";
    return `${d} días`;
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="stale-banner"
      class="mx-4 mt-3 mb-1 flex items-start gap-3 rounded-[var(--radius-md)] border px-3.5 py-3"
      style={{
        "background-color": "color-mix(in srgb, #F59E0B 10%, var(--bg-elevated))",
        "border-color": "color-mix(in srgb, #F59E0B 45%, var(--border-base))",
      }}
    >
      <span
        aria-hidden="true"
        class="text-lg leading-none mt-0.5"
        style={{ color: "#F59E0B" }}
      >
        ⚠
      </span>
      <div class="flex-1 min-w-0 text-[14px] leading-snug" style={{ color: "var(--text-primary)" }}>
        <p class="font-semibold">
          Sin noticias nuevas hace {daysText()}.
        </p>
        <p class="mt-0.5" style={{ color: "var(--text-secondary)" }}>
          La extracción automática de AKIRA puede estar pausada. Reintentá en unos minutos.
        </p>
      </div>
      <Show when={props.onRetry}>
        <button
          type="button"
          onClick={() => props.onRetry?.()}
          class="shrink-0 text-[12px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-full border active:scale-95 transition-all"
          style={{
            "border-color": "#F59E0B",
            color: "#F59E0B",
            "background-color": "transparent",
          }}
          aria-label="Reintentar carga del feed"
        >
          Reintentar
        </button>
      </Show>
    </div>
  );
}
