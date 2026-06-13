/** @jsxImportSource solid-js */
import { createSignal, Show } from 'solid-js';

interface ReadingModeProps {
  title: string;
  body: string;
  summary: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function ReadingMode(props: ReadingModeProps) {
  const [fontSize, setFontSize] = createSignal(18);
  const [isDark, setIsDark] = createSignal(false);

  const theme = () => ({
    bg: isDark() ? '#0f0f13' : '#ffffff',
    text: isDark() ? '#e4e4e4' : '#1a1a1a',
    muted: isDark() ? '#888' : '#666',
  });

  const readingTime = () => {
    const words = (props.body || props.summary || '').split(/\s+/).length;
    return `~${Math.max(1, Math.round(words / 200))} min de lectura`;
  };

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-[60] overflow-y-auto"
        style={{ 'background-color': theme().bg }}
      >
        {/* Controls bar */}
        <div
          class="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b"
          style={{
            'background-color': theme().bg,
            'border-color': theme().muted + '33',
          }}
        >
          <button
            onClick={props.onClose}
            class="p-2 -ml-2 rounded-full transition-colors"
            style={{ color: theme().text }}
          >
            <span
              class="material-symbols-rounded text-xl leading-none"
              style={{ 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }}
            >
              close
            </span>
          </button>

          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1">
              <span class="text-xs" style={{ color: theme().muted }}>A</span>
              <input
                type="range"
                min="14"
                max="24"
                value={fontSize()}
                onInput={(e) => setFontSize(parseInt(e.currentTarget.value))}
                class="w-16 h-1"
                style={{ 'accent-color': theme().text }}
              />
              <span class="text-sm font-bold" style={{ color: theme().muted }}>A</span>
            </div>

            <button
              onClick={() => setIsDark(d => !d)}
              class="px-2 py-1 text-xs rounded border transition-colors"
              style={{ color: theme().text, 'border-color': theme().muted + '55' }}
            >
              {isDark() ? '☀️ Claro' : '🌙 Oscuro'}
            </button>
          </div>
        </div>

        {/* Content */}
        <article
          class="max-w-[680px] mx-auto px-5 py-8"
          style={{
            'font-size': `${fontSize()}px`,
            'line-height': '1.8',
            color: theme().text,
          }}
        >
          <h1 class="text-2xl font-bold mb-6 leading-tight" style={{ 'font-family': 'var(--font-display)' }}>
            {props.title}
          </h1>
          <p class="text-sm mb-6" style={{ color: theme().muted }}>{readingTime()}</p>
          <div innerHTML={props.body || props.summary} />
        </article>
      </div>
    </Show>
  );
}
