/** @jsxImportSource solid-js */
import { createSignal, createEffect } from 'solid-js';

export function useBookmarks() {
  const STORAGE_KEY = 'antena-bookmarks';

  const loadBookmarks = (): string[] => {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  };

  const [bookmarks, setBookmarks] = createSignal<string[]>(loadBookmarks());

  createEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks()));
    }
  });

  const isBookmarked = (id: string) => bookmarks().includes(id);

  const toggleBookmark = (id: string) => {
    setBookmarks(prev =>
      prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]
    );
  };

  const removeBookmark = (id: string) => {
    setBookmarks(prev => prev.filter(b => b !== id));
  };

  const clearBookmarks = () => {
    setBookmarks([]);
  };

  return { bookmarks, isBookmarked, toggleBookmark, removeBookmark, clearBookmarks };
}
