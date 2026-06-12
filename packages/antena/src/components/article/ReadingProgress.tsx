/** @jsxImportSource solid-js */
import { createSignal, onMount, onCleanup } from 'solid-js';

export default function ReadingProgress() {
  const [progress, setProgress] = createSignal(0);

  const handleScroll = () => {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    setProgress(docHeight > 0 ? Math.min((scrollTop / docHeight) * 100, 100) : 0);
  };

  onMount(() => {
    window.addEventListener('scroll', handleScroll, { passive: true });
  });

  onCleanup(() => {
    window.removeEventListener('scroll', handleScroll);
  });

  return (
    <div
      class="fixed top-0 left-0 right-0 z-[55] h-[3px]"
      style={{ background: 'var(--border-base)', opacity: 0.3 }}
    >
      <div
        class="h-full transition-[width] duration-150 ease-out"
        style={{ width: `${progress()}%`, background: 'var(--accent)' }}
      />
    </div>
  );
}
