/** @jsxImportSource solid-js */
import { createSignal, createEffect, untrack, onCleanup } from 'solid-js';

interface UseInfiniteScrollProps {
  onLoadMore: () => void;
  hasMore: () => boolean;
  isLoading: () => boolean;
}

export function useInfiniteScroll(props: UseInfiniteScrollProps) {
  const [observerTarget, setObserverTarget] = createSignal<HTMLDivElement | null>(null);

  createEffect(() => {
    const target = observerTarget();
    if (!target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (!entry.isIntersecting) return;
        // untrack: we don't want to re-create the observer when these change;
        // we just want the current value at fire time
        if (untrack(props.hasMore) && !untrack(props.isLoading)) {
          props.onLoadMore();
        }
      },
      { rootMargin: '200px 0px', threshold: 0 }
    );

    observer.observe(target);
    onCleanup(() => observer.disconnect());
  });

  return { setObserverTarget };
}
