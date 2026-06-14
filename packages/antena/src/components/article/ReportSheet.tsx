/** @jsxImportSource solid-js */
import { Show, For, createSignal } from "solid-js";
import type { ReportReason } from "../../lib/api";

const REASONS: { id: ReportReason; label: string; icon: string }[] = [
  { id: "incorrect", label: "Información incorrecta", icon: "cancel" },
  { id: "clickbait", label: "Es clickbait / engañoso", icon: "campaign" },
  { id: "duplicate", label: "Está duplicada", icon: "content_copy" },
  { id: "spam", label: "Spam o baja calidad", icon: "block" },
  { id: "other", label: "Otro motivo", icon: "more_horiz" },
];

interface ReportSheetProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: ReportReason, note?: string) => void;
}

export default function ReportSheet(props: ReportSheetProps) {
  const [reason, setReason] = createSignal<ReportReason | null>(null);
  const [note, setNote] = createSignal("");

  const close = () => {
    setReason(null);
    setNote("");
    props.onClose();
  };

  const submit = () => {
    const r = reason();
    if (!r) return;
    const trimmedNote = note().trim();
    props.onSubmit(r, trimmedNote || undefined);
    setReason(null);
    setNote("");
  };

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-[100] flex items-end justify-center"
        style={{ background: "rgba(0,0,0,0.45)", "backdrop-filter": "blur(2px)" }}
        onClick={close}
        role="dialog"
        aria-modal="true"
        aria-label="Reportar contenido"
      >
        <div
          class="w-full max-w-md rounded-t-2xl border border-border-base overflow-hidden"
          style={{ background: "var(--bg-elevated)", "padding-bottom": "env(safe-area-inset-bottom, 0px)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div class="flex flex-col">
            <div class="px-5 pt-3 pb-2 flex items-center justify-center">
              <div class="w-10 h-1 rounded-full" style={{ background: "var(--border-base)" }} />
            </div>
            <div class="px-5 pb-2">
              <h2 class="text-lg font-bold" style={{ "font-family": "var(--font-display)", color: "var(--text-primary)" }}>
                Reportar contenido
              </h2>
              <p class="text-[12px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                Ayudanos a mantener Antena confiable.
              </p>
            </div>
            <div class="px-2">
              <For each={REASONS}>
                {(r) => (
                  <button
                    type="button"
                    onClick={() => setReason(r.id)}
                    class="w-full flex items-center gap-3 px-3 min-h-[44px] py-2 rounded-lg hover:bg-bg-hover active:bg-bg-hover transition-colors text-left"
                    style={{
                      background: reason() === r.id ? "var(--accent-muted)" : "transparent",
                    }}
                  >
                    <span
                      class="material-symbols-rounded text-xl leading-none"
                      style={{ color: "var(--text-secondary)", "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }}
                      aria-hidden="true"
                    >
                      {r.icon}
                    </span>
                    <span class="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {r.label}
                    </span>
                    <Show when={reason() === r.id}>
                      <span
                        class="ml-auto material-symbols-rounded text-lg leading-none"
                        style={{ color: "var(--accent)", "font-variation-settings": "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20" }}
                        aria-hidden="true"
                      >
                        check_circle
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
            <Show when={reason() === "other" || reason() !== null}>
              <div class="px-5 pt-2">
                <textarea
                  value={note()}
                  onInput={(e) => setNote(e.currentTarget.value)}
                  placeholder={reason() === "other" ? "Contanos más (opcional)" : "Nota (opcional)"}
                  rows={2}
                  maxLength={500}
                  class="w-full text-sm rounded-lg p-2 resize-none outline-none"
                  style={{ background: "var(--bg-base)", color: "var(--text-primary)", border: "1px solid var(--border-base)" }}
                />
                <p class="text-[10px] mt-1 text-right" style={{ color: "var(--text-tertiary)" }}>
                  {note().length} / 500
                </p>
              </div>
            </Show>
            <div class="px-5 py-3 flex gap-2">
              <button
                type="button"
                onClick={close}
                class="flex-1 min-h-[44px] rounded-full text-sm font-semibold"
                style={{ background: "var(--bg-base)", color: "var(--text-secondary)", border: "1px solid var(--border-base)" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!reason()}
                class="flex-1 min-h-[44px] rounded-full text-sm font-semibold transition-opacity disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
