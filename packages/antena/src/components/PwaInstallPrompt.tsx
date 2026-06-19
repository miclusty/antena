/** @jsxImportSource solid-js */
import { createSignal, onMount, onCleanup, Show, createEffect, on } from 'solid-js';
import { useHaptic } from '../lib/haptic';
import { trapFocus } from '../lib/focus-trap';
import MaterialIcon from './common/MaterialIcon';

/**
 * PWA install prompt.
 *
 * Positioning: lives at `bottom-24 left-4` so it sits to the LEFT of
 * the floating radio play bar (which is on the right at the same
 * vertical position). On phones with a small safe-area-inset-bottom
 * (older iPhones, Android) they would have visually competed; moving
 * to the left makes them coexist.
 *
 * iOS install: iOS does NOT fire `beforeinstallprompt`, so users
 * have to do it manually (Safari → Share → Add to Home Screen). The
 * modal gives them a step-by-step with a "Solo en Safari" warning
 * because Chrome on iOS just opens the App Store prompt instead.
 *
 * Auto-dismiss: if the user ignores the floating button for 30s, it
 * auto-hides. They can still install via the instructions modal that
 * lives behind the install click (which they don't get to if they
 * ignored the button, so they probably want to look at the article
 * uninterrupted). The auto-dismiss is non-sticky — reloading or
 * coming back tomorrow brings the button back if not installed.
 */
const AUTO_DISMISS_MS = 30_000;

export default function PwaInstallPrompt() {
  const haptic = useHaptic();
  let iosRef: HTMLElement | undefined;
  let triggerEl: HTMLElement | null = null;
  let trap: ReturnType<typeof trapFocus> | null = null;
  createEffect(() => {
    if (!iosRef) return;
    if (iosVisible()) {
      if (!trap) {
        triggerEl = (document.activeElement as HTMLElement | null) ?? null;
        trap = trapFocus(iosRef, triggerEl ?? undefined);
      }
      trap.activate();
    } else if (trap) {
      trap.deactivate();
      trap = null;
      const t = triggerEl;
      if (t && typeof t.focus === 'function') t.focus();
      triggerEl = null;
    }
  });
  const [deferredPrompt, setDeferredPrompt] = createSignal<any>(null);
  const [iosVisible, setIosVisible] = createSignal(false);
  const [showButton, setShowButton] = createSignal(false);
  const [installed, setInstalled] = createSignal(false);

  onMount(() => {
    if (typeof window === 'undefined') return;
    // Already installed as standalone? Hide.
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true);
      return;
    }
    if (localStorage.getItem('antena-pwa-dismissed')) return;

    // Android/Chrome path
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowButton(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // iOS path (Safari fires no event, we detect)
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = (navigator as { standalone?: boolean }).standalone === true;
    if (isIos && !isStandalone) {
      requestAnimationFrame(() => setShowButton(true));
    }

    onCleanup(() => window.removeEventListener('beforeinstallprompt', handler));
  });

  // Auto-dismiss: if the user ignores the button for AUTO_DISMISS_MS,
  // hide it. Don't persist the dismissal — they can come back later.
  createEffect(
    on(showButton, (visible) => {
      if (!visible) return;
      const id = window.setTimeout(() => setShowButton(false), AUTO_DISMISS_MS);
      onCleanup(() => window.clearTimeout(id));
    }),
  );

  const dismiss = () => {
    localStorage.setItem('antena-pwa-dismissed', '1');
    setShowButton(false);
  };

  const install = async () => {
    haptic.vibrate('tap');
    if (deferredPrompt()) {
      deferredPrompt().prompt();
      const result = await deferredPrompt().userChoice;
      if (result.outcome === 'accepted') setInstalled(true);
      setShowButton(false);
      setDeferredPrompt(null);
    } else {
      setIosVisible(true);
    }
  };

  return (
    <Show when={showButton() && !installed()}>
      {/* Install button on the LEFT so it doesn't fight the radio
          on the right. bottom-24 keeps it above BottomNav (64px +
          safe area) and above the radio bar (which is at the same
          level but on the right). z-30 keeps it under the radio
          when both are visible (radio is z-40). */}
      <div class="fixed bottom-24 left-4 z-30 flex items-stretch shadow-lg rounded-full overflow-hidden"
           style={{ background: 'var(--accent)' }}>
        <button
          type="button"
          onClick={install}
          class="flex items-center gap-2 pl-3 pr-4 py-2.5 text-sm font-semibold"
          style={{ color: 'var(--accent-fg)' }}
          aria-label="Instalar Antena como app"
        >
          <MaterialIcon name="install_mobile" size="base" class="text-base" aria-hidden="true" />
          Instalar app
        </button>
        {/* Close button — explicitly its own background so it's
            visible. Use the <span role="button"> pattern (not a
            nested <button> — invalid HTML, the parser auto-closes
            the outer button and breaks Solid's template traversal). */}
        <span
          role="button"
          tabindex="0"
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              dismiss();
            }
          }}
          class="flex items-center justify-center w-9 h-full cursor-pointer border-l"
          style={{ color: 'var(--accent-fg)', 'background-color': 'rgba(0,0,0,0.18)', 'border-color': 'rgba(255,255,255,0.18)' }}
          aria-label="Cerrar recordatorio"
        >
          <MaterialIcon name="close" size="sm" class="text-base" aria-hidden="true" />
        </span>
      </div>

      <Show when={iosVisible()}>
        <div
          ref={(el) => { if (el) iosRef = el; }}
          class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setIosVisible(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-ios-title"
        >
          <div
            class="w-full max-w-sm rounded-2xl p-6 relative"
            style={{ background: 'var(--bg-elevated)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Explicit close X at top-right so users always know
                how to dismiss the modal. */}
            <span
              role="button"
              tabindex="0"
              onClick={() => setIosVisible(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setIosVisible(false);
                }
              }}
              class="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full cursor-pointer"
              style={{ color: 'var(--text-secondary)', 'background-color': 'var(--bg-hover)' }}
              aria-label="Cerrar"
            >
              <MaterialIcon name="close" size="sm" class="text-base" aria-hidden="true" />
            </span>

            <h3
              id="pwa-ios-title"
              class="text-lg font-bold mb-3 pr-10"
              style={{ color: 'var(--text-primary)' }}
            >
              Instalá Antena en tu iPhone
            </h3>
            <p
              class="text-sm mb-4 leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              <strong style={{ color: 'var(--text-primary)' }}>Importante:</strong> solo funciona en Safari. Si usás Chrome o el modo Incógnito, no va a aparecer la opción.
            </p>

            <ol class="space-y-3 mb-5" style={{ color: 'var(--text-primary)' }}>
              <li class="flex items-start gap-3">
                <span
                  class="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                  aria-hidden="true"
                >1</span>
                <span class="text-sm pt-1">
                  Tocá el botón <MaterialIcon name="ios_share" size="sm" class="text-base inline" style={{ 'vertical-align': '-2px' }} aria-hidden="true" /> <strong>Compartir</strong> abajo en la barra de Safari.
                </span>
              </li>
              <li class="flex items-start gap-3">
                <span
                  class="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                  aria-hidden="true"
                >2</span>
                <span class="text-sm pt-1">
                  Desplazate hacia abajo y tocá <strong>"Agregar a pantalla de inicio"</strong>.
                </span>
              </li>
              <li class="flex items-start gap-3">
                <span
                  class="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                  aria-hidden="true"
                >3</span>
                <span class="text-sm pt-1">
                  Tocá <strong>Agregar</strong> arriba a la derecha. Listo — Antena queda en tu home.
                </span>
              </li>
            </ol>

            <button
              type="button"
              onClick={() => setIosVisible(false)}
              class="w-full py-2.5 rounded-lg text-sm font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              Entendido
            </button>
          </div>
        </div>
      </Show>
    </Show>
  );
}