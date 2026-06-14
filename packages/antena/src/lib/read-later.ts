/** @jsxImportSource solid-js */
import { createSignal, createEffect } from 'solid-js';
import type { NewsItem } from './types';

const STORAGE_KEY = 'antena-read-later';

// Test-only handle to reset the singleton between specs.
let _instance: ReturnType<typeof createQueue> | null = null;
export function _resetReadLaterForTest() { _instance = null; }

function createQueue() {
  const load = (): NewsItem[] => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const [queue, setQueue] = createSignal<NewsItem[]>(load());

  createEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue()));
    }
  });

  // Add to the end. If the id is already in the queue,
  // move it to the end (most recently queued) instead of
  // duplicating.
  const enqueue = (item: NewsItem) => {
    setQueue(prev => {
      const filtered = prev.filter(i => i.id !== item.id);
      return [...filtered, item];
    });
  };

  const remove = (id: string) => {
    setQueue(prev => prev.filter(i => i.id !== id));
  };

  // Marking as read removes the item from the queue.
  // The caller is expected to also push it to history if
  // they want it visible there.
  const markRead = (id: string) => remove(id);

  const isQueued = (id: string) => queue().some(i => i.id === id);

  const clear = () => setQueue([]);

  return { queue, enqueue, remove, markRead, isQueued, clear };
}

// Singleton: every caller in the app sees the same queue
// and the same persistence. Tests use _resetReadLaterForTest
// to wipe state between specs.
export function useReadLater() {
  if (!_instance) _instance = createQueue();
  return _instance;
}
