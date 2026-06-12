import { createSignal, onCleanup, onMount, Show } from "solid-js";

const AUTO_DISMISS_MS = 5000;
const SESSION_KEY = "antena-offline-toast-dismissed";

export default function ConnectionStatus() {
  const [online, setOnline] = createSignal(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [dismissed, setDismissed] = createSignal(false);
  const [visible, setVisible] = createSignal(false);
  let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

  const clearAutoDismiss = () => {
    if (autoDismissTimer) {
      clearTimeout(autoDismissTimer);
      autoDismissTimer = null;
    }
  };

  onMount(() => {
    const update = () => {
      const isOnline = navigator.onLine;
      setOnline(isOnline);
      if (isOnline) {
        setDismissed(false);
        setVisible(false);
        clearAutoDismiss();
        return;
      }
      setVisible(true);
      const alreadyAutoDismissed = sessionStorage.getItem(SESSION_KEY) === "1";
      if (!alreadyAutoDismissed) {
        sessionStorage.setItem(SESSION_KEY, "1");
        clearAutoDismiss();
        autoDismissTimer = setTimeout(() => {
          if (!navigator.onLine) setVisible(false);
        }, AUTO_DISMISS_MS);
      }
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    onCleanup(() => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      clearAutoDismiss();
    });
  });

  return (
    <Show when={!online() && !dismissed() && visible()}>
      <div
        class="fixed left-3 right-3 z-[60] flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium shadow-md"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 60px)",
          background: "rgba(245, 166, 35, 0.15)",
          "backdrop-filter": "blur(8px)",
          "-webkit-backdrop-filter": "blur(8px)",
          border: "1px solid var(--accent)",
          color: "var(--text-primary)",
        }}
        role="status"
        aria-live="polite"
      >
        <span
          class="material-symbols-rounded text-[18px] shrink-0"
          style={{ "font-variation-settings": "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" }}
          aria-hidden="true"
        >
          wifi_off
        </span>
        <span class="flex-1 leading-snug">Sin conexión — mostrando artículos guardados</span>
        <button
          onClick={() => {
            setDismissed(true);
            clearAutoDismiss();
          }}
          aria-label="Cerrar aviso de sin conexión"
          class="shrink-0 flex items-center justify-center w-7 h-7 rounded-full hover:bg-black/10 active:scale-90 transition-all"
        >
          <span
            class="material-symbols-rounded text-[16px]"
            style={{ "font-variation-settings": "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" }}
            aria-hidden="true"
          >
            close
          </span>
        </button>
      </div>
    </Show>
  );
}
