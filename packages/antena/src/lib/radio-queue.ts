/**
 * Pure functions for the virtual radio navigation queue.
 *
 * The queue is the union of the user's favorites and recents, with favorites
 * taking priority. It's used by the macOS Media Session wrapper to translate
 * prev/next media-key events into actual radio selections.
 */

import type { Radio } from "../components/common/RadioPlayer";

/**
 * Structural minimum required from a radio entry. Production callers pass
 * `Map<number, Radio>`, but tests (and other light callers) can pass any map
 * of objects that have an `id: number`. The queue functions only ever call
 * `.has(id)`, so they don't need the full Radio shape.
 */
type RadioLookup = ReadonlyMap<number, { id: number }>;

/**
 * Build the navigation queue: favorites first, then recents (excluding
 * duplicates and IDs whose radio is no longer in the directory).
 */
export function buildQueue(
  favorites: number[],
  recents: number[],
  radiosById: RadioLookup,
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
  radiosById: RadioLookup,
): number | null {
  const validFavs = favorites.filter((id) => radiosById.has(id));
  if (validFavs.length === 0) return null;

  if (currentId === null) return validFavs[0];

  const idx = validFavs.indexOf(currentId);
  if (idx === -1) return validFavs[0];
  return validFavs[(idx + 1) % validFavs.length];
}
