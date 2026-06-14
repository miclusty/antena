// User preferences persisted to localStorage.
// The shape is intentionally narrow — keep SSR-safety in mind:
// helpers must return a sensible default when `window` is undefined
// (initial render) and must swallow `localStorage` exceptions
// (Safari private mode, blocked storage, etc.).

export type Density = "compact" | "comfortable";

const DENSITY_KEY = "antena-density";
const DEFAULT_DENSITY: Density = "comfortable";

function isValidDensity(v: unknown): v is Density {
  return v === "compact" || v === "comfortable";
}

export function readDensity(): Density {
  if (typeof window === "undefined") return DEFAULT_DENSITY;
  try {
    const raw = localStorage.getItem(DENSITY_KEY);
    return isValidDensity(raw) ? raw : DEFAULT_DENSITY;
  } catch {
    return DEFAULT_DENSITY;
  }
}

export function writeDensity(d: Density): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DENSITY_KEY, d);
  } catch {
    /* private mode — keep in-memory only */
  }
}
