/** @jsxImportSource solid-js */
import { createSignal, createResource, For, Show, createMemo, onMount, onCleanup, createEffect } from "solid-js";
import { fetchCities, fetchCategories, fetchSources, followSource, type ApiSourceEntry, type ApiCategory, type ApiCity } from "../../lib/api";
import { useHaptic } from "../../lib/haptic";
import { trapFocus } from "../../lib/focus-trap";
import { toast } from "../Toast";
import MaterialIcon from '../common/MaterialIcon';

// Backwards-compat re-export: kept so any old call site
// that still does `if (!isOnboarded())` doesn't break. The
// new flow is organic (no auto-show). New users are always
// "onboarded" by default — the personalization flow is
// optional and user-initiated.
export function isOnboarded(): boolean { return true; }

const ONBOARDING_DRAFT_KEY = "antena-onboarding-draft";

interface Draft {
  cityId: number | null;
  categorySlugs: string[];
  followedSourceIds: number[];
}

function readDraft(): Draft {
  if (typeof window === "undefined") return { cityId: null, categorySlugs: [], followedSourceIds: [] };
  try {
    const raw = localStorage.getItem(ONBOARDING_DRAFT_KEY);
    if (!raw) return { cityId: null, categorySlugs: [], followedSourceIds: [] };
    const parsed = JSON.parse(raw);
    return {
      cityId: typeof parsed.cityId === "number" ? parsed.cityId : null,
      categorySlugs: Array.isArray(parsed.categorySlugs) ? parsed.categorySlugs.filter((s: unknown): s is string => typeof s === "string") : [],
      followedSourceIds: Array.isArray(parsed.followedSourceIds) ? parsed.followedSourceIds.filter((n: unknown): n is number => typeof n === "number") : [],
    };
  } catch {
    return { cityId: null, categorySlugs: [], followedSourceIds: [] };
  }
}

function writeDraft(d: Draft) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(d)); }
  catch { /* ignore */ }
}

interface OnboardingViewProps {
  onComplete?: (data: { cityId: number | null; categorySlugs: string[] }) => void;
  onSkip?: () => void;
}

export default function OnboardingView(props: OnboardingViewProps) {
  const haptic = useHaptic();
  const [visible, setVisible] = createSignal(false);
  const [step, setStep] = createSignal<1 | 2 | 3>(1);
  const [draft, setDraft] = createSignal<Draft>(readDraft());
  const [submitting, setSubmitting] = createSignal(false);

  // Listen for the global event from Settings (or
  // any other trigger). Self-controlled, no parent
  // required.
  onMount(() => {
    window.addEventListener("antena:open-onboarding", () => setVisible(true));
  });

  // Persist draft on every change so a refresh doesn't lose progress.
  createMemo(() => writeDraft(draft()));

  const [cities] = createResource(() => fetchCities());
  const [categories] = createResource(() => fetchCategories().then((arr) => arr.filter((c) => c.slug !== "all")));
  const [sources] = createResource(() => fetchSources(40));

  const onCityPick = (id: number | null) => {
    setDraft((d) => ({ ...d, cityId: id }));
    haptic.vibrate("tap");
  };
  const toggleCategory = (slug: string) => {
    setDraft((d) => {
      const has = d.categorySlugs.includes(slug);
      return { ...d, categorySlugs: has ? d.categorySlugs.filter((s) => s !== slug) : [...d.categorySlugs, slug] };
    });
    haptic.vibrate("tap");
  };
  const toggleSource = (id: number) => {
    setDraft((d) => {
      const has = d.followedSourceIds.includes(id);
      return { ...d, followedSourceIds: has ? d.followedSourceIds.filter((s) => s !== id) : [...d.followedSourceIds, id] };
    });
    haptic.vibrate("tap");
  };

  // Organic flow: every step is optional, no minimum
  // category gate. The user can save partial state and
  // come back later. Tabs at the top let you jump
  // between Ciudad / Categorías / Medios freely.
  const save = async () => {
    setSubmitting(true);
    const followPromises = draft().followedSourceIds.map((id) => followSource(id).catch(() => false));
    await Promise.allSettled(followPromises);
    setSubmitting(false);
    haptic.vibrate("success");
    toast("Preferencias guardadas", "info");
    try { localStorage.removeItem(ONBOARDING_DRAFT_KEY); }
    catch { /* ignore */ }
    props.onComplete?.({ cityId: draft().cityId, categorySlugs: draft().categorySlugs });
    setVisible(false);
  };

  const cancel = () => {
    props.onSkip?.();
    setVisible(false);
  };

  if (!visible()) return null;

  let modalRef: HTMLDivElement | undefined;
  let triggerEl: HTMLElement | null = null;
  let trap: ReturnType<typeof trapFocus> | null = null;
  createEffect(() => {
    if (!visible() || !modalRef) return;
    if (!trap) {
      triggerEl = (document.activeElement as HTMLElement | null) ?? null;
      trap = trapFocus(modalRef, triggerEl ?? undefined);
    }
    trap.activate();
  });

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-label="Personalizá tu feed"
      class="fixed inset-0 z-[200] flex items-center justify-center px-4 py-6"
      style={{ background: "rgba(0,0,0,0.55)", "backdrop-filter": "blur(4px)" }}
    >
      <div
        class="w-full max-w-md flex flex-col gap-4 rounded-2xl border p-5 max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--bg-elevated)", "border-color": "var(--border-base)" }}
      >
        <header class="flex items-start justify-between gap-3">
          <div>
            <h1 class="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
              Personalizá tu feed
            </h1>
            <p class="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              Cambialo cuando quieras desde Configuración. Cada paso es opcional.
            </p>
          </div>
          <button
            type="button"
            onClick={cancel}
            class="shrink-0 p-2 rounded-full hover:bg-bg-hover transition-colors"
            aria-label="Cerrar"
          >
            <MaterialIcon name="close" size="lg" class="text-lg" style={{ color: "var(--text-tertiary)" }} aria-hidden="true" />
          </button>
        </header>

        {/* Tabbed navigation between the three sub-flows */}
        <div class="flex gap-1 p-1 rounded-xl" style={{ background: "var(--bg-base)" }}>
          <For each={[
            { id: 1 as const, label: "Ciudad", icon: "location_on" },
            { id: 2 as const, label: "Categorías", icon: "category" },
            { id: 3 as const, label: "Medios", icon: "group" },
          ]}>
            {(t) => (
              <button
                type="button"
                onClick={() => setStep(t.id)}
                class="flex-1 flex items-center justify-center gap-1.5 min-h-[40px] rounded-lg text-xs font-semibold transition-colors"
                style={
                  step() === t.id
                    ? { background: "var(--bg-elevated)", color: "var(--text-primary)" }
                    : { color: "var(--text-tertiary)" }
                }
              >
                <MaterialIcon name={t.icon} size="sm" class="text-sm" style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 16" }} aria-hidden="true" />
                {t.label}
              </button>
            )}
          </For>
        </div>

        {/* Step 1: city */}
        <Show when={step() === 1}>
          <p class="text-sm" style={{ color: "var(--text-secondary)" }}>
            ¿De dónde querés leer noticias?
          </p>
          <div class="space-y-2">
            <button
              type="button"
              onClick={() => onCityPick(null)}
              class="w-full text-left px-4 py-3 rounded-xl border"
              style={
                draft().cityId === null
                  ? { background: "var(--accent)", color: "#fff", "border-color": "var(--accent)" }
                  : { background: "var(--bg-base)", color: "var(--text-primary)", "border-color": "var(--border-base)" }
              }
            >
              <p class="text-sm font-semibold">Toda Argentina</p>
              <p class="text-[11px] opacity-80">Noticias del país entero</p>
            </button>
            <Show when={cities()} fallback={<Skeleton />}>
              <For each={cities()!}>
                {(c: ApiCity) => (
                  <button
                    type="button"
                    onClick={() => onCityPick(c.id)}
                    class="w-full text-left px-4 py-3 rounded-xl border"
                    style={
                      draft().cityId === c.id
                        ? { background: "var(--accent)", color: "#fff", "border-color": "var(--accent)" }
                        : { background: "var(--bg-base)", color: "var(--text-primary)", "border-color": "var(--border-base)" }
                    }
                  >
                    <p class="text-sm font-semibold">{c.name}</p>
                    <p class="text-[11px] opacity-80">{c.province} · {c.count} notas</p>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </Show>

        {/* Step 2: categorias */}
        <Show when={step() === 2}>
          <p class="text-sm" style={{ color: "var(--text-secondary)" }}>
            Tocá las categorías que te interesan.
          </p>
          <div class="flex flex-wrap gap-2">
            <Show when={categories()} fallback={<Skeleton />}>
              <For each={categories()!}>
                {(c: ApiCategory) => {
                  const active = () => draft().categorySlugs.includes(c.slug);
                  return (
                    <button
                      type="button"
                      onClick={() => toggleCategory(c.slug)}
                      class="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-medium border transition-colors"
                      style={
                        active()
                          ? { background: "var(--accent)", color: "#fff", "border-color": "var(--accent)" }
                          : { background: "var(--bg-base)", color: "var(--text-primary)", "border-color": "var(--border-base)" }
                      }
                    >
                      <MaterialIcon name={c.icon} size="base" class="text-base " style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 18" }} aria-hidden="true" />
                      {c.name}
                    </button>
                  );
                }}
              </For>
            </Show>
          </div>
        </Show>

        {/* Step 3: sources */}
        <Show when={step() === 3}>
          <p class="text-sm" style={{ color: "var(--text-secondary)" }}>
            Seguí los medios que más te gusten.
          </p>
          <div class="space-y-2 max-h-[40vh] overflow-y-auto">
            <Show when={sources()} fallback={<Skeleton />}>
              <For each={sources()!}>
                {(s: ApiSourceEntry) => {
                  const active = () => draft().followedSourceIds.includes(s.id);
                  return (
                    <button
                      type="button"
                      onClick={() => toggleSource(s.id)}
                      class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left"
                      style={
                        active()
                          ? { background: "var(--accent-muted)", "border-color": "var(--accent)" }
                          : { background: "var(--bg-base)", "border-color": "var(--border-base)" }
                      }
                    >
                      <div
                        class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                        style={{
                          background: active() ? "var(--accent)" : "var(--bg-hover)",
                          color: active() ? "#fff" : "var(--text-secondary)",
                        }}
                      >
                        {s.name.charAt(0).toUpperCase()}
                      </div>
                      <div class="min-w-0 flex-1">
                        <p class="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                          {s.name}
                        </p>
                        <p class="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>
                          {s.location_name ?? s.province ?? "Argentina"} · {s.news_count ?? 0} notas
                        </p>
                      </div>
                      <MaterialIcon name={active() ? "check_circle" : "add_circle"} size="xl" class="text-xl shrink-0" style={{ color: active() ? "var(--accent)" : "var(--text-tertiary)", "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 22" }} aria-hidden="true" />
                    </button>
                  );
                }}
              </For>
            </Show>
          </div>
        </Show>

        <footer class="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={cancel}
            class="flex-1 min-h-[44px] rounded-full text-sm font-medium"
            style={{ background: "transparent", color: "var(--text-tertiary)" }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={submitting()}
            class="flex-1 min-h-[44px] rounded-full text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {submitting() ? "Guardando…" : "Guardar"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div class="space-y-2">
      <div class="h-12 rounded-xl bg-bg-hover animate-pulse" />
      <div class="h-12 rounded-xl bg-bg-hover animate-pulse" />
      <div class="h-12 rounded-xl bg-bg-hover animate-pulse" />
    </div>
  );
}
