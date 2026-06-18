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
