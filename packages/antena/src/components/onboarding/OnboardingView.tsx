/** @jsxImportSource solid-js */
import { createSignal, createResource, For, Show, onMount, createMemo } from "solid-js";
import { fetchCities, fetchCategories, fetchSources, followSource, type ApiSourceEntry, type ApiCategory, type ApiCity } from "../../lib/api";
import { useHaptic } from "../../lib/haptic";
import { toast } from "../Toast";
import MaterialIcon from '../common/MaterialIcon';

const ONBOARDED_KEY = "antena-onboarded";
const ONBOARDING_DRAFT_KEY = "antena-onboarding-draft";

export function isOnboarded(): boolean {
  if (typeof window === "undefined") return true; // SSR: pretend done
  try { return localStorage.getItem(ONBOARDED_KEY) === "true"; }
  catch { return true; }
}

export function markOnboarded() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ONBOARDED_KEY, "true");
    localStorage.removeItem(ONBOARDING_DRAFT_KEY);
  } catch { /* ignore */ }
}

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
  onComplete: (data: { cityId: number | null; categorySlugs: string[] }) => void;
  onSkip: () => void;
}

export default function OnboardingView(props: OnboardingViewProps) {
  const haptic = useHaptic();
  const [step, setStep] = createSignal<1 | 2 | 3>(1);
  const [draft, setDraft] = createSignal<Draft>(readDraft());
  const [submitting, setSubmitting] = createSignal(false);

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

  const canAdvance = () => {
    if (step() === 1) return true; // city optional
    if (step() === 2) return draft().categorySlugs.length >= 3;
    if (step() === 3) return draft().followedSourceIds.length >= 2;
    return false;
  };

  const advance = () => {
    if (!canAdvance()) {
      if (step() === 2) toast("Elegí al menos 3 categorías", "warning");
      if (step() === 3) toast("Seguí al menos 2 medios", "warning");
      return;
    }
    if (step() < 3) {
      setStep((s) => ((s + 1) as 1 | 2 | 3));
    } else {
      finish();
    }
  };

  const back = () => {
    if (step() > 1) setStep((s) => ((s - 1) as 1 | 2 | 3));
  };

  const finish = async () => {
    setSubmitting(true);
    // Fire follow calls in parallel — failures are non-fatal.
    const followPromises = draft().followedSourceIds.map((id) => followSource(id).catch(() => false));
    await Promise.allSettled(followPromises);
    markOnboarded();
    setSubmitting(false);
    haptic.vibrate("success");
    toast("Listo, ¡bienvenido!", "info");
    props.onComplete({ cityId: draft().cityId, categorySlugs: draft().categorySlugs });
  };

  return (
    <div
      class="fixed inset-0 z-[200] flex items-center justify-center px-4 py-6"
      style={{ background: "var(--bg-base)" }}
    >
      <div class="w-full max-w-md flex flex-col gap-5">
        {/* Progress */}
        <div class="flex items-center gap-2">
          <For each={[1, 2, 3]}>
            {(n) => (
              <div
                class="h-1 flex-1 rounded-full transition-colors"
                style={{ background: n <= step() ? "var(--accent)" : "var(--border-base)" }}
              />
            )}
          </For>
        </div>

        {/* Step 1: city */}
        <Show when={step() === 1}>
          <StepHeader
            step={1}
            title="¿De dónde sos?"
            subtitle="Vamos a priorizar las noticias de tu zona. Podés cambiarlo después."
            icon="location_on"
          />
          <div class="space-y-2 max-h-[60vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => onCityPick(null)}
              class="w-full text-left px-4 py-3 rounded-xl border"
              style={
                draft().cityId === null
                  ? { background: "var(--accent)", color: "#fff", "border-color": "var(--accent)" }
                  : { background: "var(--bg-elevated)", color: "var(--text-primary)", "border-color": "var(--border-base)" }
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
                        : { background: "var(--bg-elevated)", color: "var(--text-primary)", "border-color": "var(--border-base)" }
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

        {/* Step 2: categories */}
        <Show when={step() === 2}>
          <StepHeader
            step={2}
            title="¿Qué temas te interesan?"
            subtitle="Elegí al menos 3. Después podés cambiar."
            icon="category"
          />
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
                          : { background: "var(--bg-elevated)", color: "var(--text-primary)", "border-color": "var(--border-base)" }
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
          <p class="text-[11px] text-center" style={{ color: "var(--text-tertiary)" }}>
            {draft().categorySlugs.length} de 3+ seleccionados
          </p>
        </Show>

        {/* Step 3: sources */}
        <Show when={step() === 3}>
          <StepHeader
            step={3}
            title="Seguí al menos 2 medios"
            subtitle="Así personalizamos tu feed con cobertura de fuentes que te interesan."
            icon="group"
          />
          <div class="space-y-2 max-h-[50vh] overflow-y-auto">
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
                          : { background: "var(--bg-elevated)", "border-color": "var(--border-base)" }
                      }
                    >
                      <div
                        class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
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
          <p class="text-[11px] text-center" style={{ color: "var(--text-tertiary)" }}>
            {draft().followedSourceIds.length} de 2+ seleccionados
          </p>
        </Show>

        {/* Footer buttons */}
        <div class="flex items-center gap-3 pt-2">
          <Show when={step() > 1}>
            <button
              type="button"
              onClick={back}
              class="flex-1 min-h-[44px] rounded-full text-sm font-semibold"
              style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border-base)" }}
            >
              Atrás
            </button>
          </Show>
          <button
            type="button"
            onClick={advance}
            disabled={submitting()}
            class="flex-1 min-h-[44px] rounded-full text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {submitting() ? "Guardando…" : step() === 3 ? "Empezar" : "Siguiente"}
          </button>
        </div>

        <button
          type="button"
          onClick={props.onSkip}
          class="text-[11px] underline self-center"
          style={{ color: "var(--text-tertiary)" }}
        >
          Saltar por ahora
        </button>
      </div>
    </div>
  );
}

function StepHeader(props: { step: number; title: string; subtitle: string; icon: string }) {
  return (
    <div>
      <div
        class="w-12 h-12 rounded-full flex items-center justify-center mb-3"
        style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
      >
        <MaterialIcon name={props.icon} size="2xl" class="text-2xl " style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 28" }} aria-hidden="true" />
      </div>
      <h1 class="text-2xl font-bold" style={{ "font-family": "var(--font-display)", color: "var(--text-primary)" }}>
        {props.title}
      </h1>
      <p class="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
        {props.subtitle}
      </p>
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
