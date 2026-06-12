function vibrate(pattern: number | number[] = 15): boolean {
  if (typeof navigator !== 'undefined' && "vibrate" in navigator) {
    try {
      navigator.vibrate(pattern);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

const HapticPattern = {
  tap: 15,
  selection: 10,
  success: [15, 50, 15],
  error: [30, 50, 30, 50, 30],
  long: 50,
  double: [15, 100, 15],
} as const;

export function useHaptic() {
  const isSupported = typeof navigator !== 'undefined' && "vibrate" in navigator;
  return {
    isSupported,
    vibrate: (pattern: keyof typeof HapticPattern | number | number[]) => {
      if (!isSupported) return false;
      const p = typeof pattern === "string" ? HapticPattern[pattern] : pattern;
      return vibrate(p);
    },
  };
}
