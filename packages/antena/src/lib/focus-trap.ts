/**
 * Focus trap — keep Tab/Shift+Tab inside a container while a modal
 * or overlay is open. Returns focus to the trigger element on
 * deactivate. Implements the WAI-ARIA Authoring Practices pattern
 * for modal dialogs (https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).
 */

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
].join(",");

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.hasAttribute("tabindex") && el.tabIndex < 0) return false;
    return true;
  });
}

export type FocusTrap = {
  activate: () => void;
  deactivate: () => void;
};

export function trapFocus(container: HTMLElement, returnFocusTo?: HTMLElement | null): FocusTrap {
  let active = false;
  let previouslyFocused: HTMLElement | null = null;

  function onKeyDown(e: KeyboardEvent) {
    if (!active) return;
    if (e.key !== "Tab") return;
    const focusable = getFocusable(container);
    if (focusable.length === 0) {
      e.preventDefault();
      container.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (current === first || !container.contains(current)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (current === last || !container.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function activate() {
    if (active) return;
    active = true;
    previouslyFocused = (document.activeElement as HTMLElement | null) ?? returnFocusTo ?? null;
    const focusable = getFocusable(container);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      if (container.tabIndex < 0) container.tabIndex = -1;
      container.focus();
    }
    document.addEventListener("keydown", onKeyDown, true);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    document.removeEventListener("keydown", onKeyDown, true);
    const target = returnFocusTo ?? previouslyFocused;
    if (target && typeof target.focus === "function") {
      target.focus();
    }
  }

  return { activate, deactivate };
}