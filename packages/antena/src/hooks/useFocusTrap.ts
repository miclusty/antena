/** @jsxImportSource solid-js */
import { createEffect } from "solid-js";
import { trapFocus } from "../lib/focus-trap";

/**
 * useFocusTrap — bind a focus trap to a dialog/drawer/modal element
 * via a callback ref. Captures the trigger element on open (so focus
 * restores correctly on close) and handles the open/close cycle
 * internally.
 *
 * Usage:
 *   const trapRef = useFocusTrap(() => props.open);
 *   return <div ref={trapRef}>...</div>;
 */
export function useFocusTrap(isOpen: () => boolean): (el: HTMLElement | undefined) => void {
  let el: HTMLElement | undefined;
  let trap: ReturnType<typeof trapFocus> | null = null;
  let triggerEl: HTMLElement | null = null;

  createEffect(() => {
    if (!el) return;
    const open = isOpen();
    if (open) {
      if (!trap) {
        triggerEl = (document.activeElement as HTMLElement | null) ?? null;
        trap = trapFocus(el, triggerEl ?? undefined);
      }
      trap.activate();
    } else if (trap) {
      trap.deactivate();
      trap = null;
      const t = triggerEl;
      if (t && typeof t.focus === "function") t.focus();
      triggerEl = null;
    }
  });

  return (newEl) => {
    el = newEl;
  };
}