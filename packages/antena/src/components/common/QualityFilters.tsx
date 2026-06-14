/** @jsxImportSource solid-js */
import { For } from 'solid-js';
import MaterialIcon from '../common/MaterialIcon';

export type QualityFilter = 0 | 0.4 | 0.7;

interface QualityFiltersProps {
  activeFilter: QualityFilter;
  onFilterChange: (filter: QualityFilter) => void;
}

const FILTERS: { id: QualityFilter; label: string; icon: string; desc: string }[] = [
  { id: 0, label: 'Todas', icon: 'all_inclusive', desc: 'Sin filtro' },
  { id: 0.7, label: 'Alta', icon: 'signal_4_bar', desc: '≥ 0.7' },
  { id: 0.4, label: 'Media', icon: 'signal_3_bar', desc: '≥ 0.4' },
];

export default function QualityFilters(props: QualityFiltersProps) {
  return (
    <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-1">
      <For each={FILTERS}>
        {(filter) => {
          const active = () => props.activeFilter === filter.id;
          return (
            <button
              onClick={() => props.onFilterChange(filter.id)}
              class="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors border"
              style={active()
                ? { background: 'var(--accent)', color: '#fff', 'border-color': 'var(--accent)' }
                : { background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', 'border-color': 'var(--border-base)' }
              }
              title={filter.desc}
            >
              <MaterialIcon name={filter.icon} size="base" class="text-base " style={{ 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }} />
              <span>{filter.label}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
}
