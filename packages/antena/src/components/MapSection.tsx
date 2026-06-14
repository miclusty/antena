/** @jsxImportSource solid-js */
import { createResource, Show } from 'solid-js';
import MapView, { type MapPoint } from './MapView';
import { fetchMap } from '../lib/api';
import { useHaptic } from '../lib/haptic';
import { trackEvent } from '../lib/analytics';
import MaterialIcon from './common/MaterialIcon';

interface MapSectionProps {
  // Receives the point id of the clicked marker. The
  // parent looks up the full NewsItem in the feed and
  // calls its article-open handler — the section itself
  // stays presentational and doesn't import App state.
  onPointClick: (pointId: string) => void;
}

/**
 * Inline feed section that shows a stylised world map
 * with the locations of the last 24h of news. The map
 * is rendered as inline SVG with an equirectangular
 * projection of lat/lng → x/y on a 1000×500 viewBox.
 */
export default function MapSection(props: MapSectionProps) {
  const haptic = useHaptic();

  const [data] = createResource(() => fetchMap(500), {
    initialValue: null,
  });

  const points = (): MapPoint[] => data()?.items ?? [];

  return (
    <Show when={points().length > 0}>
      <section
        class="rounded-2xl border p-4 mb-4"
        style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
        aria-labelledby="map-section-title"
      >
        <header class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <MaterialIcon name="public" size="base" class="text-base " style={{ color: 'var(--accent)' }} aria-hidden="true" />
            <h2
              id="map-section-title"
              class="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Dónde está pasando
            </h2>
          </div>
          <span
            class="text-[10px]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {points().length} noticias · 24h
          </span>
        </header>

        <MapView
          points={points()}
          onPointClick={(p) => {
            haptic.vibrate('tap');
            trackEvent({ type: 'card_view', newsId: p.id, source: 'map' });
            props.onPointClick(p.id);
          }}
        />
      </section>
    </Show>
  );
}

