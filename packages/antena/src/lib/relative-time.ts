// Human-readable relative time. "Hace 3m", "Hace 2h", "Hace 1d".
// Mirrors the format used in mappers.formatTime but takes an
// explicit `now` so the output is deterministic in tests.
//
// Returns "—" for null/empty/invalid input rather than throwing —
// callers use this to render the "updated X ago" hint next to the
// "estás al día" divider, where a crash on a malformed timestamp
// would be a worse UX than a missing timestamp.

export type RelativeUnit = "second" | "minute" | "hour" | "day";

const INVALID = "—";

export function formatRelativeFromIso(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return INVALID;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return INVALID;
  const diffMs = now - t;
  if (diffMs < 0) return INVALID; // future — clock skew
  const sec = Math.floor(diffMs / 1000);
  if (sec < 30) return "ahora";
  if (sec < 60 * 60) return `hace ${Math.floor(sec / 60)}m`;
  if (sec < 24 * 60 * 60) return `hace ${Math.floor(sec / 3600)}h`;
  return `hace ${Math.floor(sec / 86400)}d`;
}
