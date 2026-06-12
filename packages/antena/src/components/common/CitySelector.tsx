/** @jsxImportSource solid-js */
import { For } from 'solid-js';

export interface City {
  id: number;
  name: string;
  province: string;
  count: number;
}

export interface CitySelectorProps {
  cities: City[];
  activeCityId: number | null;
  onSelect: (cityId: number | null) => void;
}

export default function CitySelector(props: CitySelectorProps) {
  return (
    <div
      class="flex items-center gap-2 overflow-x-auto px-4 py-2"
      style={{ 'scrollbar-width': 'none', '-ms-overflow-style': 'none' }}
      role="tablist"
      aria-label="Selector de ciudad"
    >
      <button
        type="button"
        role="tab"
        aria-selected={props.activeCityId === null}
        onClick={() => props.onSelect(null)}
        class="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full min-h-[36px] transition-colors duration-150 active:scale-95"
        style={
          props.activeCityId === null
            ? {
                background: 'var(--accent)',
                color: '#fff',
                border: '1px solid var(--accent)',
              }
            : {
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-base)',
              }
        }
      >
        Todas
      </button>
      <For each={props.cities}>
        {(city) => {
          const isActive = () => props.activeCityId === city.id;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={isActive()}
              onClick={() => props.onSelect(city.id)}
              class="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full min-h-[36px] transition-colors duration-150 active:scale-95 whitespace-nowrap"
              style={
                isActive()
                  ? {
                      background: 'var(--accent)',
                      color: '#fff',
                      border: '1px solid var(--accent)',
                    }
                  : {
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-base)',
                    }
              }
            >
              {city.name} <span style={{ opacity: 0.7 }}>{city.count}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
}
