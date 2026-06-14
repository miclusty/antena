/** @jsxImportSource solid-js */
import { createSignal, createResource, For, Show, onMount, onCleanup } from 'solid-js';
import { fetchLocations } from '../../lib/api';
import type { ApiLocation } from '../../lib/api';
import MaterialIcon from '../common/MaterialIcon';

interface LocationSelectorProps {
  activeLocation: string | null;
  onLocationChange: (locationId: string | null) => void;
}

export default function LocationSelector(props: LocationSelectorProps) {
  const [isOpen, setIsOpen] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  const [locations] = createResource<ApiLocation[]>(async () => {
    try {
      const all = await fetchLocations();
      return all.filter(l => l.type === 'provincia' || (l.type === 'ciudad' && (l.population || 0) > 100000));
    } catch {
      return [];
    }
  });

  onMount(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef && !containerRef.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  const activeName = () => {
    if (!props.activeLocation) return 'Todas las ubicaciones';
    const locs = locations();
    if (!locs) return 'Cargando...';
    const found = locs.find(l => String(l.id) === props.activeLocation);
    return found ? `${found.name}, ${found.province}` : 'Todas las ubicaciones';
  };

  return (
    <div class="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen())}
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs transition-colors"
        style={{
          background: 'var(--bg-elevated)',
          'border-color': 'var(--border-base)',
          color: 'var(--text-primary)',
        }}
        aria-expanded={isOpen()}
        aria-haspopup="listbox"
      >
        <MaterialIcon name="location_on" size="base" class="text-base " style={{ color: 'var(--accent)' }} />
        <span class="max-w-[120px] truncate">{activeName()}</span>
        <MaterialIcon name="expand_more" size="base" class="text-base " style={{ color: 'var(--text-tertiary)' }} />
      </button>

      <Show when={isOpen()}>
        <div
          class="absolute top-full left-0 mt-1 w-64 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto border"
          style={{
            background: 'var(--bg-elevated)',
            'border-color': 'var(--border-base)',
          }}
        >
          <button
            onClick={() => { props.onLocationChange(null); setIsOpen(false); }}
            class="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-bg-hover transition-colors"
            style={{ color: !props.activeLocation ? 'var(--accent)' : 'var(--text-primary)' }}
          >
            <MaterialIcon name="public" size="base" class="text-base " style={{ }} />
            Todas las ubicaciones
          </button>

          <div style={{ 'border-top': '1px solid var(--border-base)' }} />

          <div class="px-3 py-1.5">
            <span class="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Provincias</span>
          </div>
          <For each={(locations() || []).filter(l => l.type === 'provincia')}>
            {(loc) => (
              <button
                onClick={() => { props.onLocationChange(String(loc.id)); setIsOpen(false); }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-bg-hover transition-colors"
                style={{ color: String(loc.id) === props.activeLocation ? 'var(--accent)' : 'var(--text-primary)' }}
              >
                <MaterialIcon name="map" size="base" class="text-base " style={{ color: 'var(--text-tertiary)' }} />
                {loc.name}
              </button>
            )}
          </For>

          <div style={{ 'border-top': '1px solid var(--border-base)', 'margin-top': '4px' }} />
          <div class="px-3 py-1.5">
            <span class="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Ciudades</span>
          </div>
          <For each={(locations() || []).filter(l => l.type === 'ciudad')}>
            {(loc) => (
              <button
                onClick={() => { props.onLocationChange(String(loc.id)); setIsOpen(false); }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-bg-hover transition-colors"
                style={{ color: String(loc.id) === props.activeLocation ? 'var(--accent)' : 'var(--text-primary)' }}
              >
                <MaterialIcon name="location_on" size="base" class="text-base " style={{ color: 'var(--text-tertiary)' }} />
                {loc.name}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
