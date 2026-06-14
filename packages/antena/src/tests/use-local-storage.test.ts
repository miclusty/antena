import { describe, it, expect, beforeEach } from 'vitest';
import { useLocalStorage } from '../lib/use-local-storage';

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the initial value when storage is empty', () => {
    const [value] = useLocalStorage<string[]>('test.empty', []);
    expect(value()).toEqual([]);
  });

  it('persists changes to localStorage', () => {
    const [, setValue] = useLocalStorage<string[]>('test.persist', []);
    setValue(['a', 'b']);
    const raw = localStorage.getItem('test.persist');
    expect(raw).toBe(JSON.stringify(['a', 'b']));
  });

  it('loads existing values from localStorage', () => {
    localStorage.setItem('test.load', JSON.stringify(['x', 'y']));
    const [value] = useLocalStorage<string[]>('test.load', []);
    expect(value()).toEqual(['x', 'y']);
  });

  it('accepts functional updater', () => {
    const [, setValue] = useLocalStorage<number>('test.fn', 0);
    setValue(prev => prev + 5);
    setValue(prev => prev + 3);
    expect(JSON.parse(localStorage.getItem('test.fn')!)).toBe(8);
  });

  it('handles corrupted JSON gracefully', () => {
    localStorage.setItem('test.corrupt', 'not-json{');
    const [value] = useLocalStorage<{ ok: boolean }>('test.corrupt', { ok: true });
    expect(value()).toEqual({ ok: true });
  });

  it('persists complex objects', () => {
    const initial = { items: [{ id: 'a', q: 1 }], meta: { count: 1 } };
    const [, setValue] = useLocalStorage<typeof initial>('test.obj', initial);
    setValue({ items: [...initial.items, { id: 'b', q: 2 }], meta: { count: 2 } });
    expect(JSON.parse(localStorage.getItem('test.obj')!)).toEqual({
      items: [{ id: 'a', q: 1 }, { id: 'b', q: 2 }],
      meta: { count: 2 },
    });
  });
});
