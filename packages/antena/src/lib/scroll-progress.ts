import { createSignal, onCleanup } from 'solid-js';

export type ScrollProgressRef = (el: HTMLElement | null) => void;
export type ScrollProgressSignal = () => boolean;

/**
 * Create a one-way scroll-progress signal driven by IntersectionObserver.
 *
 * Returns a tuple `[ref, passed]`:
 * - `ref` — assign as a Solid `ref={ref}` callback on the sentinel
 *   element. Once the element mounts the IO is wired up.
 * - `passed` — accessor that becomes `true` once the sentinel has
 *   intersected the viewport with `intersectionRatio >= threshold`.
 *   It is one-way (sticky reveal): once true, it stays true.
 *
 * The observer is disconnected on cleanup.
 */
export function createScrollProgress(
  threshold: number
): [ScrollProgressRef, ScrollProgressSignal] {
  const [passed, setPassed] = createSignal(false);
  let observer: IntersectionObserver | null = null;

  const ref: ScrollProgressRef = (el) => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (!el) return;
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return;
    observer = new IntersectionObserver(
      (entries) => {
        if (passed()) return;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
            setPassed(true);
            break;
          }
        }
      },
      { threshold: [0, threshold, 1] }
    );
    observer.observe(el);
  };

  onCleanup(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  });

  return [ref, passed];
}
