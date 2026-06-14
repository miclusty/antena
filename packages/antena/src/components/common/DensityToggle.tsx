/** @jsxImportSource solid-js */
import { For } from 'solid-js';
import MaterialIcon from './MaterialIcon';

export type Density = 'compact' | 'comfortable';

interface DensityToggleProps {
  density: Density;
  onChange: (d: Density) => void;
}

const ICONS: Record<Density, string> = {
  compact: 'density_small',
  comfortable: 'density_medium',
};

export default function DensityToggle(props: DensityToggleProps) {
  return (
    <div
      class="flex items-center rounded-full p-0.5 border"
      style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
    >
      {(Object.keys(ICONS) as Density[]).map((d) => {
        const active = () => props.density === d;
        return (
          <button
            onClick={() => props.onChange(d)}
            class="px-2.5 py-1 rounded-full text-xs font-medium transition-colors"
            style={active()
              ? { background: 'var(--accent-muted)', color: 'var(--accent)' }
              : { color: 'var(--text-tertiary)' }
            }
            title={d}
          >
            <MaterialIcon name={ICONS[d]} size="base" class="text-base " style={{ 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }} />
          </button>
        );
      })}
    </div>
  );
}
