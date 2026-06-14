// Recently-viewed history. Stores the full news card (not just
// the id) so the History view can render a list without an
// extra round-trip to the server. Capped at 50 entries so the
// localStorage payload stays small (< 50 KB even with
// generous summaries).

export interface HistoryEntry {
  id: string;
  title: string;
  summary: string;
  source: string;
  category: string;
  imageUrl?: string;
  publishedAt: string;
  /** Epoch ms. Used for the "visto hace X" relative time. */
  viewedAt: number;
}

const KEY = "antena-history";
const MAX = 50;

function isValid(v: unknown): v is HistoryEntry {
  if (v === null || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  if (typeof e.id !== "string" || e.id.length === 0) return false;
  if (typeof e.title !== "string") return false;
  if (typeof e.summary !== "string") return false;
  if (typeof e.source !== "string") return false;
  if (typeof e.category !== "string") return false;
  if (typeof e.publishedAt !== "string") return false;
  if (typeof e.viewedAt !== "number" || !Number.isFinite(e.viewedAt)) return false;
  return true;
}

export function readHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValid);
  } catch {
    return [];
  }
}

function writeAll(list: HistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}

export function writeHistory(list: HistoryEntry[]): void {
  writeAll(list.slice(0, MAX));
}

export function pushHistoryEntry(entry: HistoryEntry): void {
  if (!isValid(entry)) return;
  const cur = readHistory();
  const next = [entry, ...cur.filter((e) => e.id !== entry.id)].slice(0, MAX);
  writeAll(next);
}

export function clearHistory(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
