// MapView — simplified world map with location dots.
// No Leaflet: the bundle budget is tight and a v1 of the
// map can ship with equirectangular-projected dots on a
// stylized background. When the user wants a real map
// with country outlines + tiles, swap in Leaflet via
// dynamic import inside this component.
//
// Projection: equirectangular. Maps (-180, 90) to (0, 0)
// and (180, -90) to (W, H). The world rectangle is
// 2:1 aspect (W = 2H).

/** @jsxImportSource solid-js */
import { createMemo, createSignal, For, Show } from 'solid-js';
import MaterialIcon from './common/MaterialIcon';

export interface MapPoint {
  id: string;
  title: string;
  category: string | null;
  lat: number;
  lng: number;
  location_name: string;
  published_at: string | null;
}

interface MapViewProps {
  points: MapPoint[];
  onPointClick?: (point: MapPoint) => void;
  loading?: boolean;
}

const W = 1000;
const H = 500;

// Project lat/lng to SVG x/y using a simple
// equirectangular projection.
function project(lat: number, lng: number): { x: number; y: number } {
  const x = ((lng + 180) / 360) * W;
  const y = ((90 - lat) / 180) * H;
  return { x, y };
}

// Group nearby points into clusters to avoid visual
// overload in dense areas. The cluster key is the
// truncated projected x/y at gridSize resolution.
interface Cluster extends MapPoint {
  count: number;
  items: MapPoint[];
}

function clusterPoints(points: MapPoint[], gridSize = 30): Cluster[] {
  const grid = new Map<string, Cluster>();
  for (const p of points) {
    const { x, y } = project(p.lat, p.lng);
    const gx = Math.floor(x / gridSize);
    const gy = Math.floor(y / gridSize);
    const key = `${gx},${gy}`;
    const existing = grid.get(key);
    if (existing) {
      existing.count++;
      existing.items.push(p);
    } else {
      grid.set(key, { ...p, count: 1, items: [p] });
    }
  }
  return Array.from(grid.values());
}

export default function MapView(props: MapViewProps) {
  const [hover, setHover] = createSignal<Cluster | null>(null);

  const clusters = createMemo(() => clusterPoints(props.points));

  return (
    <div
      class="relative w-full overflow-hidden rounded-2xl border"
      style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        class="w-full h-auto block"
        role="img"
        aria-label="Mapa de noticias de las últimas 24 horas"
      >
        <defs>
          <linearGradient id="mapGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--bg-elevated)" />
            <stop offset="100%" stop-color="var(--bg-base)" />
          </linearGradient>
          <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="var(--border-base)" stroke-width="0.5" />
          </pattern>
        </defs>

        {/* Background */}
        <rect width={W} height={H} fill="url(#mapGrad)" />
        <rect width={W} height={H} fill="url(#grid)" />

        {/* Equator + prime meridian for orientation */}
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="var(--text-tertiary)" stroke-width="0.5" stroke-dasharray="4 4" opacity="0.3" />
        <line x1={W / 2} y1="0" x2={W / 2} y2={H} stroke="var(--text-tertiary)" stroke-width="0.5" stroke-dasharray="4 4" opacity="0.3" />

        {/* Points / clusters */}
        <For each={clusters()}>
          {(c) => {
            const { x, y } = project(c.lat, c.lng);
            const radius = () => Math.min(18, 4 + Math.sqrt(c.count) * 2.5);
            return (
              <g
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHover(c)}
                onMouseLeave={() => setHover(null)}
                onClick={() => {
                  if (c.count === 1 && props.onPointClick) {
                    props.onPointClick(c.items[0]);
                  } else {
                    setHover(c);
                  }
                }}
                role="button"
                tabindex="0"
                aria-label={`${c.count} noticia${c.count !== 1 ? 's' : ''} en ${c.location_name}`}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={radius()}
                  fill="var(--accent)"
                  opacity={hover() === c ? 0.9 : 0.6}
                  stroke="var(--bg-base)"
                  stroke-width="1.5"
                />
                <text
                  x={x}
                  y={y + 3}
                  text-anchor="middle"
                  font-size={radius() > 10 ? '11' : '0'}
                  font-weight="700"
                  fill="var(--bg-base)"
                  style={{ 'pointer-events': 'none' }}
                >
                  {c.count > 1 ? c.count : ''}
                </text>
              </g>
            );
          }}
        </For>

        <Show when={props.loading && props.points.length === 0}>
          <text
            x={W / 2}
            y={H / 2}
            text-anchor="middle"
            font-size="18"
            fill="var(--text-tertiary)"
          >
            Cargando mapa…
          </text>
        </Show>
      </svg>

      <Show when={hover()}>
        {(c) => (
          <div
            class="absolute top-3 left-3 right-3 sm:left-auto sm:right-3 sm:w-72 rounded-xl border p-3 shadow-lg"
            style={{
              background: 'var(--bg-elevated)',
              'border-color': 'var(--border-base)',
            }}
            role="tooltip"
          >
            <p class="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>
              {c().location_name}
            </p>
            <p class="text-sm font-semibold leading-snug mb-1" style={{ color: 'var(--text-primary)' }}>
              {c().count === 1 ? c().title : `${c().count} noticias`}
            </p>
            <Show when={c().count > 1}>
              <ul class="text-[12px] space-y-1 max-h-40 overflow-y-auto" style={{ color: 'var(--text-secondary)' }}>
                <For each={c().items.slice(0, 4)}>
                  {(item) => (
                    <li class="line-clamp-1">• {item.title}</li>
                  )}
                </For>
                <Show when={c().items.length > 4}>
                  <li style={{ color: 'var(--text-tertiary)' }}>
                    +{c().items.length - 4} más
                  </li>
                </Show>
              </ul>
            </Show>
            <button
              type="button"
              onClick={() => {
                if (c().items.length > 0 && props.onPointClick) {
                  props.onPointClick(c().items[0]);
                }
              }}
              class="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              <MaterialIcon name="arrow_forward" size="sm" class="text-[14px] " style={{ }} aria-hidden="true" />
              Ver detalle
            </button>
          </div>
        )}
      </Show>
    </div>
  );
}
