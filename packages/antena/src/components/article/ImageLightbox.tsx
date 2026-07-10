/** @jsxImportSource solid-js */
import { Show, onMount, onCleanup } from "solid-js";
import MaterialIcon from '../common/MaterialIcon';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface ImageLightboxProps {
  open: boolean;
  src: string;
  alt?: string;
  onClose: () => void;
}

/**
 * Fullscreen image lightbox. Single source + src. No
 * pinch-to-zoom (the browser's native pinch gesture works
 * once the image is on screen and not constrained by the
 * article column). Escape to close, click backdrop to close.
 */
export default function ImageLightbox(props: ImageLightboxProps) {
  const trapRef = useFocusTrap(() => props.open);

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.open) props.onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  });

  return (
    <Show when={props.open}>
      <div
        ref={trapRef}
        class="fixed inset-0 z-[200] flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.92)" }}
        onClick={props.onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Imagen ampliada"
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); props.onClose(); }}
          class="absolute top-4 right-4 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}
          aria-label="Cerrar"
        >
          <MaterialIcon name="close" size="xl" class="text-xl " style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }} aria-hidden="true" />
        </button>
        <img
          src={props.src}
          alt={props.alt ?? ""}
          class="max-w-full max-h-full object-contain rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </Show>
  );
}