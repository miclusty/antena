/** @jsxImportSource solid-js */
import { Show } from 'solid-js';
import { useHaptic } from '../../lib/haptic';
import { toast } from '../Toast';
import { isSupported as speechSupported, isSpeaking, stop as stopSpeech } from '../../lib/speech';

interface ArticleBottomBarProps {
  sourceUrl?: string;
  isBookmarked?: boolean;
  onBookmark?: () => void;
  onShare?: () => void;
  onReadingMode?: () => void;
  onListen?: () => void;
  isSpeaking?: boolean;
  articleUrl?: string;
}

export default function ArticleBottomBar(props: ArticleBottomBarProps) {
  const haptic = useHaptic();
  const canSpeak = speechSupported();

  return (
    <div
      class="fixed bottom-0 left-0 right-0 z-40 border-t lg:hidden"
      style={{
        background: 'var(--bg-elevated)',
        'border-color': 'var(--border-base)',
        'padding-bottom': 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div class="flex items-center justify-between px-4 py-3">
        <a
          href={props.sourceUrl || '#'}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => haptic.vibrate('tap')}
          class="flex items-center gap-1.5 text-xs font-medium"
          style={{ color: 'var(--accent)' }}
        >
          <span
            class="material-symbols-rounded text-base leading-none"
            style={{ 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }}
          >
            open_in_new
          </span>
          Leer en fuente
        </a>

        <div class="flex items-center gap-1">
          <button
            onClick={() => {
              haptic.vibrate('tap');
              navigator.clipboard.writeText(props.articleUrl || (typeof window !== 'undefined' ? window.location.href : ''));
              toast('Enlace copiado', 'info');
            }}
            class="p-2 rounded-full hover:bg-bg-hover transition-colors"
            title="Copiar enlace"
            aria-label="Copiar enlace"
          >
            <span
              class="material-symbols-rounded text-xl leading-none"
              style={{ color: 'var(--text-tertiary)', 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }}
              aria-hidden="true"
            >
              link
            </span>
          </button>

          <Show when={canSpeak}>
            <button
              onClick={() => {
                haptic.vibrate('tap');
                if (props.isSpeaking) {
                  stopSpeech();
                  // Parent's onListen is called to flip the
                  // isSpeaking signal back to false.
                  props.onListen?.();
                } else {
                  props.onListen?.();
                }
              }}
              class="p-2 rounded-full hover:bg-bg-hover transition-colors"
              title={props.isSpeaking ? 'Detener lectura' : 'Escuchar'}
              aria-label={props.isSpeaking ? 'Detener lectura' : 'Escuchar'}
              aria-pressed={!!props.isSpeaking}
            >
              <span
                class="material-symbols-rounded text-xl leading-none"
                style={{
                  color: props.isSpeaking ? 'var(--accent)' : 'var(--text-tertiary)',
                  'font-variation-settings': props.isSpeaking
                    ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20"
                    : "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20",
                }}
                aria-hidden="true"
              >
                {props.isSpeaking ? 'stop' : 'volume_up'}
              </span>
            </button>
          </Show>

          <button
            onClick={() => { haptic.vibrate('tap'); props.onBookmark?.(); }}
            class="p-2 rounded-full hover:bg-bg-hover transition-colors"
            title={props.isBookmarked ? 'Quitar de guardados' : 'Guardar'}
            aria-label={props.isBookmarked ? 'Quitar de guardados' : 'Guardar'}
          >
            <span
              class="material-symbols-rounded text-xl leading-none"
              style={{
                color: props.isBookmarked ? 'var(--accent)' : 'var(--text-tertiary)',
                'font-variation-settings': props.isBookmarked
                  ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20"
                  : "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20",
              }}
              aria-hidden="true"
            >
              bookmark
            </span>
          </button>

          <button
            onClick={() => { haptic.vibrate('tap'); props.onShare?.(); }}
            class="p-2 rounded-full hover:bg-bg-hover transition-colors"
            title="Compartir"
            aria-label="Compartir"
          >
            <span
              class="material-symbols-rounded text-xl leading-none"
              style={{ color: 'var(--text-tertiary)', 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }}
              aria-hidden="true"
            >
              share
            </span>
          </button>

          <button
            onClick={() => { haptic.vibrate('tap'); props.onReadingMode?.(); }}
            class="p-2 rounded-full hover:bg-bg-hover transition-colors"
            title="Modo lectura"
            aria-label="Modo lectura"
          >
            <span
              class="material-symbols-rounded text-xl leading-none"
              style={{ color: 'var(--text-tertiary)', 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }}
              aria-hidden="true"
            >
              menu_book
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
