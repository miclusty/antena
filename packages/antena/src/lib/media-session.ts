/**
 * Wrapper around the Web Media Session API for macOS PWA control.
 *
 * `navigator.mediaSession` lets us:
 * - Register handlers for play/pause/next/prev (mapped to macOS F-keys, Touch Bar, AirPods, Control Center)
 * - Publish metadata (title/artist/album/artwork) that appears in the macOS "Now Playing" widget, lock screen, etc.
 *
 * This module adds one extra behavior on top of the standard API: detection
 * of rapid double-presses of next/prev, which we map to "jump to the next
 * favorite radio" (a UX pattern familiar from Apple Music).
 *
 * Live radio streams have no concept of position, so we do NOT register
 * seekbackward / seekforward / seekto handlers.
 */

/** Maximum gap (ms) between two consecutive presses to count as a double-tap. */
export const DOUBLE_TAP_MS = 300;

let lastAction: "next" | "prev" | null = null;
let lastActionAt = 0;

/**
 * Detect whether the current press is the second of a double-tap pair.
 *
 * The state lives at module scope (not in a signal) because this is hot-path
 * code: every media-key press goes through here, and we don't want a signal
 * subscription to run on each call.
 */
export function detectDoubleTap(action: "next" | "prev"): boolean {
  const now = Date.now();
  const isDouble = lastAction === action && (now - lastActionAt) < DOUBLE_TAP_MS;
  if (isDouble) {
    lastAction = null;
    lastActionAt = 0;
  } else {
    lastAction = action;
    lastActionAt = now;
  }
  return isDouble;
}

/** Reset module-level state. Useful for tests. */
export function _resetDoubleTapState(): void {
  lastAction = null;
  lastActionAt = 0;
}

interface MediaSessionHandlers {
  play: () => void;
  pause: () => void;
  next: () => void;          // single tap of nexttrack
  prev: () => void;          // single tap of previoustrack
  nextFavorite: () => void;  // double tap of either direction
  prevFavorite: () => void;  // double tap of either direction
  getMetadata: () => MediaMetadata | null;
}

/**
 * Register action handlers on `navigator.mediaSession`. Idempotent — safe
 * to call again to rebind with fresh closures (e.g. on each radio selection).
 *
 * No-op when the browser does not expose `navigator.mediaSession`.
 */
export function installMediaSession(handlers: MediaSessionHandlers): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return;
  }
  const ms = navigator.mediaSession as MediaSession;

  ms.setActionHandler("play", handlers.play);
  ms.setActionHandler("pause", handlers.pause);

  ms.setActionHandler("nexttrack", () => {
    if (detectDoubleTap("next")) {
      handlers.nextFavorite();
    } else {
      handlers.next();
    }
  });

  ms.setActionHandler("previoustrack", () => {
    if (detectDoubleTap("prev")) {
      handlers.nextFavorite();
    } else {
      handlers.prev();
    }
  });
}

/**
 * Publish metadata to macOS (Now Playing widget, Control Center, lock screen).
 * Pass `null` to clear.
 */
export function setMetadata(meta: MediaMetadata | null): void {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
    return;
  }
  (navigator.mediaSession as MediaSession).metadata = meta;
}
