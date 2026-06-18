/** @jsxImportSource solid-js */
import { createSignal, onMount, onCleanup } from "solid-js";

export type UseChromeUiReturn = {
  drawerOpen: () => boolean;
  setDrawerOpen: (v: boolean) => void;
  toggleDrawer: () => void;
  mateMode: () => boolean;
  setMateMode: (v: boolean) => void;
  toggleMate: () => void;
  onboardingVisible: () => boolean;
  setOnboardingVisible: (v: boolean) => void;
  openOnboarding: () => void;
  closeOnboarding: () => void;
};

export function useChromeUi(): UseChromeUiReturn {
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [mateMode, setMateMode] = createSignal(false);
  const [onboardingVisible, setOnboardingVisible] = createSignal(false);

  return {
    drawerOpen,
    setDrawerOpen,
    toggleDrawer: () => setDrawerOpen((d) => !d),
    mateMode,
    setMateMode,
    toggleMate: () => setMateMode((m) => !m),
    onboardingVisible,
    setOnboardingVisible,
    openOnboarding: () => setOnboardingVisible(true),
    closeOnboarding: () => setOnboardingVisible(false),
  };
}
