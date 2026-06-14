/** @jsxImportSource solid-js */
import { useLocalStorage } from './use-local-storage';

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useLocalStorage<string[]>('antena-bookmarks', []);

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
