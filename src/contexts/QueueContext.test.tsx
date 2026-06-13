import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueueProvider, useQueue } from "./QueueContext";
import type { QueueItem } from "../types/queue";
import type { ReactNode } from "react";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueueProvider>{children}</QueueProvider>
);

const makeItem = (key: string, title: string): QueueItem => ({
  ratingKey: key,
  title,
  subtitle: `Episode ${key}`,
  thumb: "/thumb",
  duration: 1800000,
  type: "episode",
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("QueueContext — localStorage validation", () => {
  const STORAGE_KEY = "prexu_playback_queue";

  it("falls back to empty queue when localStorage contains invalid JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not valid json{{{");
    const { result } = renderHook(() => useQueue(), { wrapper });
    expect(result.current.queue.items).toHaveLength(0);
    expect(result.current.queue.currentIndex).toBe(-1);
  });

  it("falls back to empty queue when stored data is missing items array", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentIndex: 0 }));
    const { result } = renderHook(() => useQueue(), { wrapper });
    expect(result.current.queue.items).toHaveLength(0);
  });

  it("falls back to empty queue when items contains entries with missing fields", () => {
    const malformed = {
      items: [{ ratingKey: "1", title: "A" }], // missing subtitle/thumb/duration/type
      currentIndex: 0,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(malformed));
    const { result } = renderHook(() => useQueue(), { wrapper });
    expect(result.current.queue.items).toHaveLength(0);
  });

  it("falls back to empty queue when item type is not movie or episode", () => {
    const malformed = {
      items: [{ ratingKey: "1", title: "A", subtitle: "S", thumb: "/t", duration: 1000, type: "album" }],
      currentIndex: 0,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(malformed));
    const { result } = renderHook(() => useQueue(), { wrapper });
    expect(result.current.queue.items).toHaveLength(0);
  });

  it("restores a valid persisted queue", () => {
    const valid = {
      items: [makeItem("1", "A"), makeItem("2", "B")],
      currentIndex: 1,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
    const { result } = renderHook(() => useQueue(), { wrapper });
    expect(result.current.queue.items).toHaveLength(2);
    expect(result.current.queue.currentIndex).toBe(1);
  });
});

describe("QueueContext", () => {
  it("starts with empty queue", () => {
    const { result } = renderHook(() => useQueue(), { wrapper });
    expect(result.current.queue.items).toHaveLength(0);
    expect(result.current.queue.currentIndex).toBe(-1);
  });

  it("sets queue with items", () => {
    const { result } = renderHook(() => useQueue(), { wrapper });
    const items = [makeItem("1", "A"), makeItem("2", "B"), makeItem("3", "C")];
    act(() => result.current.setQueue(items, 0));

    expect(result.current.queue.items).toHaveLength(3);
    expect(result.current.queue.currentIndex).toBe(0);
    expect(result.current.remainingCount).toBe(2);
  });

  it("adds item to queue", () => {
    const { result } = renderHook(() => useQueue(), { wrapper });
    act(() => result.current.setQueue([makeItem("1", "A")], 0));
    act(() => result.current.addToQueue(makeItem("2", "B")));

    expect(result.current.queue.items).toHaveLength(2);
  });

  it("removes item from queue", () => {
    const { result } = renderHook(() => useQueue(), { wrapper });
    act(() => result.current.setQueue([makeItem("1", "A"), makeItem("2", "B"), makeItem("3", "C")], 0));
    act(() => result.current.removeFromQueue(1));

    expect(result.current.queue.items).toHaveLength(2);
    expect(result.current.queue.items[1].ratingKey).toBe("3");
  });

  it("plays next item", () => {
    const { result } = renderHook(() => useQueue(), { wrapper });
    act(() => result.current.setQueue([makeItem("1", "A"), makeItem("2", "B")], 0));

    let next: QueueItem | null = null;
    act(() => { next = result.current.playNext(); });
    expect(next?.ratingKey).toBe("2");
    expect(result.current.queue.currentIndex).toBe(1);
  });

  it("returns null when no more items to play", () => {
    const { result } = renderHook(() => useQueue(), { wrapper });
    act(() => result.current.setQueue([makeItem("1", "A")], 0));

    let next: QueueItem | null = null;
    act(() => { next = result.current.playNext(); });
    expect(next).toBeNull();
  });

  it("plays previous item", () => {
    const { result } = renderHook(() => useQueue(), { wrapper });
    act(() => result.current.setQueue([makeItem("1", "A"), makeItem("2", "B")], 1));

    let prev: QueueItem | null = null;
    act(() => { prev = result.current.playPrev(); });
    expect(prev?.ratingKey).toBe("1");
    expect(result.current.queue.currentIndex).toBe(0);
  });

  it("reorders items", () => {
    const { result } = renderHook(() => useQueue(), { wrapper });
    act(() => result.current.setQueue([makeItem("1", "A"), makeItem("2", "B"), makeItem("3", "C")], 0));
    act(() => result.current.reorderQueue(2, 0));

    expect(result.current.queue.items[0].ratingKey).toBe("3");
    expect(result.current.queue.items[1].ratingKey).toBe("1");
    expect(result.current.queue.items[2].ratingKey).toBe("2");
  });

  it("clears queue", () => {
    const { result } = renderHook(() => useQueue(), { wrapper });
    act(() => result.current.setQueue([makeItem("1", "A")], 0));
    act(() => result.current.clearQueue());

    expect(result.current.queue.items).toHaveLength(0);
    expect(result.current.queue.currentIndex).toBe(-1);
  });
});
