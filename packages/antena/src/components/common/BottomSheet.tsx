/** @jsxImportSource solid-js */
import { Show, createSignal, onMount, onCleanup, createEffect } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useHaptic } from '../../lib/haptic';
import { trapFocus } from '../../lib/focus-trap';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: any;
  title?: string;
  height?: 'auto' | 'half' | 'full';
}

const DRAG_VELOCITY_THRESHOLD = 0.4;
const DRAG_DISTANCE_THRESHOLD = 80;

export default function BottomSheet(props: BottomSheetProps) {
  const haptic = useHaptic();
  const [dragY, setDragY] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);

  let dragStartY = 0;
  let dragStartTime = 0;
  let lastY = 0;
  let lastT = 0;
  let velocityY = 0;
  let sheetRef: HTMLDivElement | undefined;

  const lockBody = (lock: boolean) => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = lock ? 'hidden' : '';
  };

  createEffect(() => {
    lockBody(props.open);
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && props.open) props.onClose();
  };

  onMount(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', onKey);
    }
  });

  onCleanup(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKey);
    }
    lockBody(false);
  });

  let triggerEl: HTMLElement | null = null;
  let trap: ReturnType<typeof trapFocus> | null = null;
  createEffect(() => {
    if (!sheetRef) return;
    if (props.open) {
      if (!trap) {
        triggerEl = (document.activeElement as HTMLElement | null) ?? null;
        trap = trapFocus(sheetRef, triggerEl ?? undefined);
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

  const onTouchStart = (e: TouchEvent) => {
    if (!sheetRef) return;
    const t = e.touches[0];
    dragStartY = t.clientY;
    lastY = t.clientY;
    dragStartTime = performance.now();
    lastT = dragStartTime;
    velocityY = 0;
    setDragging(true);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!dragging()) return;
    const t = e.touches[0];
    const dy = t.clientY - dragStartY;
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    velocityY = (t.clientY - lastY) / dt;
    lastY = t.clientY;
    lastT = now;
    setDragY(Math.max(0, dy));
  };

  const onTouchEnd = () => {
    if (!dragging()) return;
    setDragging(false);
    const shouldDismiss =
      dragY() > DRAG_DISTANCE_THRESHOLD || velocityY > DRAG_VELOCITY_THRESHOLD;
    if (shouldDismiss) {
      haptic.vibrate('tap');
      props.onClose();
    }
    setDragY(0);
  };

  const onMouseDown = (e: MouseEvent) => {
    if (!sheetRef) return;
    dragStartY = e.clientY;
    lastY = e.clientY;
    dragStartTime = performance.now();
    lastT = dragStartTime;
    velocityY = 0;
    setDragging(true);
    e.preventDefault();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging()) return;
    const dy = e.clientY - dragStartY;
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    velocityY = (e.clientY - lastY) / dt;
    lastY = e.clientY;
    lastT = now;
    setDragY(Math.max(0, dy));
  };

  const onMouseUp = () => {
    if (!dragging()) return;
    onTouchEnd();
  };

  if (typeof window !== 'undefined') {
    onMount(() => {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
    onCleanup(() => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    });
  }

  const heightClass = () => {
    switch (props.height) {
      case 'full': return 'h-[90vh]';
      case 'half': return 'h-[50vh]';
      default: return 'max-h-[85vh]';
    }
  };

  const sheetTransform = () => {
    if (!dragging()) return 'translateY(0)';
    return `translateY(${dragY()}px)`;
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-[70] flex items-end justify-center"
          style={{
            background: 'rgba(0,0,0,0.45)',
            'backdrop-filter': 'blur(2px)',
            animation: 'fadeIn 200ms ease-out',
          }}
          onClick={() => props.onClose()}
          role="presentation"
        >
          <div
            ref={sheetRef}
            class={`w-full max-w-md ${heightClass()} rounded-t-2xl border border-border-base overflow-hidden flex flex-col`}
            style={{
              background: 'var(--bg-elevated)',
              transform: sheetTransform(),
              transition: dragging() ? 'none' : 'transform 200ms ease-out',
              'padding-bottom': 'env(safe-area-inset-bottom, 0px)',
              'touch-action': 'none',
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={props.title || 'Menu'}
          >
            <div
              class="px-5 pt-3 pb-2 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onMouseDown={onMouseDown}
            >
              <div class="w-10 h-1 rounded-full" style={{ background: 'var(--border-strong)' }} />
            </div>
            <Show when={props.title}>
              <div class="px-5 pb-2">
                <h2 class="text-base font-semibold text-text-primary">{props.title}</h2>
              </div>
            </Show>
            <div class="flex-1 overflow-y-auto">
              {props.children}
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
