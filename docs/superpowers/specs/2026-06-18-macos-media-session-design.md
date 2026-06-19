# macOS Media Session para el RadioPlayer — Design Spec

**Date**: 2026-06-18
**Status**: Draft (pending user review)
**Owner**: antena
**Related**: [radios globales spec](./2026-06-18-radios-global-country-filter-design.md) (already implemented in `feature/radios-global`)

---

## Goal

Wire the existing persistent `RadioPlayer` to the macOS Media Session framework via `navigator.mediaSession`, so listeners can control playback from macOS hardware (F7/F8/F9 keys, Touch Bar, AirPods, Control Center, lock screen widget). Also map media-key prev/next to a virtual queue (favorites + recents), and detect rapid double-press of prev/next to jump to the next **favorite** radio.

## Why

The user explicitly requested macOS PWA media-key integration. The existing `RadioPlayer` already supports play/pause via the floating button and the panel; this spec extends that control to OS-level media keys without changing the existing UX.

Apple Music, Spotify, and other native media apps already use this pattern on macOS — adding it to Antena gives the same native feel.

## Non-goals

- ❌ `seekbackward` / `seekforward` (impossible on live HLS/MP3 streams)
- ❌ `seekto` handler (no current position on live)
- ❌ Picture-in-picture (separate feature)
- ❌ Per-radio dynamic artwork (use generic Antena favicon)
- ❌ Windows / Linux / mobile testing (focus on macOS Safari PWA; code is platform-agnostic but tests are Mac-only)
- ❌ Cross-device sync of "last played" (no auth system)
- ❌ Notification API for radio start (would be spam)

---

## Architecture

```
   [macOS user with AirPods + F-keys]
                  │
       press ⏯ / ⏮ / ⏭ / F7 / F8 / F9
                  │
                  ▼
   ┌─────────────────────────────┐
   │  navigator.mediaSession     │  ←── Web API (standard)
   │  (setActionHandler)         │
   └─────────────┬───────────────┘
                 │ action callbacks
                 ▼
   ┌─────────────────────────────┐
   │  lib/media-session.ts       │  ←── our wrapper
   │  • double-tap detection     │
   │  • dispatches to handlers   │
   └─────────────┬───────────────┘
                 │
                 ▼
   ┌─────────────────────────────┐
   │  lib/radio-queue.ts         │  ←── virtual queue
   │  • favorites + recents      │
   │  • getNext / getPrev /      │
   │    getNextFavorite          │
   └─────────────┬───────────────┘
                 │ radio id
                 ▼
   ┌─────────────────────────────┐
   │  RadioPlayer.tsx            │  ←── existing
   │  • selectRadio(radio)       │
   │  • updates audio element    │
   │  • updates mediaSession.md  │
   └─────────────────────────────┘
```

---

## Key mapping

The following table is the public contract of this spec. All actions go through `navigator.mediaSession`, which macOS Safari maps to:

| OS action | macOS key | Behavior |
|-----------|-----------|----------|
| `play` | F8, ⏯, AirPods single-click | `radioPlayer.togglePlay()` |
| `pause` | F8, ⏯, AirPods single-click | `radioPlayer.togglePlay()` |
| `nexttrack` (single) | F9, ⏭, AirPods double-click | `radioPlayer.playNext()` → `getNext(queue)` |
| `previoustrack` (single) | F7, ⏮, AirPods triple-click | `radioPlayer.playPrev()` → `getPrev(queue)` |
| `nexttrack` (double, <300ms) | F9 twice, ⏭ twice | `radioPlayer.playNextFavorite()` → `getNextFavorite()` |
| `previoustrack` (double, <300ms) | F7 twice, ⏮ twice | `radioPlayer.playNextFavorite()` → `getNextFavorite()` (same handler both sides) |

**Why double-tap of either side goes to next favorite:** the user explicitly requested "doble tap a cualquiera paso a la siguiente radio favorita". This is also what Apple Music does — repeated skips don't get confirmation, you just keep moving.

---

## Virtual queue

The virtual queue is the list of radio IDs the user can navigate through with prev/next. It is **not** persisted (rebuilt on every load); it is derived from the two persistent lists:

```
queue = [favorites] ++ [recents \ favorites]
```

- Favorites always come first (user has explicitly chosen them)
- Recents fill the rest, excluding duplicates
- Wrap-around: from the last item, next goes to the first
- If queue is empty, `getNext()` / `getPrev()` return `null` and the player shows a toast

`radio-queue.ts` exports pure functions; no side effects. Takes the lists + a `Map<id, Radio>` so it can filter out favorites/recents whose radio was deleted from the directory.

---

## Media Session metadata

`navigator.mediaSession.metadata` is set whenever the current radio changes:

```ts
new MediaMetadata({
  title: current.name,                              // "Radio Mitre"
  artist: [current.city, current.province].filter(Boolean).join(" · "),  // "Buenos Aires · Buenos Aires"
  album: `Antena · ${countryFlag} ${countryName}`,   // "Antena · 🇦🇷 Argentina"
  artwork: [
    { src: "/favicon.svg", sizes: "512x512", type: "image/svg+xml" }
  ],
});
```

The artwork is the generic Antena favicon. 0 cost, no R2 lookups, no network. macOS will show this in the Now Playing widget, Control Center, Touch Bar, and lock screen.

The `album` field is repurposed for "Antena · country" — the standard album field is rarely meaningful for radio streams, and this gives the user a clear context for "where is this station from".

---

## Edge cases

| Case | Behavior |
|------|----------|
| No radio currently playing | `mediaSession.metadata = null`. Media keys do nothing. No errors. |
| 0 favorites, ≥1 recents | next/prev navigate recents. Double-tap: toast "Marcá radios como favoritas para usar ⏮⏭ doble". |
| 0 favorites, 0 recents | next/prev: no-op. Toast: "Reproducí una radio primero". |
| 1 favorite only | next/next re-selects it. Double-tap: re-selects it. No error. |
| Radio is both favorite AND recent | Appears once, in the favorites section. |
| Country changes while playing | `mediaSession.metadata` updates (album line + flag). |
| Sleep timer active | Media keys continue to work; sleep timer pauses when it expires. |
| App backgrounded / tab hidden | Media Session stays active. Now Playing widget continues working. Audio continues. |
| Page refresh | On mount, `RadioPlayer` re-installs handlers and rebuilds metadata from persisted `current()`. Audio restarts. |
| Stream 404 / fails | `RadioPlayer` error handling already shows "Stream no disponible". Media keys continue to navigate (state is correct, audio fails on its own). |
| Session / cookies cleared | Fresh state, no current radio, media keys inactive. |
| Stream with CORS restrictions | Audio element has no `crossorigin` attribute (existing). Media keys still work (they manipulate state, not audio). |
| Double-tap very fast (<50ms) | Treated as a single tap (debounce). Prevents accidental activation. |
| Double-tap slow (>300ms) | Treated as two separate taps. Threshold 300ms. |
| Different actions (next then prev) | Not a double-tap. Counter resets. |
| Browser without Media Session API (`if (!('mediaSession' in navigator))`) | `installMediaSession` is a no-op. Feature gracefully disabled. |
| Many rapid taps (5+ in 1s) | Each pair within 300ms counts as double-tap. State stays consistent. |

---

## Implementation outline

### New files

| Path | Responsibility |
|------|----------------|
| `packages/antena/src/lib/radio-queue.ts` | Pure functions: `buildQueue`, `getNext`, `getPrev`, `getNextFavorite` |
| `packages/antena/src/lib/media-session.ts` | Wrapper over `navigator.mediaSession`. Action handlers + double-tap detection. |
| `packages/antena/src/tests/radio-queue.test.ts` | Pure-function unit tests |
| `packages/antena/src/tests/media-session.test.ts` | Media Session wrapper tests (mock `navigator.mediaSession`) |

### Modified files

| Path | Change |
|------|--------|
| `packages/antena/src/components/common/RadioPlayer.tsx` | Import `radio-queue` + `media-session`. On `selectRadio`, call `installMediaSession({ play, pause, next, prev, nextFavorite, prevFavorite, getMetadata })`. On `createEffect` watching `current()`, update `mediaSession.metadata`. |

### `radio-queue.ts` API

```ts
import { Radio } from "../components/common/RadioPlayer";

export function buildQueue(
  favorites: number[],
  recents: number[],
  radiosById: Map<number, Radio>,
): number[];

export function getNext(
  queue: number[],
  currentId: number | null,
): number | null;

export function getPrev(
  queue: number[],
  currentId: number | null,
): number | null;

export function getNextFavorite(
  favorites: number[],
  currentId: number | null,
  radiosById: Map<number, Radio>,
): number | null;
```

### `media-session.ts` API

```ts
export const DOUBLE_TAP_MS = 300;

export function detectDoubleTap(action: "next" | "prev"): boolean;

export function installMediaSession(handlers: {
  play: () => void;
  pause: () => void;
  next: () => void;          // single tap of nexttrack
  prev: () => void;          // single tap of previoustrack
  nextFavorite: () => void;  // double tap of either
  prevFavorite: () => void;  // double tap of either (same effect as nextFavorite)
  getMetadata: () => MediaMetadata | null;
}): void;

export function setMetadata(meta: MediaMetadata | null): void;
```

`installMediaSession` is idempotent — calling it again re-binds handlers (useful when the user changes the current radio and we want fresh closures).

---

## Testing

### Unit tests (`radio-queue.test.ts`)

- `test_empty_queue_returns_null` — getNext/getPrev with `[]` → `null`
- `test_single_item_queue_wraps_to_self` — `getNext([42], 42)` → `42`
- `test_get_next_advances` — `getNext([1, 2, 3], 1)` → `2`
- `test_get_next_circular_wrap` — `getNext([1, 2, 3], 3)` → `1`
- `test_get_next_with_current_not_in_queue` — `getNext([1, 2], 99)` → `1`
- `test_get_next_null_current_returns_first` — `getNext([1, 2, 3], null)` → `1`
- `test_build_queue_dedupes_favorite_in_recents`
- `test_build_queue_filters_invalid_ids` — IDs not in `radiosById` are skipped
- `test_get_next_favorite_no_favorites_returns_null`
- `test_get_next_favorite_no_current_returns_first_fav`
- `test_get_next_favorite_circular_wrap`

### Unit tests (`media-session.test.ts`)

Mock `navigator.mediaSession`:

- `test_double_tap_within_threshold_returns_true`
- `test_no_double_tap_outside_threshold_returns_false`
- `test_different_actions_not_double_tap`
- `test_install_registers_all_action_handlers`
- `test_install_noop_when_api_unavailable`
- `test_set_metadata_updates_navigator`
- `test_set_metadata_null_clears_navigator`

### Manual smoke test (macOS Safari PWA)

1. Open `https://www.antena.com.ar` in macOS Safari
2. "Add to Dock" to install as PWA
3. Open the PWA from the Dock
4. Play a radio (e.g. Radio Mitre)
5. Verify macOS Now Playing widget shows: title=Radio Mitre, artist=Buenos Aires, album=Antena · 🇦🇷 Argentina, artwork=Antena favicon
6. Press F8 → pause; F8 again → play
7. Press F9 once → next station
8. Press F9 twice quickly (<300ms) → favorite
9. Press F7 once → previous station
10. Open Control Center → verify radio is there, test buttons
11. Lock screen → widget still works
12. AirPods single click → play/pause

### Out of automated testing

- Actual key press on physical Mac keyboard
- AirPods / Touch Bar interaction
- Now Playing widget rendering (depends on macOS version)
- Lock screen widget
- Control Center

These require manual testing on real hardware. The unit tests cover the logic; the hardware integration is best-effort.

---

## Migration plan

**Phase 1 — radio-queue.ts (TDD)**
1. Write failing tests
2. Implement functions
3. Verify tests pass
4. Commit

**Phase 2 — media-session.ts (TDD)**
1. Write failing tests
2. Implement wrapper
3. Verify tests pass
4. Commit

**Phase 3 — RadioPlayer.tsx integration**
1. Import modules
2. Add `installMediaSession` call in `selectRadio`
3. Add `createEffect` to update metadata on `current()` change
4. Pass `next`, `prev`, `nextFavorite` handlers backed by radio-queue
5. typecheck
6. Commit

**Phase 4 — manual verification**
1. Build Antena (`pnpm build`)
2. Open in macOS Safari PWA
3. Run the smoke test above
4. Fix any UX issues
5. Commit any fixes

**Phase 5 — deploy**
1. `pnpm deploy:staging` → smoke test
2. `pnpm deploy:prod` → verify in production

**Total: ~1.5 hours**

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| macOS doesn't show Now Playing widget | Low | Low | Requires "Add to Dock" PWA install. Document. |
| Double-tap confusion with single tap | Medium | Low | 300ms threshold, debounce, manual E2E |
| F7/F8/F9 conflict with browser shortcuts | High | Medium | macOS Safari already uses them as media keys. Document the keybinding. |
| Battery drain with long HLS streams | Low | Low | Same as today; not new. |
| `mediaSession` not available | Medium | Low | `if (!('mediaSession' in navigator)) return` graceful no-op |
| Race condition between double-tap and refresh | Low | Low | Signals are reset on `installMediaSession` (which is called again on mount) |
| User has 100+ favorites | Low | Low | `getNextFavorite` is O(N) but N is small (max ~50 expected) |
| Wrong artwork (favicon is small) | Low | Low | macOS scales it; 512x512 SVG works |

---

## Out of scope (YAGNI)

- ❌ Seeking on live streams (impossible)
- ❌ Per-radio artwork lookup
- ❌ Cross-device sync
- ❌ Windows / Linux testing
- ❌ Picture-in-picture
- ❌ Notification API on play start
- ❌ Lyrics / chapter support (N/A for radio)
- ❌ Audio Focus management (browser handles)

---

## Open questions

_None. All blocking decisions resolved during brainstorming 2026-06-18._
