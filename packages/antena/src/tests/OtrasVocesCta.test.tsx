import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, waitFor } from "@solidjs/testing-library";
import OtrasVocesCta from "../components/article/OtrasVocesCta";
import { createMockNews, mockNavigatorVibrate } from "./helpers";

afterEach(cleanup);

describe("OtrasVocesCta", () => {
  it("renders nothing when otherSources is empty", () => {
    mockNavigatorVibrate();
    const { container } = render(() => (
      <OtrasVocesCta otherSources={[]} currentId="a1" onSelect={() => {}} />
    ));
    expect(container.textContent?.trim()).toBe("");
  });

  it("does not show the floating CTA button until the sentinel is intersected", () => {
    mockNavigatorVibrate();
    const others = [createMockNews({ id: "x2", source: "Página 12" })];
    const { queryByLabelText } = render(() => (
      <OtrasVocesCta otherSources={others} currentId="a1" onSelect={() => {}} />
    ));
    // No fake IO firing => passed() remains false
    expect(queryByLabelText(/voces más sobre esta historia/i)).toBeNull();
  });

  it("shows the CTA when the IntersectionObserver reports the sentinel visible", async () => {
    mockNavigatorVibrate();
    const others = [
      createMockNews({ id: "x2", source: "Página 12" }),
      createMockNews({ id: "x3", source: "Clarín" }),
    ];
    const fake = installFakeIO();
    const { getByLabelText } = render(() => (
      <OtrasVocesCta otherSources={others} currentId="a1" onSelect={() => {}} />
    ));
    fake.fireAll([{ isIntersecting: true, intersectionRatio: 0.8 }]);
    await waitFor(() => {
      expect(getByLabelText(/voces más sobre esta historia/i)).toBeInTheDocument();
    });
    expect(getByLabelText(/voces más sobre esta historia/i).textContent).toContain("2 voces");
  });

  it("opens a bottom sheet with the other sources when the CTA is tapped", async () => {
    mockNavigatorVibrate();
    const others = [
      createMockNews({ id: "x2", source: "Página 12", title: "Desde otro ángulo" }),
      createMockNews({ id: "x3", source: "Clarín", title: "Otra cobertura" }),
    ];
    const fake = installFakeIO();
    const onSelect = vi.fn();
    const { getByLabelText } = render(() => (
      <OtrasVocesCta otherSources={others} currentId="a1" onSelect={onSelect} />
    ));
    fake.fireAll([{ isIntersecting: true, intersectionRatio: 0.8 }]);
    const cta = await waitFor(() => getByLabelText(/voces más sobre esta historia/i));
    fireEvent.click(cta);
    // BottomSheet renders into a Portal, so the content lives in document.body
    expect(document.body.textContent).toContain("2 voces sobre esta historia");
    expect(document.body.textContent).toContain("Desde otro ángulo");
    expect(document.body.textContent).toContain("Otra cobertura");
  });

  it("calls onSelect with the article and closes the sheet when a source card is tapped", async () => {
    mockNavigatorVibrate();
    const others = [createMockNews({ id: "x2", source: "X Source", title: "Title Y" })];
    const fake = installFakeIO();
    const onSelect = vi.fn();
    const { getByLabelText } = render(() => (
      <OtrasVocesCta otherSources={others} currentId="a1" onSelect={onSelect} />
    ));
    fake.fireAll([{ isIntersecting: true, intersectionRatio: 0.8 }]);
    const cta = await waitFor(() => getByLabelText(/voces más sobre esta historia/i));
    fireEvent.click(cta);
    // The side-by-side table renders a 'Leer completo' button
    // per source card. Click it to switch to that coverage.
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    // BottomSheet portals to document.body; query there.
    const readBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Leer cobertura de X Source"
    ) as HTMLElement;
    expect(readBtn).toBeTruthy();
    fireEvent.click(readBtn);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("x2");
  });

  it("marks the current article as 'Estás acá' in the table", async () => {
    mockNavigatorVibrate();
    const others = [
      createMockNews({ id: "x2", source: "X Source", title: "Other" }),
      createMockNews({ id: "a1", source: "My Source", title: "Current" }),
    ];
    const fake = installFakeIO();
    const { getByLabelText } = render(() => (
      <OtrasVocesCta otherSources={others} currentId="a1" onSelect={() => {}} />
    ));
    fake.fireAll([{ isIntersecting: true, intersectionRatio: 0.8 }]);
    const cta = await waitFor(() => getByLabelText(/voces más sobre esta historia/i));
    fireEvent.click(cta);
    // The current article's button is disabled and labeled
    // 'Estás acá'; the other one has 'Leer cobertura de…'.
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Estás acá");
    expect(dialog.textContent).toContain("Leyendo");
    // The 'Leer completo' button is only on the OTHER source.
    const readBtn = document.body.querySelector(
      'button[aria-label="Leer cobertura de X Source"]'
    ) as HTMLElement;
    expect(readBtn).toBeTruthy();
  });
});

// ─── helpers ─────────────────────────────────────────────────
type IOCallback = (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;
interface FakeIOInstance {
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  trigger: (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;
}
function installFakeIO() {
  const instances: FakeIOInstance[] = [];
  class FakeIO {
    cb: IOCallback;
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    constructor(cb: IOCallback) {
      this.cb = cb;
      instances.push(this as unknown as FakeIOInstance);
    }
    trigger(entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) {
      this.cb(entries);
    }
  }
  (globalThis as unknown as { IntersectionObserver: typeof FakeIO }).IntersectionObserver = FakeIO;
  return {
    instances,
    fireAll(entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) {
      for (const i of instances) i.trigger(entries);
    },
  };
}
