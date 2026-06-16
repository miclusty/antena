/** @jsxImportSource solid-js */
import { createSignal, createMemo, For, Show } from 'solid-js';
import MaterialIcon from '../common/MaterialIcon';

interface ClientSource {
  id: number;
  name: string;
  url: string;
  type: string;
  news_count: number;
  reliability_score: number;
  is_active: number;
  last_fetch: string | null;
  province: string | null;
  location_name: string | null;
}

interface Props {
  sources: ClientSource[];
  typeLabels: Record<string, string>;
}

const PAGE_SIZE = 50;

const typeIcon: Record<string, string> = {
  diario: 'newspaper',
  radio: 'radio',
  portal: 'language',
  regional: 'public',
  local: 'location_city',
  provincial: 'account_balance',
  rss: 'rss_feed',
  news_portal: 'article',
  other: 'category',
};

function formatDate(s: string | null): string {
  if (!s) return 'nunca';
  const d = new Date(s);
  const now = new Date();
  const h = Math.round((now.getTime() - d.getTime()) / (1000 * 60 * 60));
  if (h < 1) return 'hace <1h';
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.round(h / 24)}d`;
}

export default function MediosExplorer(props: Props) {
  const [query, setQuery] = createSignal('');
  const [typeFilter, setTypeFilter] = createSignal<string>('');
  const [provFilter, setProvFilter] = createSignal<string>('');
  const [page, setPage] = createSignal(1);

  const types = createMemo(() => {
    const m = new Map<string, number>();
    for (const s of props.sources) m.set(s.type, (m.get(s.type) ?? 0) + 1);
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => ({ type: t, count: n }));
  });

  const provinces = createMemo(() => {
    const m = new Map<string, number>();
    for (const s of props.sources) {
      const p = s.province || 'Argentina';
      m.set(p, (m.get(p) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => ({ province: p, count: n }));
  });

  const filtered = createMemo(() => {
    const q = query().toLowerCase().trim();
    const t = typeFilter();
    const p = provFilter();
    return props.sources
      .filter((s) => !t || s.type === t)
      .filter((s) => !p || s.province === p)
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          (s.province ?? '').toLowerCase().includes(q) ||
          (s.location_name ?? '').toLowerCase().includes(q) ||
          s.url.toLowerCase().includes(q),
      )
      .sort((a, b) => b.news_count - a.news_count);
  });

  // Reset to page 1 when filters change
  const filterKey = () => `${query()}|${typeFilter()}|${provFilter()}`;
  let lastKey = '';
  const resetPageIfChanged = () => {
    const k = filterKey();
    if (k !== lastKey) {
      lastKey = k;
      setPage(1);
    }
  };

  const paged = createMemo(() => {
    resetPageIfChanged();
    const start = (page() - 1) * PAGE_SIZE;
    return filtered().slice(start, start + PAGE_SIZE);
  });

  const totalPages = createMemo(() => Math.max(1, Math.ceil(filtered().length / PAGE_SIZE)));

  return (
    <div>
      {/* Search + filters */}
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
            placeholder="Buscar por nombre, provincia o URL…"
            class="w-full pl-9 pr-3 py-2 rounded-lg text-sm border bg-transparent"
            style={{
              'border-color': 'var(--border-base)',
              color: 'var(--text-primary)',
              background: 'var(--bg-elevated)',
            }}
          />
        </div>
        <select
          value={typeFilter()}
          onChange={(e) => setTypeFilter((e.currentTarget as HTMLSelectElement).value)}
          class="px-3 py-2 rounded-lg text-sm border bg-transparent"
          style={{
            'border-color': 'var(--border-base)',
            color: 'var(--text-primary)',
            background: 'var(--bg-elevated)',
          }}
          aria-label="Filtrar por tipo"
        >
          <option value="">Todos los tipos</option>
          <For each={types()}>
            {(t) => <option value={t.type}>{props.typeLabels[t.type] || t.type} ({t.count})</option>}
          </For>
        </select>
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
      </div>

      {/* Result count */}
      <p class="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
        Mostrando {(page() - 1) * PAGE_SIZE + 1}–{Math.min(page() * PAGE_SIZE, filtered().length)} de {filtered().length}
        {filtered().length !== props.sources.length ? ` (filtrado de ${props.sources.length})` : ''}
      </p>

      {/* Cards grid */}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <For each={paged()}>
          {(s) => (
            <a
              href={s.url}
              target="_blank"
              rel="noopener"
              class="group flex items-center gap-2 p-2.5 rounded-lg border transition-colors hover:border-[color:var(--accent)]"
              style={{
                'border-color': 'var(--border-base)',
                background: 'var(--bg-elevated)',
              }}
            >
              <div
                class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: 'var(--bg-base)', color: 'var(--accent)' }}
                aria-hidden="true"
              >
                <MaterialIcon
                  name={(typeIcon[s.type] ?? 'category') as any}
                  size="sm"
                  class="text-base"
                />
              </div>
              <div class="flex-1 min-w-0">
                <p
                  class="text-sm font-semibold truncate group-hover:underline"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {s.name}
                </p>
                <p class="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                  {s.province || 'Argentina'} · {s.news_count.toLocaleString('es-AR')} art.
                </p>
              </div>
            </a>
          )}
        </For>
      </div>

      <Show when={filtered().length === 0}>
        <div
          class="text-center py-12 rounded-xl border"
          style={{
            'border-color': 'var(--border-base)',
            background: 'var(--bg-elevated)',
          }}
        >
          <MaterialIcon name="search_off" size="lg" class="text-3xl mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          <p class="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Sin resultados para tu búsqueda
          </p>
          <button
            onClick={() => { setQuery(''); setTypeFilter(''); setProvFilter(''); }}
            class="mt-3 text-sm font-semibold underline"
            style={{ color: 'var(--accent)' }}
          >
            Limpiar filtros
          </button>
        </div>
      </Show>

      {/* Pagination */}
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
    </div>
  );
}
