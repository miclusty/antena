import { For } from 'solid-js';
import { Portal } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import MaterialIcon from './common/MaterialIcon';

type ToastVariant = 'success' | 'warning' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  dismissible: boolean;
  durationMs: number;
}

const [toasts, setToasts] = createStore<ToastItem[]>([]);
let nextId = 0;

export function toast(message: string, variant: ToastVariant = 'info') {
  const id = nextId++;
  const isDismissible = variant === 'warning' || variant === 'error' || variant === 'info';
  const duration = variant === 'warning' || variant === 'error' ? 5000 : 2500;
  setToasts([...toasts, { id, message, variant, dismissible: isDismissible, durationMs: duration }]);
  setTimeout(() => dismissToast(id), duration);
}

function dismissToast(id: number) {
  setToasts(toasts.filter(t => t.id !== id));
}

const variantBg: Record<ToastVariant, string> = {
  success: '#10B981',
  warning: 'rgba(245, 166, 35, 0.15)',
  error: '#EF4444',
  info: 'var(--bg-elevated)',
};

const variantBorder: Record<ToastVariant, string> = {
  success: '#10B981',
  warning: 'var(--accent)',
  error: '#EF4444',
  info: 'var(--border-base)',
};

const variantColor: Record<ToastVariant, string> = {
  success: '#fff',
  warning: 'var(--text-primary)',
  error: '#fff',
  info: 'var(--text-primary)',
};

const variantIcon: Record<ToastVariant, string> = {
  success: 'check_circle',
  warning: 'wifi_off',
  error: 'error',
  info: 'info',
};

export default function ToastContainer() {
  return (
    <Portal>
      <div
        class="fixed bottom-20 left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center pointer-events-none"
        style={{ 'padding-bottom': 'env(safe-area-inset-bottom, 0px)', 'z-index': 'var(--z-toast)' }}
      >
        <For each={toasts}>
          {(t) => (
            <div
              role={t.variant === 'error' || t.variant === 'warning' ? 'alert' : 'status'}
              class="flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-full text-sm font-medium shadow-lg animate-slide-up pointer-events-auto max-w-[min(420px,calc(100vw-32px))]"
              style={{
                background: variantBg[t.variant],
                color: variantColor[t.variant],
                border: `1px solid ${variantBorder[t.variant]}`,
              }}
            >
              <MaterialIcon name={variantIcon[t.variant]} size="base" class="text-[18px] shrink-0" style={{ 'font-variation-settings': "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" }} aria-hidden="true" />
              <span class="flex-1 leading-snug">{t.message}</span>
              {t.dismissible && (
                <button
                  onClick={() => dismissToast(t.id)}
                  aria-label="Cerrar aviso"
                  class="shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] rounded-full hover:bg-black/10 active:scale-90 transition-all"
                >
                  <MaterialIcon name="close" size="base" class="text-[16px]" style={{ }} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </For>
      </div>
    </Portal>
  );
}
