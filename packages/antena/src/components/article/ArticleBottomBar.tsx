/** @jsxImportSource solid-js */
import { Show } from 'solid-js';
import { useHaptic } from '../../lib/haptic';
import { toast } from '../Toast';
import { isSupported as speechSupported, isSpeaking, stop as stopSpeech } from '../../lib/speech';
import MaterialIcon from '../common/MaterialIcon';

interface ArticleBottomBarProps {
  sourceUrl?: string;
  isBookmarked?: boolean;
  onBookmark?: () => void;
  onShare?: () => void;
  onReadingMode?: () => void;
  onListen?: () => void;
  isSpeaking?: boolean;
  articleUrl?: string;
  isReadLater?: boolean;
  onReadLater?: () => void;
}

export default function ArticleBottomBar(props: ArticleBottomBarProps) {
  const haptic = useHaptic();
  const canSpeak = speechSupported();

  return (
    <div
      class="fixed bottom-0 left-0 right-0 border-t lg:hidden"
      style={{
        background: 'var(--bg-elevated)',
        'border-color': 'var(--border-base)',
        'padding-bottom': 'env(safe-area-inset-bottom, 0px)',
        'z-index': 'var(--z-floating)',
      }}
    >
      <div class="flex items-center justify-between gap-2 px-4 py-3">
        <a
          href={props.sourceUrl || '#'}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => haptic.vibrate('tap')}
          class="flex items-center gap-1.5 text-xs font-medium min-h-[44px] min-w-[44px]"
          style={{ color: 'var(--accent)' }}
        >
          <MaterialIcon name="open_in_new" size="base" class="text-base " style={{ }} />
          Leer en fuente
        </a>

        <div class="flex items-center gap-1">
          <button
            onClick={() => {
              haptic.vibrate('tap');
              navigator.clipboard.writeText(props.articleUrl || (typeof window !== 'undefined' ? window.location.href : ''));
              toast('Enlace copiado', 'info');
            }}
            class="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
            title="Copiar enlace"
            aria-label="Copiar enlace"
          >
            <MaterialIcon name="link" size="xl" class="text-xl " style={{ color: 'var(--text-tertiary)' }} aria-hidden="true" />
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
              class="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
              title={props.isSpeaking ? 'Detener lectura' : 'Escuchar'}
              aria-label={props.isSpeaking ? 'Detener lectura' : 'Escuchar'}
              aria-pressed={!!props.isSpeaking}
            >
              <MaterialIcon name={props.isSpeaking ? 'stop' : 'volume_up'} size="xl" class="text-xl " style={{ color: props.isSpeaking ? 'var(--accent)' : 'var(--text-tertiary)', 'font-variation-settings': props.isSpeaking ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20" : "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20", }} aria-hidden="true" />
            </button>
          </Show>

          <button
            onClick={() => { haptic.vibrate('tap'); props.onBookmark?.(); }}
            class="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
            title={props.isBookmarked ? 'Quitar de guardados' : 'Guardar'}
            aria-label={props.isBookmarked ? 'Quitar de guardados' : 'Guardar'}
          >
            <MaterialIcon name="bookmark" size="xl" class="text-xl " style={{ color: props.isBookmarked ? 'var(--accent)' : 'var(--text-tertiary)', 'font-variation-settings': props.isBookmarked ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20" : "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20", }} aria-hidden="true" />
          </button>

          <button
            onClick={() => { haptic.vibrate('tap'); props.onReadLater?.(); }}
            class="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
            title={props.isReadLater ? 'Quitar de "Leer después"' : 'Leer después'}
            aria-label={props.isReadLater ? 'Quitar de "Leer después"' : 'Leer después'}
            aria-pressed={!!props.isReadLater}
          >
            <MaterialIcon name="schedule" size="xl" class="text-xl " style={{ color: props.isReadLater ? 'var(--accent)' : 'var(--text-tertiary)', 'font-variation-settings': props.isReadLater ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20" : "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20", }} aria-hidden="true" />
          </button>

          <button
            onClick={() => { haptic.vibrate('tap'); props.onShare?.(); }}
            class="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
            title="Compartir"
            aria-label="Compartir"
          >
            <MaterialIcon name="share" size="xl" class="text-xl " style={{ color: 'var(--text-tertiary)' }} aria-hidden="true" />
          </button>

          <button
            onClick={() => { haptic.vibrate('tap'); props.onReadingMode?.(); }}
            class="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-bg-hover transition-colors"
            title="Modo lectura"
            aria-label="Modo lectura"
          >
            <MaterialIcon name="menu_book" size="xl" class="text-xl " style={{ color: 'var(--text-tertiary)' }} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
