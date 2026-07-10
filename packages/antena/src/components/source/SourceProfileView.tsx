/** @jsxImportSource solid-js */
import { createResource, For, Show, createSignal, onMount } from "solid-js";
import { fetchSourceProfile, followSource, unfollowSource, type ApiSourceProfile, type ApiSourceEntry } from "../../lib/api";
import { mapNewsCard } from "../../lib/mappers";
import NewsCard from "../common/NewsCard";
import FollowButton from "../common/FollowButton";
import EmptyState from "../common/EmptyState";
import { toast } from "../Toast";
import { useHaptic } from "../../lib/haptic";
import MaterialIcon from '../common/MaterialIcon';

export default function SourceProfileView(props: { sourceId: number; onBack: () => void; onNewsClick: (id: string) => void }) {
  const haptic = useHaptic();
  const [profile, { refetch }] = createResource(() => props.sourceId, fetchSourceProfile);
  const [refreshTick, setRefreshTick] = createSignal(0);

  const source = (): ApiSourceEntry | null => profile()?.source ?? null;
  const newsItems = () => (profile()?.news ?? []).map(mapNewsCard);

  const onFollowToggle = async () => {
    const s = source();
    if (!s) return;
    haptic.vibrate("tap");
    const wasActive = s.is_active;
    const ok = wasActive
      ? await unfollowSource(props.sourceId)
      : await followSource(props.sourceId);
    if (ok) {
      toast(wasActive ? "Dejaste de seguir" : "Ahora seguís este medio", "info");
      setRefreshTick((t) => t + 1);
      void refetch();
    } else {
      toast("No se pudo actualizar", "error");
    }
  };

  return (
    <div class="w-full max-w-2xl mx-auto">
      <header class="sticky top-0 px-4 py-3 border-b border-border-base flex items-center gap-3" style={{ background: 'var(--bg-base)', 'z-index': 'var(--z-sticky)' }}>
        <button
          type="button"
          onClick={props.onBack}
          class="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full hover:bg-bg-hover"
          aria-label="Volver"
        >
          <MaterialIcon name="arrow_back" size="xl" class="text-xl " style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }} aria-hidden="true" />
        </button>
        <h1 class="text-base font-semibold truncate flex-1" style={{ color: 'var(--text-primary)' }}>
          {source()?.name ?? "Medio"}
        </h1>
        <Show when={source()}>
          <FollowButton sourceId={props.sourceId} size="sm" />
        </Show>
      </header>

      <Show when={profile.loading}>
        <div class="p-4 space-y-3">
          <div class="h-16 rounded-xl bg-bg-hover animate-pulse" />
          <div class="h-4 w-1/2 rounded bg-bg-hover animate-pulse" />
        </div>
      </Show>

      <Show when={profile()}>
        {(p) => (
          <>
            <section class="px-5 py-4 border-b border-border-base">
              <div class="flex items-center gap-4">
                <div
                  class="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-extrabold shrink-0"
                  style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
                >
                  {p().source.name.charAt(0).toUpperCase()}
                </div>
                <div class="min-w-0 flex-1">
                  <h2 class="text-xl font-bold" style={{ "font-family": "var(--font-display)", color: 'var(--text-primary)' }}>
                    {p().source.name}
                  </h2>
                  <p class="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {p().source.location_name ?? p().source.province ?? "Argentina"} · {p().source.news_count ?? 0} notas
                  </p>
                </div>
              </div>
              <Show when={p().source.url}>
                <a
                  href={p().source.url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--accent)', border: '1px solid var(--border-base)' }}
                >
                  <MaterialIcon name="open_in_new" size="base" class="text-base " style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 18" }} aria-hidden="true" />
                  Visitar sitio
                </a>
              </Show>
            </section>

            <section class="px-5 py-4 border-b border-border-base">
              <p class="text-[10px] font-extrabold uppercase tracking-widest mb-2" style={{ color: 'var(--text-tertiary)' }}>
                Sesgo editorial
              </p>
              <Show
                when={p().source.bias_score !== undefined && p().source.bias_score !== null}
                fallback={
                  <p class="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                    Sin datos de sesgo todavía.
                  </p>
                }
              >
                <BiasIndicator score={p().source.bias_score!} />
              </Show>
            </section>

            <section class="px-1 pb-12">
              <h2 class="text-[10px] font-extrabold uppercase tracking-widest mb-1 px-4" style={{ color: 'var(--text-tertiary)' }}>
                Últimas notas
              </h2>
              <Show
                when={newsItems().length > 0}
                fallback={
                  <div class="p-4">
                    <EmptyState
                      icon="article"
                      title="Sin notas recientes"
                      description="Este medio no tiene notas en el feed todavía."
                    />
                  </div>
                }
              >
                <For each={newsItems()}>
                  {(item) => (
                    <NewsCard
                      news={item}
                      onClick={() => props.onNewsClick(item.id)}
                    />
                  )}
                </For>
              </Show>
            </section>
          </>
        )}
      </Show>
    </div>
  );
}

function BiasIndicator(props: { score: number }) {
  const label = () => {
    const s = props.score;
    if (s > 0.3) return "Oficialista";
    if (s > 0.1) return "Pro-gobierno";
    if (s < -0.3) return "Opositor fuerte";
    if (s < -0.1) return "Opositor";
    return "Neutral";
  };
  const color = () => {
    const s = props.score;
    if (s > 0.1) return "var(--bias-officialist)";
    if (s < -0.1) return "var(--bias-opposition)";
    return "var(--bias-neutral)";
  };
  const width = () => `${Math.min(100, Math.abs(props.score) * 100 + 20)}%`;

  return (
    <div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {label()}
        </span>
        <span class="text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
          {props.score > 0 ? "+" : ""}{props.score.toFixed(2)}
        </span>
      </div>
      <div class="relative h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
        <div
          class="absolute top-0 h-full transition-all"
          style={{
            [props.score >= 0 ? "left" : "right"]: "50%",
            width: width(),
            "background-color": color(),
          }}
        />
        <div class="absolute left-1/2 top-0 w-px h-full" style={{ background: 'var(--border-base)' }} />
      </div>
      <div class="flex justify-between mt-1 text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
        <span>Opositor</span>
        <span>Neutral</span>
        <span>Oficialista</span>
      </div>
    </div>
  );
}
