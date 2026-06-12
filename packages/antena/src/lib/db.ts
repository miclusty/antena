import { openDB, type DBSchema } from "idb";

interface AntenaDB extends DBSchema {
  news: {
    key: string;
    value: {
      id: string;
      title: string;
      summary: string;
      category: string;
      source_name: string;
      published_at: string;
      cached_at: number;
    };
    indexes: { "by-published": string };
  };
  settings: {
    key: string;
    value: { theme: string; city_id: number | null };
  };
  bookmarks: {
    key: string;
    value: { newsId: string; savedAt: number };
  };
}

const DB_NAME = "antena-db";
const DB_VERSION = 1;

async function getDB() {
  return openDB<AntenaDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("news")) {
        const store = db.createObjectStore("news", { keyPath: "id" });
        store.createIndex("by-published", "published_at");
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("bookmarks")) {
        db.createObjectStore("bookmarks", { keyPath: "newsId" });
      }
    }
  });
}

export async function cacheNews(newsItems: any[]) {
  const db = await getDB();
  const tx = db.transaction("news", "readwrite");
  await Promise.all(newsItems.map((item) => tx.store.put({ ...item, cached_at: Date.now() })));
  await tx.done;
}

export async function getCachedNews(limit = 20) {
  const db = await getDB();
  return db.getAll("news", undefined, limit);
}

const READ_HISTORY_KEY = 'antena-read';
const READ_MAX_ITEMS = 500;

function getReadIds(): string[] {
  try {
    const raw = localStorage.getItem(READ_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function markAsRead(id: string): void {
  try {
    const ids = getReadIds().filter(i => i !== id);
    ids.unshift(id);
    if (ids.length > READ_MAX_ITEMS) ids.pop();
    localStorage.setItem(READ_HISTORY_KEY, JSON.stringify(ids));
  } catch {}
}

export function isRead(id: string): boolean {
  return getReadIds().includes(id);
}
