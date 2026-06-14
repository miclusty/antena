import { describe, it, expect, beforeEach } from 'vitest';
import { useReadLater, _resetReadLaterForTest } from '../lib/read-later';

const sampleItem = {
  id: 'n1',
  title: 'Breaking news',
  summary: '',
  body: '',
  category: 'General',
  source: 'ACME',
  sourceId: 1,
  sourceUrl: 'https://example.com',
  time: '2026-01-01T00:00:00Z',
  location: '',
  bias: '',
} as never;

const otherItem = { ...sampleItem, id: 'n2', title: 'Second' } as never;

describe('useReadLater', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetReadLaterForTest();
  });

  it('starts empty', () => {
    const { queue } = useReadLater();
    expect(queue()).toEqual([]);
  });

  it('enqueue adds to the end (FIFO)', () => {
    const { queue, enqueue } = useReadLater();
    enqueue(sampleItem);
    enqueue(otherItem);
    expect(queue().map(i => i.id)).toEqual(['n1', 'n2']);
  });

  it('enqueue dedup: same id moves to end instead of duplicating', () => {
    const { queue, enqueue } = useReadLater();
    enqueue(sampleItem);
    enqueue(otherItem);
    enqueue(sampleItem); // re-add n1
    expect(queue().map(i => i.id)).toEqual(['n2', 'n1']);
  });

  it('remove drops by id', () => {
    const { queue, enqueue, remove } = useReadLater();
    enqueue(sampleItem);
    enqueue(otherItem);
    remove('n1');
    expect(queue().map(i => i.id)).toEqual(['n2']);
  });

  it('markRead removes the item', () => {
    const { queue, enqueue, markRead } = useReadLater();
    enqueue(sampleItem);
    enqueue(otherItem);
    markRead('n1');
    expect(queue().map(i => i.id)).toEqual(['n2']);
  });

  it('isQueued reports membership', () => {
    const { enqueue, isQueued } = useReadLater();
    enqueue(sampleItem);
    expect(isQueued('n1')).toBe(true);
    expect(isQueued('n2')).toBe(false);
  });

  it('persists to localStorage', () => {
    const { enqueue } = useReadLater();
    enqueue(sampleItem);
    const raw = localStorage.getItem('antena-read-later');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual([sampleItem]);
  });

  it('loads from localStorage on next mount', () => {
    const first = useReadLater();
    first.enqueue(sampleItem);
    _resetReadLaterForTest();
    const second = useReadLater();
    expect(second.queue().map(i => i.id)).toEqual(['n1']);
  });

  it('clear empties the queue', () => {
    const { queue, enqueue, clear } = useReadLater();
    enqueue(sampleItem);
    enqueue(otherItem);
    clear();
    expect(queue()).toEqual([]);
  });
});
