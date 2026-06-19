/** @jsxImportSource solid-js */
import { describe, it, expect, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { trapFocus } from "../lib/focus-trap";

describe("trapFocus", () => {
  it("returns an activate() / deactivate() pair", () => {
    createRoot((dispose) => {
      const ref = document.createElement("div");
      const t = trapFocus(ref);
      expect(typeof t.activate).toBe("function");
      expect(typeof t.deactivate).toBe("function");
      t.deactivate();
      dispose();
    });
  });

  it("focuses the first focusable element on activate", () => {
    createRoot((dispose) => {
      const container = document.createElement("div");
      container.innerHTML = `
        <button>First</button>
        <button>Second</button>
        <button>Third</button>
      `;
      document.body.appendChild(container);
      const t = trapFocus(container);
      t.activate();
      expect(document.activeElement).toBe(container.querySelectorAll("button")[0]);
      t.deactivate();
      container.remove();
      dispose();
    });
  });

  it("focuses the container itself if no focusable children", () => {
    createRoot((dispose) => {
      const container = document.createElement("div");
      container.tabIndex = -1;
      document.body.appendChild(container);
      const t = trapFocus(container);
      t.activate();
      expect(document.activeElement).toBe(container);
      t.deactivate();
      container.remove();
      dispose();
    });
  });

  it("wraps Tab from last focusable back to first", () => {
    createRoot((dispose) => {
      const container = document.createElement("div");
      container.innerHTML = `
        <button id="a">A</button>
        <button id="b">B</button>
      `;
      document.body.appendChild(container);
      const t = trapFocus(container);
      t.activate();
      const buttons = container.querySelectorAll("button");
      buttons[1]?.focus();
      // Simulate Tab on the last focusable
      const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      container.dispatchEvent(event);
      // The first button should now be focused (wrap-around)
      expect(document.activeElement).toBe(buttons[0]);
      t.deactivate();
      container.remove();
      dispose();
    });
  });

  it("wraps Shift+Tab from first focusable back to last", () => {
    createRoot((dispose) => {
      const container = document.createElement("div");
      container.innerHTML = `
        <button id="a">A</button>
        <button id="b">B</button>
      `;
      document.body.appendChild(container);
      const t = trapFocus(container);
      t.activate();
      const buttons = container.querySelectorAll("button");
      buttons[0]?.focus();
      const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
      container.dispatchEvent(event);
      expect(document.activeElement).toBe(buttons[1]);
      t.deactivate();
      container.remove();
      dispose();
    });
  });

  it("restores focus to the trigger element on deactivate", () => {
    createRoot((dispose) => {
      const trigger = document.createElement("button");
      trigger.textContent = "Trigger";
      document.body.appendChild(trigger);
      trigger.focus();
      const container = document.createElement("div");
      container.innerHTML = `<button>Inside</button>`;
      document.body.appendChild(container);
      const t = trapFocus(container, trigger);
      t.activate();
      expect(document.activeElement).toBe(container.querySelector("button"));
      t.deactivate();
      expect(document.activeElement).toBe(trigger);
      container.remove();
      trigger.remove();
      dispose();
    });
  });

  it("does nothing on non-Tab keys", () => {
    createRoot((dispose) => {
      const container = document.createElement("div");
      container.innerHTML = `<button>Inside</button>`;
      document.body.appendChild(container);
      const t = trapFocus(container);
      t.activate();
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      const preventDefault = vi.spyOn(event, "preventDefault");
      container.dispatchEvent(event);
      expect(preventDefault).not.toHaveBeenCalled();
      t.deactivate();
      container.remove();
      dispose();
    });
  });
});