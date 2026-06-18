/** @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show } from "solid-js";
import { COUNTRIES_LIST, type CountryInfo } from "../../lib/countries";
import { country, setUserCountry, clearUserCountry } from "../../lib/user-country";

interface Props {
  onClose: () => void;
}

const esDN = new Intl.DisplayNames(["es"], { type: "region" });

function displayName(c: CountryInfo): string {
  return esDN.of(c.code) || c.name;
}

export default function CountrySelector(props: Props) {
  const [query, setQuery] = createSignal("");

  const filtered = createMemo(() => {
    const q = query().toLowerCase().trim();
    if (!q) return COUNTRIES_LIST;
    return COUNTRIES_LIST.filter((c) => {
      const display = displayName(c).toLowerCase();
      return display.includes(q) || c.code.toLowerCase().includes(q);
    });
  });

  const handlePick = (code: string) => {
    setUserCountry(code);
    props.onClose();
  };

  return (
    <div
      class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
      onClick={props.onClose}
      role="dialog"
      aria-label="Cambiar país"
    >
      <div
        class="bg-[var(--surface)] w-full max-w-md rounded-t-2xl sm:rounded-2xl p-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header class="flex items-center justify-between mb-3">
          <h2 class="text-lg font-semibold">Cambiar país</h2>
          <button
            type="button"
            class="text-2xl px-2"
            onClick={props.onClose}
            aria-label="Cerrar"
          >×</button>
        </header>

        <input
          type="search"
          placeholder="Buscar país…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          class="w-full px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] mb-3"
        />

        <ul class="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
          <For each={filtered()}>
            {(c) => (
              <li>
                <button
                  type="button"
                  class="w-full flex items-center gap-3 px-3 py-2 hover:bg-[var(--surface-2)] text-left"
                  onClick={() => handlePick(c.code)}
                  aria-current={country() === c.code ? "true" : undefined}
                >
                  <span class="text-2xl">{c.flag}</span>
                  <span class="flex-1">{displayName(c)}</span>
                  <Show when={country() === c.code}>
                    <span class="text-[var(--accent)]" aria-label="seleccionado">✓</span>
                  </Show>
                </button>
              </li>
            )}
          </For>
          <Show when={filtered().length === 0}>
            <li class="px-3 py-6 text-center text-[var(--text-muted)]">
              Sin resultados
            </li>
          </Show>
        </ul>

        <button
          type="button"
          class="mt-3 text-sm text-[var(--text-muted)] hover:text-[var(--text)] underline"
          onClick={() => {
            clearUserCountry();
            props.onClose();
          }}
        >
          Restablecer detección automática
        </button>
      </div>
    </div>
  );
}
