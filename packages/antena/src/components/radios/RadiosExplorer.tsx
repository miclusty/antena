/** @jsxImportSource solid-js */
import { createSignal, createMemo, onMount, onCleanup, For, Show } from 'solid-js';
import MaterialIcon from '../common/MaterialIcon';
import { loadUserCountry, country } from '../../lib/user-country';
import { COUNTRIES } from '../../lib/countries';
import CountrySelector from './CountrySelector';

interface Radio {
  id: number;
  name: string;
  stream_url: string;
  website: string | null;
  city: string | null;
  province: string | null;
  codgl: string | null;
  tags: string | null;
  type: string;
}

interface Props {
  radios: Radio[];
}

const PAGE_SIZE = 50;
const API_BASE_FALLBACK = 'https://akira-api.miclusty.workers.dev';

function getApiBase(): string {
  try {
    const fromEnv = (import.meta as { env?: { PUBLIC_API_BASE?: string } }).env?.PUBLIC_API_BASE;
    if (fromEnv && !fromEnv.includes('localhost')) return fromEnv;
  } catch {
    // ignore
  }
  return API_BASE_FALLBACK;
}

const formatTags = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, 3) : [];
  } catch {
    return [];
  }
};

export default function RadiosExplorer(props: Props) {
  const [query, setQuery] = createSignal('');
  const [provFilter, setProvFilter] = createSignal<string>('');
  const [page, setPage] = createSignal(1);
  // Internal radios signal — initialized from props (so the
  // component still works if a caller passes SSR-fetched radios)
  // and then populated client-side filtered by the user's
  // country via fetchRadios().
  const [radios, setRadios] = createSignal<Radio[]>(props.radios);
  const [total, setTotal] = createSignal<number>(props.radios.length);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [showCountryPicker, setShowCountryPicker] = createSignal(false);

  const provinces = createMemo(() => {
    const m = new Map<string, number>();
    for (const r of radios()) {
      const p = r.province || 'Argentina';
      m.set(p, (m.get(p) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => ({ province: p, count: n }));
  });

  const filtered = createMemo(() => {
    const q = query().toLowerCase().trim();
    const p = provFilter();
    return radios()
      .filter((r) => !p || (r.province || 'Argentina') === p)
      .filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          (r.city ?? '').toLowerCase().includes(q) ||
          (r.province ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const fetchRadios = async () => {
    if (loading()) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL(`${getApiBase()}/api/stats/radios`);
      url.searchParams.set('country', country());
      url.searchParams.set('limit', '2000');
      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': 'AntenaRadiosPage/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items?: Radio[]; total?: number };
      const items = data.items ?? [];
      setRadios(items);
      setTotal(data.total ?? items.length);
    } catch (e) {
      setError((e as Error).message || 'No se pudieron cargar las radios');
    } finally {
      setLoading(false);
    }
  };

  // Resolve the user's country before the initial fetch so the
  // first page already targets the right country. Refetch on
  // country change.
  onMount(() => {
    void loadUserCountry().then(() => fetchRadios());
    const onCountryChanged = () => {
      setPage(1);
      fetchRadios();
    };
    window.addEventListener('antena:country-changed', onCountryChanged);
    onCleanup(() => window.removeEventListener('antena:country-changed', onCountryChanged));
  });

  // Reset to page 1 when filters change
  let lastKey = '';
  const filterKey = () => `${query()}|${provFilter()}`;
  const resetIfChanged = () => {
    const k = filterKey();
    if (k !== lastKey) {
      lastKey = k;
      setPage(1);
    }
  };

  const paged = createMemo(() => {
    resetIfChanged();
    const start = (page() - 1) * PAGE_SIZE;
    return filtered().slice(start, start + PAGE_SIZE);
  });

  const totalPages = createMemo(() => Math.max(1, Math.ceil(filtered().length / PAGE_SIZE)));

  const playRadio = (r: Radio) => {
    // Persist + dispatch event so the global RadioPlayer picks it up.
    try {
      const key = 'antena.radio.v1';
      const cur = JSON.parse(localStorage.getItem(key) ?? '{}');
      localStorage.setItem(
        key,
        JSON.stringify({ ...cur, currentId: r.id, stream_url: r.stream_url, name: r.name, city: r.city, province: r.province, codgl: r.codgl }),
      );
      // Also write the full radio object so the player hydrates immediately
      // without re-fetching the directory.
      localStorage.setItem('antena.radio.selected', JSON.stringify(r));
    } catch {
      // ignore
    }
    // Tell the global player to open + play
    window.dispatchEvent(new CustomEvent('antena:play-radio', { detail: r }));
  };

  return (
    <div>
      <div class="flex flex-col sm:flex-row gap-2 mb-3">
        <div class="relative flex-1">
          <MaterialIcon
            name="search"
            size="sm"
            class="text-base absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-tertiary)' }}
          />
          <input
            type="search"
            value={query()}
            onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
            placeholder="Buscar por nombre, ciudad o provincia…"
            class="w-full pl-9 pr-3 py-2 rounded-lg text-sm border bg-transparent"
            style={{
              'border-color': 'var(--border-base)',
              color: 'var(--text-primary)',
              background: 'var(--bg-elevated)',
            }}
          />
        </div>
        <select
          value={provFilter()}
          onChange={(e) => setProvFilter((e.currentTarget as HTMLSelectElement).value)}
          class="px-3 py-2 rounded-lg text-sm border bg-transparent"
          style={{
            'border-color': 'var(--border-base)',
            color: 'var(--text-primary)',
            background: 'var(--bg-elevated)',
          }}
          aria-label="Filtrar por provincia"
        >
          <option value="">Todas las provincias</option>
          <For each={provinces()}>
            {(p) => <option value={p.province}>{p.province} ({p.count})</option>}
          </For>
        </select>
        <button
          type="button"
          class="px-3 py-2 rounded-lg text-sm border flex items-center gap-1.5 shrink-0 hover:bg-[var(--bg-elevated)]"
          style={{
            'border-color': 'var(--border-base)',
            color: 'var(--text-primary)',
            background: 'var(--bg-elevated)',
          }}
          onClick={() => setShowCountryPicker(true)}
          aria-label="Cambiar país"
        >
          <span class="leading-none">{COUNTRIES[country()]?.flag ?? '🌍'}</span>
          <span>{COUNTRIES[country()]?.name ?? country()}</span>
        </button>
      </div>

      <p class="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
        {filtered().length.toLocaleString('es-AR')} radios · {COUNTRIES[country()]?.flag ?? '🌍'} {COUNTRIES[country()]?.name ?? country()}
        {loading() ? ' · cargando…' : ''}
      </p>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <For each={paged()}>
          {(r) => (
            <button
              onClick={() => playRadio(r)}
              class="group text-left flex items-center gap-3 p-3 rounded-xl border transition-colors hover:border-[color:var(--accent)]"
              style={{
                'border-color': 'var(--border-base)',
                background: 'var(--bg-elevated)',
              }}
            >
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ background: 'var(--bg-base)', color: 'var(--accent)' }}
                aria-hidden="true"
              >
                <MaterialIcon name="radio" size="sm" class="text-base" />
              </div>
              <div class="flex-1 min-w-0">
                <p
                  class="text-sm font-semibold truncate group-hover:underline"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {r.name}
                </p>
                <p class="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                  {r.city ?? 'Argentina'}
                  {r.province ? `, ${r.province}` : ''}
                  {formatTags(r.tags).length > 0 ? ` · ${formatTags(r.tags).join(' · ')}` : ''}
                </p>
              </div>
              <span
                class="text-[10px] font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: 'var(--accent)' }}
              >
                ▶ Play
              </span>
            </button>
          )}
        </For>
      </div>

      <Show when={filtered().length === 0}>
        <div
          class="text-center py-12 rounded-xl border mt-2"
          style={{
            'border-color': 'var(--border-base)',
            background: 'var(--bg-elevated)',
          }}
        >
          <MaterialIcon
            name="search_off"
            size="lg"
            class="text-3xl mx-auto mb-2"
            style={{ color: 'var(--text-tertiary)' }}
          />
          <p class="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Sin radios para tu búsqueda
          </p>
          <button
            onClick={() => { setQuery(''); setProvFilter(''); }}
            class="mt-3 text-sm font-semibold underline"
            style={{ color: 'var(--accent)' }}
          >
            Limpiar filtros
          </button>
        </div>
      </Show>

      <Show when={totalPages() > 1}>
        <div class="flex items-center justify-center gap-1 mt-4">
          <button
            onClick={() => setPage(Math.max(1, page() - 1))}
            disabled={page() === 1}
            class="px-3 py-1.5 rounded-md text-sm font-medium border disabled:opacity-40"
            style={{
              'border-color': 'var(--border-base)',
              color: 'var(--text-primary)',
              background: 'var(--bg-elevated)',
            }}
          >
            ← Anterior
          </button>
          <span class="text-sm tabular-nums px-2" style={{ color: 'var(--text-secondary)' }}>
            {page()} / {totalPages()}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages(), page() + 1))}
            disabled={page() === totalPages()}
            class="px-3 py-1.5 rounded-md text-sm font-medium border disabled:opacity-40"
            style={{
              'border-color': 'var(--border-base)',
              color: 'var(--text-primary)',
              background: 'var(--bg-elevated)',
            }}
          >
            Siguiente →
          </button>
        </div>
      </Show>

      <Show when={showCountryPicker()}>
        <CountrySelector onClose={() => setShowCountryPicker(false)} />
      </Show>
    </div>
  );
}
