// User preferences persisted to localStorage.
// The shape is intentionally narrow — keep SSR-safety in mind:
// helpers must return a sensible default when `window` is undefined
// (initial render) and must swallow `localStorage` exceptions
// (Safari private mode, blocked storage, etc.).

export type Density = "compact" | "comfortable";

// ─── Font scale ─────────────────────────────────────────────────
// 0.875 = 87.5% of base, 1.25 = 125%. Used to scale the root
// font-size; everything in the app derives from it.
export type FontScale = number;
export const FONT_SCALE_MIN = 0.875;
export const FONT_SCALE_MAX = 1.25;
export const FONT_SCALE_DEFAULT = 1.0;
export const FONT_SCALE_STEP = 0.0625; // ~10% of the unit step
const FONT_SCALE_KEY = "antena-font-scale";

export function clampFontScale(v: number): FontScale {
  if (!Number.isFinite(v)) return FONT_SCALE_DEFAULT;
  return Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, v));
}

export function readFontScale(): FontScale {
  if (typeof window === "undefined") return FONT_SCALE_DEFAULT;
  try {
    const raw = localStorage.getItem(FONT_SCALE_KEY);
    if (raw === null) return FONT_SCALE_DEFAULT;
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return FONT_SCALE_DEFAULT;
    if (parsed < FONT_SCALE_MIN || parsed > FONT_SCALE_MAX) return FONT_SCALE_DEFAULT;
    return parsed;
  } catch {
    return FONT_SCALE_DEFAULT;
  }
}

export function writeFontScale(v: FontScale): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FONT_SCALE_KEY, String(clampFontScale(v)));
  } catch {
    /* private mode */
  }
}

// ─── Data saver ─────────────────────────────────────────────────
// When ON: images are hidden in the feed (layout preserved via
// background color) and the image pipeline requests low-quality
// variants. See src/lib/image.ts for the actual implementation.
const DATA_SAVER_KEY = "antena-data-saver";

export function readDataSaver(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DATA_SAVER_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeDataSaver(v: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DATA_SAVER_KEY, v ? "true" : "false");
  } catch {
    /* private mode */
  }
}

// ─── Image quality ──────────────────────────────────────────────
// "auto" = the image pipeline picks (default). The other three
// force a fixed variant. Maps to the ?fmt= and ?w= params on
// /api/img/{hash} — see src/lib/image.ts.
export type ImageQuality = "auto" | "high" | "medium" | "low";
const VALID_QUALITIES: ReadonlyArray<ImageQuality> = ["auto", "high", "medium", "low"];
const IMAGE_QUALITY_KEY = "antena-image-quality";

export function isValidImageQuality(v: unknown): v is ImageQuality {
  return typeof v === "string" && (VALID_QUALITIES as ReadonlyArray<string>).includes(v);
}

export function readImageQuality(): ImageQuality {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = localStorage.getItem(IMAGE_QUALITY_KEY);
    return isValidImageQuality(raw) ? raw : "auto";
  } catch {
    return "auto";
  }
}

export function writeImageQuality(v: ImageQuality): void {
  if (typeof window === "undefined") return;
  if (!isValidImageQuality(v)) return;
  try {
    localStorage.setItem(IMAGE_QUALITY_KEY, v);
  } catch {
    /* private mode */
  }
}

// ─── Density ────────────────────────────────────────────────────
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
