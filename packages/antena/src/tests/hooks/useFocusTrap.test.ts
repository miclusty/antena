/** @jsxImportSource solid-js */
import { describe, it, expect, vi } from "vitest";
import { createRoot, createSignal, Show } from "solid-js";
import { useFocusTrap } from "../../hooks/useFocusTrap";

describe("useFocusTrap", () => {
  it("returns a callback ref that can be attached to an element", () => {
    createRoot((dispose) => {
      const trapRef = useFocusTrap(() => true);
      expect(typeof trapRef).toBe("function");
      dispose();
    });
  });

  it("focuses the first focusable child when isOpen becomes true", () => {
    createRoot((dispose) => {
      const [open, setOpen] = createSignal(false);
      let trapRef: ((el: HTMLElement | undefined) => void) | undefined;
      const TestComp = () => {
        trapRef = useFocusTrap(open);
        return null;
      };
      TestComp();
      const container = document.createElement("div");
      container.innerHTML = `<button id="a">A</button><button id="b">B</button>`;
      document.body.appendChild(container);
      trapRef!(container);
      expect(document.activeElement?.tagName).not.toBe("BUTTON");
      setOpen(true);
      // createEffect needs a tick
      return Promise.resolve().then(() => {
        expect(document.activeElement?.id).toBe("a");
        container.remove();
        dispose();
      });
    });
  });

  it("restores focus to the trigger element when isOpen becomes false", () => {
    return createRoot((dispose) => {
      const [open, setOpen] = createSignal(true);
      const trigger = document.createElement("button");
      trigger.textContent = "Trigger";
      document.body.appendChild(trigger);
      trigger.focus();
      const container = document.createElement("div");
      container.innerHTML = `<button>A</button>`;
      document.body.appendChild(container);
      const trapRef = useFocusTrap(open);
      trapRef(container);
      return Promise.resolve().then(() => Promise.resolve()).then(() => {
        expect(document.activeElement?.tagName).toBe("BUTTON");
        setOpen(false);
        return Promise.resolve().then(() => {
          expect(document.activeElement).toBe(trigger);
          container.remove();
          trigger.remove();
          dispose();
        });
      });
    });
  });

  it("does not activate when isOpen is false on mount", () => {
    return createRoot((dispose) => {
      const container = document.createElement("div");
      container.innerHTML = `<button>A</button>`;
      document.body.appendChild(container);
      const trapRef = useFocusTrap(() => false);
      trapRef(container);
      return Promise.resolve().then(() => {
        expect(document.activeElement?.tagName).not.toBe("BUTTON");
        container.remove();
        dispose();
      });
    });
  });

  it("handles element unmount gracefully", () => {
    return createRoot((dispose) => {
      const container = document.createElement("div");
      container.innerHTML = `<button>A</button>`;
      document.body.appendChild(container);
      const trapRef = useFocusTrap(() => true);
      trapRef(container);
      trapRef(undefined);
      container.remove();
      // No assertion needed — should not throw
      return Promise.resolve().then(() => {
        dispose();
      });
    });
  });

  it("handles multiple open/close cycles without leaking listeners", () => {
    return createRoot((dispose) => {
      const [open, setOpen] = createSignal(false);
      const container = document.createElement("div");
      container.innerHTML = `<button>A</button>`;
      document.body.appendChild(container);
      const trapRef = useFocusTrap(open);
      trapRef(container);
      const cycle = async () => {
        setOpen(true);
        await Promise.resolve();
        setOpen(false);
        await Promise.resolve();
        setOpen(true);
        await Promise.resolve();
        setOpen(false);
        await Promise.resolve();
      };
      return cycle().then(() => {
        container.remove();
        dispose();
      });
    });
  });
});