// Saved searches — queries the user has explicitly saved from
// the /buscar page. Persisted to localStorage, capped at 10,
// deduped by (q, filters) so changing a filter on the same
// query creates a separate entry.

export type SearchTimeFilter = "hour" | "today" | "week" | "all";

export interface SearchFilters {
  category?: string;
  time?: SearchTimeFilter;
}

export interface SavedSearch {
  q: string;
  filters: SearchFilters;
  savedAt: string;
}

const KEY = "antena-saved-searches";
const MAX = 10;

function isValidFilters(v: unknown): v is SearchFilters {
  if (v === null || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  if (f.category !== undefined && typeof f.category !== "string") return false;
  if (f.time !== undefined && !["hour", "today", "week", "all"].includes(f.time as string)) return false;
  return true;
}

function isValidSaved(v: unknown): v is SavedSearch {
  if (v === null || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (typeof s.q !== "string" || s.q.length === 0) return false;
  if (typeof s.savedAt !== "string") return false;
  if (!isValidFilters(s.filters)) return false;
  return true;
}

export function readSavedSearches(): SavedSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSaved);
  } catch {
    return [];
  }
}

function writeAll(list: SavedSearch[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}

export function writeSavedSearches(list: SavedSearch[]): void {
  writeAll(list.slice(0, MAX));
}

export function pushSavedSearch(item: SavedSearch): void {
  const cur = readSavedSearches();
  // Dedup by (q, filters). Re-pushing moves to top.
  const filtered = cur.filter((s) => !sameKey(s, item));
  const next = [item, ...filtered].slice(0, MAX);
  writeAll(next);
}

export function removeSavedSearch(match: { q: string; filters: SearchFilters }): void {
  const cur = readSavedSearches();
  const next = cur.filter((s) => !sameKey(s, match));
  writeAll(next);
}

function sameKey(a: { q: string; filters: SearchFilters }, b: { q: string; filters: SearchFilters }): boolean {
  return a.q === b.q
    && (a.filters.category ?? "") === (b.filters.category ?? "")
    && (a.filters.time ?? "all") === (b.filters.time ?? "all");
}
