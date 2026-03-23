import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { QueueItem, PlaybackQueue } from "../types/queue";

interface QueueContextValue {
  queue: PlaybackQueue;
  /** Replace the entire queue and set current index */
  setQueue: (items: QueueItem[], startIndex: number, shuffled?: boolean) => void;
  /** Append an item to the end of the queue */
  addToQueue: (item: QueueItem) => void;
  /** Remove an item by index */
  removeFromQueue: (index: number) => void;
  /** Move an item from one position to another */
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  /** Advance to the next item. Returns the next QueueItem or null if exhausted. */
  playNext: () => QueueItem | null;
  /** Go to the previous item. Returns the QueueItem or null if at start. */
  playPrev: () => QueueItem | null;
  /** Clear the queue entirely */
  clearQueue: () => void;
  /** Number of items remaining after current index */
  remainingCount: number;
}

const STORAGE_KEY = "prexu_playback_queue";

const emptyQueue: PlaybackQueue = { items: [], currentIndex: -1 };

function loadQueue(): PlaybackQueue {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {
    // ignore parse errors
  }
  return emptyQueue;
}

function persistQueue(queue: PlaybackQueue) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // ignore quota errors
  }
}

const QueueContext = createContext<QueueContextValue | null>(null);

export function QueueProvider({ children }: { children: ReactNode }) {
  const [queue, setQueueState] = useState<PlaybackQueue>(loadQueue);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const setQueueAndPersist = useCallback((q: PlaybackQueue) => {
    queueRef.current = q;
    setQueueState(q);
    persistQueue(q);
  }, []);

  const setQueue = useCallback(
    (items: QueueItem[], startIndex: number, shuffled?: boolean) => {
      setQueueAndPersist({ items, currentIndex: startIndex, shuffled });
    },
    [setQueueAndPersist],
  );

  const addToQueue = useCallback(
    (item: QueueItem) => {
      setQueueState((prev) => {
        const next = { ...prev, items: [...prev.items, item] };
        persistQueue(next);
        return next;
      });
    },
    [],
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      setQueueState((prev) => {
        const items = prev.items.filter((_, i) => i !== index);
        let currentIndex = prev.currentIndex;
        if (index < currentIndex) currentIndex--;
        else if (index === currentIndex) currentIndex = Math.min(currentIndex, items.length - 1);
        const next = { items, currentIndex };
        persistQueue(next);
        return next;
      });
    },
    [],
  );

  const reorderQueue = useCallback(
    (fromIndex: number, toIndex: number) => {
      setQueueState((prev) => {
        const items = [...prev.items];
        const [moved] = items.splice(fromIndex, 1);
        items.splice(toIndex, 0, moved);
        // Adjust currentIndex if needed
        let ci = prev.currentIndex;
        if (fromIndex === ci) ci = toIndex;
        else if (fromIndex < ci && toIndex >= ci) ci--;
        else if (fromIndex > ci && toIndex <= ci) ci++;
        const next = { items, currentIndex: ci };
        persistQueue(next);
        return next;
      });
    },
    [],
  );

  const playNext = useCallback((): QueueItem | null => {
    const prev = queueRef.current;
    const nextIdx = prev.currentIndex + 1;
    if (nextIdx >= prev.items.length) return null;
    const nextItem = prev.items[nextIdx];
    setQueueAndPersist({ ...prev, currentIndex: nextIdx });
    return nextItem;
  }, [setQueueAndPersist]);

  const playPrev = useCallback((): QueueItem | null => {
    const prev = queueRef.current;
    const prevIdx = prev.currentIndex - 1;
    if (prevIdx < 0) return null;
    const prevItem = prev.items[prevIdx];
    setQueueAndPersist({ ...prev, currentIndex: prevIdx });
    return prevItem;
  }, [setQueueAndPersist]);

  const clearQueue = useCallback(() => {
    setQueueAndPersist(emptyQueue);
  }, [setQueueAndPersist]);

  const remainingCount = useMemo(
    () =>
      queue.currentIndex >= 0
        ? Math.max(0, queue.items.length - queue.currentIndex - 1)
        : queue.items.length,
    [queue],
  );

  const value = useMemo<QueueContextValue>(
    () => ({
      queue,
      setQueue,
      addToQueue,
      removeFromQueue,
      reorderQueue,
      playNext,
      playPrev,
      clearQueue,
      remainingCount,
    }),
    [queue, setQueue, addToQueue, removeFromQueue, reorderQueue, playNext, playPrev, clearQueue, remainingCount],
  );

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useQueue(): QueueContextValue {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error("useQueue must be used within a QueueProvider");
  return ctx;
}
