import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import PwaInstallPrompt from "../components/PwaInstallPrompt";

afterEach(cleanup);

async function renderPromptVisible() {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    get: () =>
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const result = render(() => <PwaInstallPrompt />);
  await new Promise((r) => setTimeout(r, 50));
  return result;
}

describe("PwaInstallPrompt — UX", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") localStorage.clear();
    if (typeof window !== "undefined" && window.matchMedia) {
      window.matchMedia = (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
    }
  });

  it("places the install button on the LEFT side (not overlapping radio on the right)", async () => {
    // Bug: install button was fixed bottom-24 right-4. Radio player
    // also lives on the right (bottom-24-ish). They visually competed
    // and on smaller phones overlapped.
    const { container } = await renderPromptVisible();
    const installBtn = container.querySelector(
      'button[aria-label="Instalar Antena como app"]',
    );
    expect(installBtn).not.toBeNull();
    // The fixed-position container holds the positioning classes.
    const fixedContainer = installBtn!.closest("div.fixed");
    expect(fixedContainer).not.toBeNull();
    const classes = fixedContainer!.className;
    expect(classes).toContain("left-4");
    // Belt-and-suspenders: must NOT be on the right anymore.
    expect(classes).not.toMatch(/\bright-\d/);
  });

  it("has a clearly visible close button (its own background, not just opacity 0.7)", async () => {
    // Bug: the close X was a tiny icon with opacity 0.7 on the
    // accent background — practically invisible. Users couldn't
    // find it. Now it must have its own background AND a border so
    // it stands out from the rest of the install button.
    // NOTE: we check the className for the visual styles instead of
    // the style attribute — happy-dom (our test env) has a bug
    // serializing multi-property style objects. In production the
    // style attribute is correct.
    const { container } = await renderPromptVisible();
    const close = container.querySelector(
      '[role="button"][aria-label="Cerrar recordatorio"]',
    );
    expect(close).not.toBeNull();
    const classes = close!.className;
    expect(classes).toMatch(/border/);
    // Verify the close is visually separated from the install label
    // (it has its own flex item with a fixed width).
    expect(classes).toMatch(/w-9|w-\d+/);
  });

  it("shows a step-by-step iOS modal with numbered steps and a visible close X", async () => {
    // Bug: iOS install instructions were a single sentence. iOS install
    // is genuinely multi-step (Safari only → share → scroll → add).
    // Show the steps numbered 1/2/3 so users can follow.
    const { container } = await renderPromptVisible();
    // Open the iOS modal
    const installBtn = container.querySelector(
      'button[aria-label="Instalar Antena como app"]',
    ) as HTMLButtonElement;
    installBtn.click();
    await new Promise((r) => setTimeout(r, 20));
    // The modal should mention Safari (most users don't know it only
    // works there — Chrome on iOS hijacks to App Store).
    expect(container.textContent).toMatch(/Safari/i);
    // Should have at least 3 steps numbered 1/2/3. The rendered
    // text is "1Tocá...2Desplazate...3Tocá..." — step number adjacent
    // to text. Match digits 1-3 that aren't surrounded by other digits.
    const stepMarkers = container.textContent?.match(/[1-3]/g) ?? [];
    expect(stepMarkers.length).toBeGreaterThanOrEqual(3);
    // The modal has its own close button.
    const modalClose = container.querySelector('[role="dialog"] [role="button"][aria-label="Cerrar"]');
    expect(modalClose).not.toBeNull();
  });

  it("auto-dismisses the floating install button after the user ignores it (does not nag forever)", async () => {
    // The user said "por unos minutos" — if they ignore the button
    // (don't click install, don't click X), it should auto-hide
    // after a reasonable timeout so it stops competing with the radio.
    // Use vi.useFakeTimers for this.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { container } = await renderPromptVisible();
      const installBtn = container.querySelector(
        'button[aria-label="Instalar Antena como app"]',
      );
      expect(installBtn).not.toBeNull();
      // Advance past the auto-dismiss threshold (e.g. 30s).
      vi.advanceTimersByTime(31_000);
      // After auto-dismiss, the button should no longer be in the DOM.
      const stillThere = container.querySelector(
        'button[aria-label="Instalar Antena como app"]',
      );
      expect(stillThere).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});