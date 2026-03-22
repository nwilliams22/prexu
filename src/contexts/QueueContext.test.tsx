import { describe, it, expect, beforeEach } from "vitest";
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
