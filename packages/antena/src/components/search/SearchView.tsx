/** @jsxImportSource solid-js */
import { createSignal, createResource, For, Show, onMount, createMemo } from "solid-js";
import EmptyState from "../common/EmptyState";
import { fetchSearch, fetchCategories, type ApiNewsCard, type ApiCategory } from "../../lib/api";
import { mapNewsCard } from "../../lib/mappers";
import NewsCard from "../common/NewsCard";
import MaterialIcon from "../common/MaterialIcon";
import {
  readSavedSearches,
  pushSavedSearch,
  removeSavedSearch,
  type SavedSearch,
  type SearchFilters,
} from "../../lib/saved-searches";

const HISTORY_KEY = "antena-search-history";
const MAX_HISTORY = 8;
const TIME_OPTIONS: { id: SearchFilters["time"] | ""; label: string }[] = [
  { id: "", label: "Cualquier fecha" },
  { id: "hour", label: "Última hora" },
  { id: "today", label: "Hoy" },
  { id: "week", label: "Esta semana" },
];

function readHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

function pushHistory(q: string) {
  if (typeof window === "undefined" || !q.trim()) return;
  try {
    const cur = readHistory().filter((x) => x !== q);
    const next = [q, ...cur].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch { /* private mode */ }
}

function readFiltersFromUrl(): SearchFilters {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const category = p.get("cat") ?? undefined;
  const time = p.get("time") ?? undefined;
  const out: SearchFilters = {};
  if (category) out.category = category;
  if (time && ["hour", "today", "week", "all"].includes(time)) {
    if (time !== "all") out.time = time as SearchFilters["time"];
  }
  return out;
}

function writeFiltersToUrl(f: SearchFilters) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (f.category) url.searchParams.set("cat", f.category); else url.searchParams.delete("cat");
  if (f.time) url.searchParams.set("time", f.time); else url.searchParams.delete("time");
  window.history.pushState({}, "", url.toString());
}

export default function SearchView() {
  const [query, setQuery] = createSignal(readQueryFromUrl());
  const [filters, setFilters] = createSignal<SearchFilters>(readFiltersFromUrl());
  const [history, setHistory] = createSignal<string[]>(readHistory());
  const [saved, setSaved] = createSignal<SavedSearch[]>(readSavedSearches());
  const [submitted, setSubmitted] = createSignal(query().length >= 2);
  const [categories] = createResource(() => fetchCategories().then((arr) => arr.filter((c) => c.slug !== "all")));

  const [results] = createResource(
    () => (submitted() && query().length >= 2 ? { q: query(), f: filters() } : null),
    async ({ q, f }) => {
      const res = await fetchSearch(q, 30, f);
      return res.results.map(mapNewsCard);
    },
  );

  onMount(() => {
    const onPop = () => {
      setQuery(readQueryFromUrl());
      setFilters(readFiltersFromUrl());
      setSubmitted(readQueryFromUrl().length >= 2);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  });

  const submit = (q: string, f: SearchFilters = filters()) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) return;
    setQuery(trimmed);
    setFilters(f);
    setSubmitted(true);
    writeQueryToUrl(trimmed);
    writeFiltersToUrl(f);
    pushHistory(trimmed);
    setHistory(readHistory());
  };

  const setFilterAndSubmit = (patch: Partial<SearchFilters>) => {
    const next = { ...filters(), ...patch };
    setFilters(next);
    writeFiltersToUrl(next);
    // Re-submit with the same query (filters are URL state, so
    // popstate/submit cycle stays consistent).
    if (submitted() && query().length >= 2) {
      setSubmitted(false);
      queueMicrotask(() => submit(query(), next));
    }
  };

  const onInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    setQuery(e.currentTarget.value);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") submit(query());
  };

  const clear = () => {
    setQuery("");
    setSubmitted(false);
    writeQueryToUrl("");
    setFilters({});
    writeFiltersToUrl({});
  };

  const selectHistory = (h: string) => submit(h, filters());
  const selectSaved = (s: SavedSearch) => {
    setQuery(s.q);
    setFilters(s.filters);
    submit(s.q, s.filters);
  };

  const saveCurrent = () => {
    if (query().length < 2) return;
    pushSavedSearch({
      q: query(),
      filters: filters(),
      savedAt: new Date().toISOString(),
    });
    setSaved(readSavedSearches());
  };

  const isSaved = createMemo(() => {
    return saved().some((s) => s.q === query() && JSON.stringify(s.filters) === JSON.stringify(filters()));
  });

  const activeFilterCount = createMemo(() => {
    let n = 0;
    if (filters().category) n++;
    if (filters().time) n++;
    return n;
  });

  return (
    <div class="w-full">
      {/* Search input */}
      <div class="sticky top-0 z-20 px-4 py-3 border-b border-border-base" style={{ background: "var(--bg-base)" }}>
        <div class="flex items-center gap-2">
          <div class="flex-1 flex items-center gap-2 px-3 py-2 rounded-full" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border-base)" }}>
            <MaterialIcon name="search" size="xl" class="text-xl " style={{ color: "var(--text-tertiary)", "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }} aria-hidden="true" />
            <input
              type="search"
              value={query()}
              onInput={onInput}
              onKeyDown={onKeyDown}
              placeholder="Buscar en Antena…"
              class="flex-1 bg-transparent text-sm outline-none"
              style={{ color: "var(--text-primary)" }}
              aria-label="Buscar"
              autofocus
            />
            <Show when={query().length > 0}>
              <button
                type="button"
                onClick={clear}
                class="text-xs px-2 py-0.5 rounded-full"
                style={{ color: "var(--text-tertiary)" }}
                aria-label="Limpiar"
              >
                limpiar
              </button>
            </Show>
          </div>
          <Show when={submitted() && query().length >= 2}>
            <button
              type="button"
              onClick={saveCurrent}
              disabled={isSaved()}
              class="flex items-center gap-1 px-3 py-2 rounded-full text-xs font-semibold shrink-0 transition-opacity disabled:opacity-50"
              style={{
                background: isSaved() ? "var(--bg-elevated)" : "var(--accent-muted)",
                color: isSaved() ? "var(--text-secondary)" : "var(--accent)",
                border: "1px solid var(--border-base)",
              }}
              aria-pressed={isSaved()}
              aria-label={isSaved() ? "Ya guardado" : "Guardar búsqueda"}
            >
              <MaterialIcon name={isSaved() ? "bookmark" : "bookmark_border"} size="base" class="text-base " style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 18" }} aria-hidden="true" />
              <span class="hidden sm:inline">{isSaved() ? "Guardada" : "Guardar"}</span>
            </button>
          </Show>
        </div>

        {/* Filter chips (visible after a search is submitted) */}
        <Show when={submitted() && query().length >= 2}>
          <div class="mt-3 space-y-2">
            {/* Category chips */}
            <Show when={categories()}>
              <div class="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setFilterAndSubmit({ category: undefined })}
                  class="text-[11px] font-semibold px-2.5 py-1 rounded-full border"
                  style={
                    !filters().category
                      ? { background: "var(--accent)", color: "#fff", "border-color": "var(--accent)" }
                      : { background: "var(--bg-elevated)", color: "var(--text-tertiary)", "border-color": "var(--border-base)" }
                  }
                >
                  Todas
                </button>
                <For each={categories()!}>
                  {(c: ApiCategory) => (
                    <button
                      type="button"
                      onClick={() => setFilterAndSubmit({ category: c.slug })}
                      class="text-[11px] font-semibold px-2.5 py-1 rounded-full border"
                      style={
                        filters().category === c.slug
                          ? { background: "var(--accent)", color: "#fff", "border-color": "var(--accent)" }
                          : { background: "var(--bg-elevated)", color: "var(--text-tertiary)", "border-color": "var(--border-base)" }
                      }
                    >
                      {c.name}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            {/* Time chips */}
            <div class="flex flex-wrap gap-1.5">
              <For each={TIME_OPTIONS}>
                {(opt) => (
                  <button
                    type="button"
                    onClick={() => setFilterAndSubmit({ time: opt.id || undefined })}
                    class="text-[11px] font-semibold px-2.5 py-1 rounded-full border"
                    style={
                      (filters().time ?? "") === opt.id
                        ? { background: "var(--accent)", color: "#fff", "border-color": "var(--accent)" }
                        : { background: "var(--bg-elevated)", color: "var(--text-tertiary)", "border-color": "var(--border-base)" }
                    }
                  >
                    {opt.label}
                  </button>
                )}
              </For>
            </div>
            <Show when={activeFilterCount() > 0}>
              <button
                type="button"
                onClick={() => setFilterAndSubmit({ category: undefined, time: undefined })}
                class="text-[11px] font-semibold"
                style={{ color: "var(--accent)" }}
              >
                Limpiar filtros
              </button>
            </Show>
          </div>
        </Show>

        {/* Recent searches */}
        <Show when={!submitted() && history().length > 0}>
          <div class="mt-3">
            <p class="text-[10px] font-extrabold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-tertiary)" }}>
              Recientes
            </p>
            <div class="flex flex-wrap gap-1.5">
              <For each={history()}>
                {(h) => (
                  <button
                    type="button"
                    onClick={() => selectHistory(h)}
                    class="text-[12px] font-medium px-2.5 py-1 rounded-full"
                    style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border-base)" }}
                  >
                    {h}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Saved searches */}
        <Show when={!submitted() && saved().length > 0}>
          <div class="mt-3">
            <p class="text-[10px] font-extrabold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-tertiary)" }}>
              Búsquedas guardadas
            </p>
            <div class="flex flex-wrap gap-1.5">
              <For each={saved()}>
                {(s) => (
                  <div class="inline-flex items-center gap-1 rounded-full" style={{ background: "var(--accent-muted)", border: "1px solid var(--border-base)" }}>
                    <button
                      type="button"
                      onClick={() => selectSaved(s)}
                      class="text-[12px] font-medium px-2.5 py-1"
                      style={{ color: "var(--accent)" }}
                    >
                      {s.q}
                      <Show when={s.filters.category || s.filters.time}>
                        <span class="opacity-60 ml-1">·</span>
                      </Show>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        removeSavedSearch({ q: s.q, filters: s.filters });
                        setSaved(readSavedSearches());
                      }}
                      class="px-1.5 py-1 text-xs"
                      style={{ color: "var(--text-tertiary)" }}
                      aria-label={`Quitar búsqueda guardada ${s.q}`}
                    >
                      ×
                    </button>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>

      {/* Results */}
      <Show
        when={submitted()}
        fallback={
          <div class="px-4 py-6">
            <EmptyState
              icon="search"
              title="Empezá a escribir"
              description="Buscá por palabra, lugar, persona o medio. Enter para buscar."
            />
          </div>
        }
      >
        <Show
          when={!results.loading}
          fallback={
            <div class="px-4 py-3 text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--text-tertiary)" }}>
              Buscando...
            </div>
          }
        >
          <Show
            when={(results() ?? []).length > 0}
            fallback={
              <div class="px-4 py-6">
                <EmptyState
                  icon="search_off"
                  title="Sin resultados"
                  description={`No encontramos nada para "${query()}" con esos filtros. Probá con otras palabras.`}
                />
              </div>
            }
          >
            <div class="px-4 py-3 text-xs uppercase tracking-wider font-semibold flex items-center gap-2" style={{ color: "var(--text-tertiary)" }}>
              <span>{(results() ?? []).length} resultados</span>
              <Show when={activeFilterCount() > 0}>
                <span>·</span>
                <span>{activeFilterCount()} filtro{activeFilterCount() > 1 ? "s" : ""}</span>
              </Show>
            </div>
            <For each={results() ?? []}>
              {(item) => (
                <NewsCard
                  news={item}
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.location.href = `/?view=article&id=${item.id}`;
                    }
                  }}
                />
              )}
            </For>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

function readQueryFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q") ?? "";
}

function writeQueryToUrl(q: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (q) url.searchParams.set("q", q);
  else url.searchParams.delete("q");
  window.history.pushState({}, "", url.toString());
}
