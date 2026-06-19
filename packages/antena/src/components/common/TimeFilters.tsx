/** @jsxImportSource solid-js */
import { For } from 'solid-js';

export type TimeFilter = 'hour' | 'today' | 'week' | 'all';

interface TimeFiltersProps {
  activeFilter: TimeFilter;
  onFilterChange: (filter: TimeFilter) => void;
}

const FILTERS: { id: TimeFilter; label: string }[] = [
  { id: 'hour', label: 'Última hora' },
  { id: 'today', label: 'Hoy' },
  { id: 'week', label: 'Esta semana' },
  { id: 'all', label: 'Todas' },
];

export default function TimeFilters(props: TimeFiltersProps) {
  return (
    <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-1">
      <For each={FILTERS}>
        {(filter) => {
          const active = () => props.activeFilter === filter.id;
          return (
            <button
              onClick={() => props.onFilterChange(filter.id)}
              class="px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors border"
              style={active()
                ? { background: 'var(--accent)', color: 'var(--accent-fg)', 'border-color': 'var(--accent)' }
                : { background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', 'border-color': 'var(--border-base)' }
              }
            >
              {filter.label}
            </button>
          );
        }}
      </For>
    </div>
  );
}
