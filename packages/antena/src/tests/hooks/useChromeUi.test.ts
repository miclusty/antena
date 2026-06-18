import { describe, it, expect } from "vitest";
import { createRoot } from "solid-js";
import { useChromeUi } from "../../hooks/useChromeUi";

describe("useChromeUi", () => {
  it("starts with all UIs closed", () => {
    createRoot((dispose) => {
      const ui = useChromeUi();
      expect(ui.drawerOpen()).toBe(false);
      expect(ui.mateMode()).toBe(false);
      expect(ui.onboardingVisible()).toBe(false);
      dispose();
    });
  });

  it("toggles drawer, mate, onboarding", () => {
    createRoot((dispose) => {
      const ui = useChromeUi();
      ui.toggleDrawer();
      expect(ui.drawerOpen()).toBe(true);
      ui.toggleMate();
      expect(ui.mateMode()).toBe(true);
      ui.openOnboarding();
      expect(ui.onboardingVisible()).toBe(true);
      ui.closeOnboarding();
      expect(ui.onboardingVisible()).toBe(false);
      dispose();
    });
  });
});
