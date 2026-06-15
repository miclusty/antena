/** @jsxImportSource solid-js */
import { createSignal, Show, onError } from 'solid-js';
import type { JSX } from 'solid-js';

interface ErrorBoundaryProps {
  children: JSX.Element;
}

export default function ErrorBoundary(props: ErrorBoundaryProps) {
  const [hasError, setHasError] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal('');

  onError((err) => {
    setHasError(true);
    setErrorMessage(err?.message || 'Algo salió mal');
    console.error('Error caught by boundary:', err);
  });

  return (
    <Show when={hasError()} fallback={props.children}>
      <div
        class="min-h-screen flex flex-col items-center justify-center py-20 text-center px-4"
        style={{ background: 'var(--bg-base)' }}
      >
        <span class="text-5xl mb-6" style={{ opacity: 0.4 }}>⚠️</span>
        <h3 class="text-xl font-bold mb-3" style={{ 'font-family': 'var(--font-display)', color: 'var(--text-primary)' }}>Algo salió mal</h3>
        <p class="text-sm mb-6 max-w-md" style={{ color: 'var(--text-tertiary)' }}>{errorMessage()}</p>
        <button
          onClick={() => window.location.reload()}
          class="px-6 py-3 rounded-full text-sm font-semibold transition-colors"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          Recargar página
        </button>
      </div>
    </Show>
  );
}
