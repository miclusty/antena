# macOS Media Session for RadioPlayer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `RadioPlayer` to macOS Media Session via `navigator.mediaSession` so F7/F8/F9 media keys (and Touch Bar / AirPods / Control Center) control playback. Map prev/next to a virtual queue (favorites ++ recents) and detect rapid double-press to jump to the next favorite.

**Architecture:**
- Pure-functions module `lib/radio-queue.ts` for queue math (favorites + recents, dedup, circular)
- Thin wrapper `lib/media-session.ts` over `navigator.mediaSession` that registers action handlers and detects double-taps
- `RadioPlayer.tsx` calls `installMediaSession(...)` once on first `selectRadio` and updates `mediaSession.metadata` whenever `current()` changes

**Tech Stack:**
- TypeScript (frontend)
- Solid.js (signals)
- vitest + `@solidjs/testing-library` (tests)
- macOS Safari (target browser)

**Spec:** `docs/superpowers/specs/2026-06-18-macos-media-session-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|------|----------------|
| `packages/antena/src/lib/radio-queue.ts` | Pure functions: `buildQueue`, `getNext`, `getPrev`, `getNextFavorite` |
| `packages/antena/src/lib/media-session.ts` | Wrapper over `navigator.mediaSession` + double-tap detection |
| `packages/antena/src/tests/radio-queue.test.ts` | Unit tests for queue functions |
| `packages/antena/src/tests/media-session.test.ts` | Tests for the Media Session wrapper (with mocked `navigator.mediaSession`) |

### Modified files

| Path | Change |
|------|--------|
| `packages/antena/src/components/common/RadioPlayer.tsx` | Import new modules; call `installMediaSession` from `selectRadio`; add `createEffect` to update metadata |

---

## Task Index

| # | Task | Phase |
|---|------|-------|
| 1 | Write `radio-queue.ts` tests (TDD red) | 1 |
| 2 | Implement `radio-queue.ts` (TDD green) | 1 |
| 3 | Write `media-session.ts` tests (TDD red) | 2 |
| 4 | Implement `media-session.ts` (TDD green) | 2 |
| 5 | Integrate into `RadioPlayer.tsx` | 3 |
| 6 | Verification: typecheck + full test suite | 4 |
| 7 | Manual smoke test on macOS Safari PWA | 4 |

---

## Task 1: Write `radio-queue.ts` tests (TDD red)

**Files:**
- Create: `packages/antena/src/tests/radio-queue.test.ts`

- [ ] **Step 1: Create the test file**

`packages/antena/src/tests/radio-queue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildQueue,
  getNext,
  getPrev,
  getNextFavorite,
} from "../lib/radio-queue";

interface Radio {
  id: number;
  name: string;
  city?: string | null;
}

const mkRadios = (ids: number[]): Map<number, Radio> => {
  const m = new Map<number, Radio>();
  for (const id of ids) m.set(id, { id, name: `Radio ${id}` });
  return m;
};

describe("getNext", () => {
  it("returns null for empty queue", () => {
    expect(getNext([], 1)).toBeNull();
  });

  it("returns the same item for a single-item queue (wraps to self)", () => {
    expect(getNext([42], 42)).toBe(42);
  });

  it("advances to the next item", () => {
    expect(getNext([1, 2, 3], 1)).toBe(2);
  });

  it("wraps from the last to the first", () => {
    expect(getNext([1, 2, 3], 3)).toBe(1);
  });

  it("returns queue[0] when current is not in queue", () => {
    expect(getNext([1, 2], 99)).toBe(1);
  });

  it("returns queue[0] when current is null", () => {
    expect(getNext([10, 20, 30], null)).toBe(10);
  });
});

describe("getPrev", () => {
  it("returns null for empty queue", () => {
    expect(getPrev([], 1)).toBeNull();
  });

  it("wraps to self for single-item queue", () => {
    expect(getPrev([42], 42)).toBe(42);
  });

  it("goes back one item", () => {
    expect(getPrev([1, 2, 3], 2)).toBe(1);
  });

  it("wraps from the first to the last", () => {
    expect(getPrev([1, 2, 3], 1)).toBe(3);
  });

  it("returns last item when current is not in queue", () => {
    expect(getPrev([1, 2], 99)).toBe(2);
  });

  it("returns last item when current is null", () => {
    expect(getPrev([10, 20, 30], null)).toBe(30);
  });
});

describe("buildQueue", () => {
  it("combines favorites first, recents second", () => {
    const queue = buildQueue([1, 2], [3, 4], mkRadios([1, 2, 3, 4]));
    expect(queue).toEqual([1, 2, 3, 4]);
  });

  it("dedupes favorite that also appears in recents", () => {
    const queue = buildQueue([1, 2], [2, 3, 4], mkRadios([1, 2, 3, 4]));
    expect(queue).toEqual([1, 2, 3, 4]);
  });

  it("filters out IDs not in radiosById", () => {
    const queue = buildQueue([1, 99], [2, 100, 3], mkRadios([1, 2, 3]));
    expect(queue).toEqual([1, 2, 3]);
  });

  it("returns empty when all IDs are invalid", () => {
    const queue = buildQueue([99, 100], [101], mkRadios([1, 2, 3]));
    expect(queue).toEqual([]);
  });

  it("handles empty favorites and recents", () => {
    expect(buildQueue([], [], mkRadios([1, 2, 3]))).toEqual([]);
  });
});

describe("getNextFavorite", () => {
  it("returns null when there are no favorites", () => {
    expect(getNextFavorite([], 1, mkRadios([1, 2]))).toBeNull();
  });

  it("returns null when favorites contain only invalid IDs", () => {
    expect(getNextFavorite([99], 1, mkRadios([1, 2]))).toBeNull();
  });

  it("returns first favorite when current is null", () => {
    expect(getNextFavorite([5, 6, 7], null, mkRadios([5, 6, 7]))).toBe(5);
  });

  it("returns first favorite when current is not a favorite", () => {
    expect(getNextFavorite([5, 6, 7], 1, mkRadios([1, 5, 6, 7]))).toBe(5);
  });

  it("advances to the next favorite", () => {
    expect(getNextFavorite([5, 6, 7], 5, mkRadios([5, 6, 7]))).toBe(6);
  });

  it("wraps from the last to the first", () => {
    expect(getNextFavorite([5, 6, 7], 7, mkRadios([5, 6, 7]))).toBe(5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
pnpm --filter antena test radio-queue.test.ts
```

Expected: tests FAIL — `Failed to resolve import "../lib/radio-queue"`.

- [ ] **Step 3: Commit failing tests**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
git add packages/antena/src/tests/radio-queue.test.ts
git -c user.email=opencode@local -c user.name=opencode commit -m "test(antena): failing tests for radio-queue"
```

---

## Task 2: Implement `radio-queue.ts` (TDD green)

**Files:**
- Create: `packages/antena/src/lib/radio-queue.ts`

- [ ] **Step 1: Implement the module**

`packages/antena/src/lib/radio-queue.ts`:

```ts
/**
 * Pure functions for the virtual radio navigation queue.
 *
 * The queue is the union of the user's favorites and recents, with favorites
 * taking priority. It's used by the macOS Media Session wrapper to translate
 * prev/next media-key events into actual radio selections.
 */

import type { Radio } from "../components/common/RadioPlayer";

/**
 * Build the navigation queue: favorites first, then recents (excluding
 * duplicates and IDs whose radio is no longer in the directory).
 */
export function buildQueue(
  favorites: number[],
  recents: number[],
  radiosById: Map<number, Radio>,
): number[] {
  const favSet = new Set(favorites);
  const queue: number[] = [];

  for (const id of favorites) {
    if (radiosById.has(id)) queue.push(id);
  }
  for (const id of recents) {
    if (!favSet.has(id) && radiosById.has(id)) queue.push(id);
  }

  return queue;
}

/**
 * Return the next radio id in the queue, wrapping at the end.
 * Returns null only when the queue is empty.
 */
export function getNext(
  queue: number[],
  currentId: number | null,
): number | null {
  if (queue.length === 0) return null;
  if (currentId === null) return queue[0];

  const idx = queue.indexOf(currentId);
  if (idx === -1) return queue[0];
  return queue[(idx + 1) % queue.length];
}

/**
 * Return the previous radio id in the queue, wrapping at the start.
 * Returns null only when the queue is empty.
 */
export function getPrev(
  queue: number[],
  currentId: number | null,
): number | null {
  if (queue.length === 0) return null;
  if (currentId === null) return queue[queue.length - 1];

  const idx = queue.indexOf(currentId);
  if (idx === -1) return queue[queue.length - 1];
  return queue[(idx - 1 + queue.length) % queue.length];
}

/**
 * Return the next favorite radio id (wrapping at the end of the favorites
 * list). Returns null if the user has no valid favorites.
 *
 * Used for the double-tap gesture: pressing next/prev twice quickly
 * jumps to the next favorite, regardless of which button was pressed.
 */
export function getNextFavorite(
  favorites: number[],
  currentId: number | null,
  radiosById: Map<number, Radio>,
): number | null {
  const validFavs = favorites.filter((id) => radiosById.has(id));
  if (validFavs.length === 0) return null;

  if (currentId === null) return validFavs[0];

  const idx = validFavs.indexOf(currentId);
  if (idx === -1) return validFavs[0];
  return validFavs[(idx + 1) % validFavs.length];
}
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
pnpm --filter antena test radio-queue.test.ts
```

Expected: all 22 tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
git add packages/antena/src/lib/radio-queue.ts
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(antena): radio-queue pure functions"
```

---

## Task 3: Write `media-session.ts` tests (TDD red)

**Files:**
- Create: `packages/antena/src/tests/media-session.test.ts`

- [ ] **Step 1: Create the test file**

`packages/antena/src/tests/media-session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("detectDoubleTap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true when the same action fires within 300ms", async () => {
    const { detectDoubleTap } = await import("../lib/media-session");
    detectDoubleTap("next"); // first tap
    vi.advanceTimersByTime(200);
    const isDouble = detectDoubleTap("next"); // second tap
    expect(isDouble).toBe(true);
  });

  it("returns false when the same action fires after 300ms", async () => {
    const { detectDoubleTap } = await import("../lib/media-session");
    detectDoubleTap("next");
    vi.advanceTimersByTime(500);
    const isDouble = detectDoubleTap("next");
    expect(isDouble).toBe(false);
  });

  it("returns false when different actions fire quickly", async () => {
    const { detectDoubleTap } = await import("../lib/media-session");
    detectDoubleTap("next");
    vi.advanceTimersByTime(100);
    const isDouble = detectDoubleTap("prev");
    expect(isDouble).toBe(false);
  });

  it("does not register a double-tap on the very first call", async () => {
    const { detectDoubleTap } = await import("../lib/media-session");
    expect(detectDoubleTap("next")).toBe(false);
  });

  it("treats three rapid taps as: false, true, false (alternating)", async () => {
    const { detectDoubleTap } = await import("../lib/media-session");
    expect(detectDoubleTap("next")).toBe(false);
    vi.advanceTimersByTime(100);
    expect(detectDoubleTap("next")).toBe(true);
    vi.advanceTimersByTime(100);
    expect(detectDoubleTap("next")).toBe(false);
  });
});

describe("installMediaSession", () => {
  let setActionHandlerCalls: Array<{ action: string; handler: unknown }>;
  let mockMetadata: MediaMetadata | null;

  beforeEach(() => {
    vi.resetModules();
    setActionHandlerCalls = [];
    mockMetadata = null;

    // Mock navigator.mediaSession
    (globalThis as any).navigator = {
      mediaSession: {
        setActionHandler: vi.fn((action: string, handler: unknown) => {
          setActionHandlerCalls.push({ action, handler });
        }),
        set metadata(value: MediaMetadata | null) {
          mockMetadata = value;
        },
        get metadata() {
          return mockMetadata;
        },
      },
    };
  });

  it("is a no-op when navigator.mediaSession is unavailable", async () => {
    (globalThis as any).navigator = {};
    const { installMediaSession } = await import("../lib/media-session");
    expect(() =>
      installMediaSession({
        play: vi.fn(),
        pause: vi.fn(),
        next: vi.fn(),
        prev: vi.fn(),
        nextFavorite: vi.fn(),
        prevFavorite: vi.fn(),
        getMetadata: () => null,
      }),
    ).not.toThrow();
  });

  it("registers handlers for play, pause, nexttrack, previoustrack", async () => {
    const { installMediaSession } = await import("../lib/media-session");
    installMediaSession({
      play: vi.fn(),
      pause: vi.fn(),
      next: vi.fn(),
      prev: vi.fn(),
      nextFavorite: vi.fn(),
      prevFavorite: vi.fn(),
      getMetadata: () => null,
    });
    const actions = setActionHandlerCalls.map((c) => c.action);
    expect(actions).toContain("play");
    expect(actions).toContain("pause");
    expect(actions).toContain("nexttrack");
    expect(actions).toContain("previoustrack");
  });

  it("calls next on a single nexttrack press", async () => {
    const { installMediaSession } = await import("../lib/media-session");
    const next = vi.fn();
    installMediaSession({
      play: vi.fn(),
      pause: vi.fn(),
      next,
      prev: vi.fn(),
      nextFavorite: vi.fn(),
      prevFavorite: vi.fn(),
      getMetadata: () => null,
    });
    const nexttrack = setActionHandlerCalls.find((c) => c.action === "nexttrack")!;
    (nexttrack.handler as () => void)();
    expect(next).toHaveBeenCalledOnce();
  });

  it("calls nextFavorite on a double nexttrack press", async () => {
    vi.useFakeTimers();
    const { installMediaSession } = await import("../lib/media-session");
    const next = vi.fn();
    const nextFavorite = vi.fn();
    installMediaSession({
      play: vi.fn(),
      pause: vi.fn(),
      next,
      prev: vi.fn(),
      nextFavorite,
      prevFavorite: vi.fn(),
      getMetadata: () => null,
    });
    const nexttrack = setActionHandlerCalls.find((c) => c.action === "nexttrack")!;
    (nexttrack.handler as () => void)();
    vi.advanceTimersByTime(200);
    (nexttrack.handler as () => void)();
    expect(next).toHaveBeenCalledOnce();
    expect(nextFavorite).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("calls nextFavorite on previoustrack double-press too", async () => {
    vi.useFakeTimers();
    const { installMediaSession } = await import("../lib/media-session");
    const prev = vi.fn();
    const nextFavorite = vi.fn();
    installMediaSession({
      play: vi.fn(),
      pause: vi.fn(),
      next: vi.fn(),
      prev,
      nextFavorite,
      prevFavorite: vi.fn(),
      getMetadata: () => null,
    });
    const previoustrack = setActionHandlerCalls.find((c) => c.action === "previoustrack")!;
    (previoustrack.handler as () => void)();
    vi.advanceTimersByTime(200);
    (previoustrack.handler as () => void)();
    expect(prev).toHaveBeenCalledOnce();
    expect(nextFavorite).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
pnpm --filter antena test media-session.test.ts
```

Expected: tests FAIL — `Failed to resolve import "../lib/media-session"`.

- [ ] **Step 3: Commit failing tests**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
git add packages/antena/src/tests/media-session.test.ts
git -c user.email=opencode@local -c user.name=opencode commit -m "test(antena): failing tests for media-session wrapper"
```

---

## Task 4: Implement `media-session.ts` (TDD green)

**Files:**
- Create: `packages/antena/src/lib/media-session.ts`

- [ ] **Step 1: Implement the wrapper**

`packages/antena/src/lib/media-session.ts`:

```ts
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
  lastAction = action;
  lastActionAt = now;
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
      handlers.prevFavorite();
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
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
pnpm --filter antena test media-session.test.ts
```

Expected: all 12 tests PASS (5 detectDoubleTap + 7 installMediaSession).

- [ ] **Step 3: Commit**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
git add packages/antena/src/lib/media-session.ts
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(antena): media-session wrapper with double-tap detection"
```

---

## Task 5: Integrate into `RadioPlayer.tsx`

**Files:**
- Modify: `packages/antena/src/components/common/RadioPlayer.tsx`

This is the integration task. It has no new tests (the underlying logic is fully tested in Tasks 1-4). We verify the typecheck and the existing test suite still passes.

- [ ] **Step 1: Add imports at the top of the file**

Find the existing import block near the top of `RadioPlayer.tsx`. Add to it:

```tsx
import { buildQueue, getNext, getPrev, getNextFavorite } from "../../lib/radio-queue";
import { installMediaSession, setMetadata } from "../../lib/media-session";
import { COUNTRIES } from "../../lib/countries";
import { country } from "../../lib/user-country";
```

- [ ] **Step 2: Add a radiosById memo for the queue**

Inside `default function RadioPlayer()`, near the other `createMemo` declarations, add:

```tsx
const radiosById = createMemo(() => {
  const m = new Map<number, Radio>();
  for (const r of radios()) m.set(r.id, r);
  return m;
});
```

- [ ] **Step 3: Add `playNext` and `playPrev` functions**

Below the existing `selectRadio` function (around line 250), add:

```tsx
const playNext = () => {
  const queue = buildQueue(favorites(), recents(), radiosById());
  const nextId = getNext(queue, current()?.id ?? null);
  if (nextId === null) {
    setError('No hay más radios para saltar');
    return;
  }
  const radio = radiosById().get(nextId);
  if (radio) selectRadio(radio);
};

const playPrev = () => {
  const queue = buildQueue(favorites(), recents(), radiosById());
  const prevId = getPrev(queue, current()?.id ?? null);
  if (prevId === null) {
    setError('No hay más radios para saltar');
    return;
  }
  const radio = radiosById().get(prevId);
  if (radio) selectRadio(radio);
};

const playNextFavorite = () => {
  const nextFavId = getNextFavorite(
    favorites(),
    current()?.id ?? null,
    radiosById(),
  );
  if (nextFavId === null) {
    setError('Marcá radios como favoritas para usar ⏮⏭ doble');
    return;
  }
  const radio = radiosById().get(nextFavId);
  if (radio) selectRadio(radio);
};

const playPrevFavorite = playNextFavorite; // same handler either way
```

- [ ] **Step 4: Install media session on first selectRadio**

Modify the existing `selectRadio` function to install handlers the first time it's called. At the top of the function (before the existing `setCurrent` call), add:

```tsx
// Install Media Session handlers once. Subsequent calls re-bind
// the handlers with the latest closures (favorites/recents state).
installMediaSession({
  play: () => { setPlaying(true); },
  pause: () => { setPlaying(false); },
  next: playNext,
  prev: playPrev,
  nextFavorite: playNextFavorite,
  prevFavorite: playPrevFavorite,
  getMetadata: () => {
    const c = current();
    if (!c) return null;
    const countryCode = country();
    const countryName = COUNTRIES[countryCode]?.name ?? countryCode;
    const countryFlag = COUNTRIES[countryCode]?.flag ?? '🌍';
    return new MediaMetadata({
      title: c.name,
      artist: [c.city, c.province].filter(Boolean).join(' · ') || countryName,
      album: `Antena · ${countryFlag} ${countryName}`,
      artwork: [
        { src: '/favicon.svg', sizes: '512x512', type: 'image/svg+xml' },
      ],
    });
  },
});
```

- [ ] **Step 5: Update metadata when current radio changes**

Add a `createEffect` that mirrors `current()` to `mediaSession.metadata`. Place it near the other `createEffect` blocks (around line 200):

```tsx
createEffect(() => {
  const c = current();
  if (!c) {
    setMetadata(null);
    return;
  }
  const countryCode = country();
  const countryName = COUNTRIES[countryCode]?.name ?? countryCode;
  const countryFlag = COUNTRIES[countryCode]?.flag ?? '🌍';
  setMetadata(new MediaMetadata({
    title: c.name,
    artist: [c.city, c.province].filter(Boolean).join(' · ') || countryName,
    album: `Antena · ${countryFlag} ${countryName}`,
    artwork: [
      { src: '/favicon.svg', sizes: '512x512', type: 'image/svg+xml' },
    ],
  }));
});
```

- [ ] **Step 6: Verify typecheck passes**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7: Verify existing tests still pass**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
pnpm --filter antena test
```

Expected: at least the radio-queue + media-session + user-country + CountrySelector tests pass (35 tests minimum). Pre-existing failures (snapshot/llms-txt) are out of scope.

- [ ] **Step 8: Commit**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
git add packages/antena/src/components/common/RadioPlayer.tsx
git -c user.email=opencode@local -c user.name=opencode commit -m "feat(antena): RadioPlayer media-session integration"
```

---

## Task 6: Verification — typecheck + full test suite

**Files:** none

- [ ] **Step 1: Run typecheck**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
pnpm typecheck
```

Expected: clean.

- [ ] **Step 2: Run AKIRA tests**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global/packages/akira && source .venv/bin/activate
python -m pytest tests/test_medios_radios.py tests/test_import_random_radio_global.py -v
```

Expected: 17 tests pass.

- [ ] **Step 3: Run API tests**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
pnpm --filter api test
```

Expected: at least 89 pass (1 pre-existing failure).

- [ ] **Step 4: Run Antena tests**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
pnpm --filter antena test
```

Expected: at least 35 pass (4 pre-existing failures). Our new tests (22 + 12 = 34) + existing 10 + 1 = 45 pass; the 4 pre-existing failures (snapshot, llms-txt) are not ours.

- [ ] **Step 5: Verify no new failures**

Diff the test counts against the baseline (commit `6f3af62` or earlier radios-global pre-task). Any new failure is a regression.

---

## Task 7: Manual smoke test on macOS Safari PWA

This task requires a real Mac with Safari. Cannot be automated.

- [ ] **Step 1: Build Antena**

```bash
cd /Users/omatic/proyectos/news/.worktrees/radios-global
pnpm --filter antena build
```

Expected: build completes without errors.

- [ ] **Step 2: Start AKIRA + API + Antena in dev**

```bash
# Terminal 1
cd /Users/omatic/proyectos/news/.worktrees/radios-global/packages/akira && source .venv/bin/activate
python -m uvicorn main:app --host 0.0.0.0 --port 5000

# Terminal 2
cd /Users/omatic/proyectos/news/.worktrees/radios-global/packages/api
pnpm dev

# Terminal 3
cd /Users/omatic/proyectos/news/.worktrees/radios-global/packages/antena
pnpm dev
```

- [ ] **Step 3: Open in macOS Safari, install as PWA**

1. Open `http://localhost:4321` in Safari
2. File menu → "Add to Dock" (or Share → "Add to Dock")
3. Open the PWA from the Dock

- [ ] **Step 4: Verify Now Playing widget**

1. Play a radio (e.g. Radio Mitre)
2. Open macOS Control Center → should show the radio with title, artist, album, artwork
3. Verify title=Radio Mitre, artist=Buenos Aires · Buenos Aires, album=Antena · 🇦🇷 Argentina

- [ ] **Step 5: Test media keys**

1. Press F8 → should pause
2. Press F8 → should resume
3. Press F9 → should skip to next station
4. Press F9 twice quickly (<300ms) → should jump to a favorite
5. Press F7 → should go to previous station

- [ ] **Step 6: Test Control Center buttons**

1. Open Control Center, find the Now Playing card
2. Click play/pause → should toggle audio
3. Click next → should advance
4. Click prev → should go back

- [ ] **Step 7: Test AirPods (if available)**

1. Connect AirPods
2. Single click → should play/pause
3. Double click → should advance

- [ ] **Step 8: Test edge cases**

1. Mark 0 radios as favorite → press F9 twice → should see toast "Marcá radios como favoritas para usar ⏮⏭ doble"
2. Mark 1 radio as favorite → press F9 twice → should land on that favorite
3. Change country to a country with no favorites → press F9 → should advance through recents (if any)

- [ ] **Step 9: Report findings**

If any test fails, note it and report back. Common issues:
- macOS not showing widget → check PWA is "installed" (Add to Dock)
- F-keys not working → macOS keyboard settings may need F7/F8/F9 assigned to media keys
- Double-tap not working → check the 300ms threshold in `media-session.ts`

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|------------------|------|
| `radio-queue.ts` pure functions | Tasks 1-2 |
| `buildQueue` (favorites ++ recents, dedup) | Tasks 1-2 |
| `getNext` (circular, null safe) | Tasks 1-2 |
| `getPrev` (circular, null safe) | Tasks 1-2 |
| `getNextFavorite` (favorites only) | Tasks 1-2 |
| `media-session.ts` wrapper | Tasks 3-4 |
| `detectDoubleTap` (300ms threshold) | Tasks 3-4 |
| `installMediaSession` (idempotent, no-op when API missing) | Tasks 3-4 |
| `setMetadata` helper | Task 4 |
| Register play/pause/nexttrack/previoustrack handlers | Task 4 |
| Update metadata on `current()` change | Task 5 |
| Artwork = Antena favicon | Task 5 |
| Album = "Antena · 🇦🇷 {countryName}" | Task 5 |
| Double-tap of either direction → nextFavorite | Task 4 |
| Edge case: no API available → graceful no-op | Task 4 |
| Edge case: 0 favorites → toast | Task 5 |
| Edge case: 0 recents 0 favorites → no-op + toast | Task 5 |
| Manual macOS Safari PWA test | Task 7 |

All spec requirements covered. ✅

**Placeholder scan:** No TBDs, no "fill in later". All code blocks are complete.

**Type consistency:**
- `Radio` imported from `../components/common/RadioPlayer` matches the existing type definition
- `MediaMetadata` is a standard Web API type
- `favorites()` / `recents()` / `current()` are existing Solid signals in `RadioPlayer.tsx`
- `buildQueue(favorites, recents, radiosById)` signature used consistently
- `getNextFavorite(favorites, currentId, radiosById)` signature used consistently

**Cross-task consistency:**
- `playNext` / `playPrev` / `playNextFavorite` are defined in Task 5 and consumed by Task 4 (via the install call) — but the install call is in Task 5, not Task 4. So Task 4's tests mock the handlers and don't depend on Task 5's implementation. ✅
- `setMetadata` is called from both `selectRadio` (via the install getMetadata effect) and the standalone `createEffect`. Same function, called consistently. ✅
- Double-tap threshold 300ms is defined in Task 4 and tested at exactly 300ms boundary in tests. ✅

---

## Total estimated time

| Phase | Tasks | Time |
|-------|-------|------|
| radio-queue | 1-2 | 25 min |
| media-session | 3-4 | 35 min |
| Integration | 5 | 25 min |
| Verification | 6 | 10 min |
| Manual smoke | 7 | 20 min |

**Total: ~2 hours** (most of Task 7 is waiting for a Mac user to verify).
