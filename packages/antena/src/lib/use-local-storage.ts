/** @jsxImportSource solid-js */
import { createSignal, createEffect, type Signal } from 'solid-js';

/**
 * Reactive localStorage-backed signal.
 *
 * - Loads `initial` on the client; returns it on the server
 *   (SSR) so hydration is deterministic.
 * - Wraps JSON.parse / JSON.stringify with try/catch so a
 *   corrupted storage entry never throws.
 * - Persists on every change via createEffect.
 *
 * The default `initial` is used as a fallback when nothing
 * is stored. Use the second tuple element (`set`) exactly
 * like a Solid signal — values are deep-cloned on the way
 * out via JSON so callers can mutate freely without
 * accidentally sharing references with the stored copy.
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
): [() => T, (next: T | ((prev: T) => T)) => void] {
  const load = (): T => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  };

  const [value, setValue] = createSignal<T>(load());

  createEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value()));
    } catch {
      // Quota exceeded / storage disabled — silent.
    }
  });

  return [value, setValue];
}
