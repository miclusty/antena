/** @jsxImportSource solid-js */
import { createSignal, createEffect, onCleanup, onMount } from 'solid-js';

type ThemeMode = 'light' | 'dark' | 'auto';
const THEME_KEY = 'antena-theme';

export function getTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';
  try { return (localStorage.getItem(THEME_KEY) as ThemeMode) || 'auto'; }
  catch { return 'auto'; }
}

function setTheme(mode: ThemeMode): void {
  try { localStorage.setItem(THEME_KEY, mode); } catch {}
}

function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  const isDark = mode === 'dark' || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', isDark);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark ? '#0a0a0a' : '#F9F6F0');
}

export function createTheme() {
  const mode = getTheme();
  applyTheme(mode);

  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => { if (getTheme() === 'auto') applyTheme('auto'); };
  mq.addEventListener('change', handler);

  function cycle(): ThemeMode {
    const current = getTheme();
    const next = current === 'light' ? 'auto' : current === 'auto' ? 'dark' : 'light';
    setTheme(next);
    applyTheme(next);
    return next;
  }

  return { cycle, get: () => getTheme(), apply: applyTheme };
}

export function useTheme() {
  const [theme, setThemeSignal] = createSignal<ThemeMode>(getTheme());

  createEffect(() => {
    const t = theme();
    applyTheme(t);
    setTheme(t);
  });

  onMount(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme() === 'auto') applyTheme('auto');
    };
    mq.addEventListener('change', handler);
    onCleanup(() => mq.removeEventListener('change', handler));
  });

  const toggleTheme = () => {
    const current = theme();
    const next = current === 'dark' ? 'light' : current === 'light' ? 'auto' : 'dark';
    setThemeSignal(next);
  };

  return { theme, toggleTheme };
}
