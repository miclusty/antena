/** @jsxImportSource solid-js */
import { createSignal, onMount, Show } from 'solid-js';
import { useHaptic } from '../lib/haptic';
import MaterialIcon from './common/MaterialIcon';

/**
 * PWA install prompt. Listens for the beforeinstallprompt
 * event (Android/Chrome) and shows a banner. iOS doesn't
 * fire the event, so we detect Safari + standalone and
 * show a "Add to Home Screen" instructions modal.
 */
export default function PwaInstallPrompt() {
  const haptic = useHaptic();
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
      setShowButton(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  });

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
      <button
        type="button"
        onClick={install}
        class="fixed bottom-24 right-4 z-30 flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold shadow-lg"
        style={{ background: 'var(--accent)', color: 'var(--bg-base)' }}
        aria-label="Instalar Antena como app"
      >
        <MaterialIcon name="install_mobile" size="base" class="text-base" style={{ }} aria-hidden="true" />
        Instalar app
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          class="ml-1 -mr-2 p-1 rounded-full"
          style={{ color: 'var(--bg-base)', opacity: 0.7 }}
          aria-label="Cerrar"
        >
          <MaterialIcon name="close" size="sm" class="text-sm" style={{ }} aria-hidden="true" />
        </button>
      </button>

      <Show when={iosVisible()}>
        <div
          class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setIosVisible(false)}
        >
          <div
            class="w-full max-w-sm rounded-2xl p-6"
            style={{ background: 'var(--bg-elevated)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 class="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              Instalá Antena
            </h3>
            <p class="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Tocá               <MaterialIcon name="ios_share" size="sm" class="text-sm inline" style={{ 'vertical-align': 'middle' }} aria-hidden="true" /> y después <strong>"Agregar a pantalla de inicio"</strong> para tener Antena como app.
            </p>
            <button
              type="button"
              onClick={() => setIosVisible(false)}
              class="w-full py-2 rounded-lg text-sm font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--bg-base)' }}
            >
              Entendido
            </button>
          </div>
        </div>
      </Show>
    </Show>
  );
}
