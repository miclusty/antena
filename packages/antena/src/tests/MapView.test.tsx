import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import MapView, { type MapPoint } from '../components/MapView';

afterEach(cleanup);

const samplePoints: MapPoint[] = [
  { id: 'a1', title: 'Algo en BA', category: 'Política', lat: -34.6, lng: -58.4, location_name: 'Buenos Aires', published_at: '2026-01-01T00:00:00Z' },
  { id: 'b1', title: 'Noticia en Madrid', category: 'General', lat: 40.4, lng: -3.7, location_name: 'Madrid', published_at: '2026-01-01T00:00:00Z' },
  { id: 'c1', title: 'Otra en BA', category: 'Economía', lat: -34.61, lng: -58.39, location_name: 'Buenos Aires', published_at: '2026-01-01T00:00:00Z' },
];

describe('MapView', () => {
  it('renders a svg with one cluster per unique point', () => {
    const { container } = render(() => <MapView points={samplePoints} />);
    // 2 clusters: Buenos Aires (2 items) + Madrid (1 item)
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(2);
  });

  it('renders nothing-ish when no points', () => {
    const { container } = render(() => <MapView points={[]} />);
    // The outer div still renders but the SVG has no circles.
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(0);
  });

  it('renders the cluster count when a cluster has >1 items', () => {
    const { container } = render(() => <MapView points={samplePoints} />);
    const text = container.querySelector('text');
    expect(text?.textContent).toContain('2');
  });

  it('calls onPointClick with the article id when a single-item cluster is tapped', () => {
    const onClick = vi.fn();
    const singleItem: MapPoint[] = [samplePoints[1]]; // Madrid, count=1
    const { container } = render(() => <MapView points={singleItem} onPointClick={onClick} />);
    const group = container.querySelector('g[role="button"]') as SVGGElement;
    expect(group).toBeTruthy();
    fireEvent.click(group);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].id).toBe('b1');
  });

  it('does not call onPointClick for multi-item clusters (just shows tooltip)', () => {
    const onClick = vi.fn();
    const { container } = render(() => <MapView points={samplePoints} onPointClick={onClick} />);
    const group = container.querySelector('g[role="button"]') as SVGGElement;
    fireEvent.click(group);
    expect(onClick).not.toHaveBeenCalled();
  });
});
