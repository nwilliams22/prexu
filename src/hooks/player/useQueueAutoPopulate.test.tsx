/**
 * Tests for useQueueAutoPopulate.
 *
 * Covers:
 *   - Happy path: fetches season episodes and populates queue
 *   - Immediate stale-queue clear on new ratingKey (BUG 1 regression)
 *   - Cross-season append when playing the last episode (BUG 2 fix)
 *   - Skips re-population when ratingKey already in queue
 *   - Non-episode types are ignored
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueueProvider, useQueue } from "../../contexts/QueueContext";
import { useQueueAutoPopulate } from "./useQueueAutoPopulate";
import type { ReactNode } from "react";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

const mockGetItemMetadata = vi.fn();
const mockGetItemChildren = vi.fn();

vi.mock("../../services/plex-library", () => ({
  getItemMetadata: (...args: unknown[]) => mockGetItemMetadata(...args),
}));

vi.mock("../../services/plex-library/detail", () => ({
  getItemChildren: (...args: unknown[]) => mockGetItemChildren(...args),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEp(overrides: {
  ratingKey: string;
  index: number;
  parentIndex?: number;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
}) {
  return {
    ratingKey: overrides.ratingKey,
    key: `/library/metadata/${overrides.ratingKey}`,
    type: "episode" as const,
    title: `Episode ${overrides.index}`,
    summary: "",
    thumb: "/ep-thumb",
    art: "",
    addedAt: 0,
    updatedAt: 0,
    index: overrides.index,
    parentIndex: overrides.parentIndex ?? 1,
    parentRatingKey: overrides.parentRatingKey ?? "season-1",
    grandparentRatingKey: overrides.grandparentRatingKey ?? "show-1",
    grandparentTitle: "Test Show",
    grandparentThumb: "/show-thumb",
    grandparentArt: "",
    parentTitle: "Season 1",
    year: 2024,
    contentRating: "TV-14",
    duration: 2400000,
    originallyAvailableAt: "2024-01-01",
  };
}

function makeSeason(ratingKey: string, index: number) {
  return {
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    type: "season" as const,
    title: `Season ${index}`,
    summary: "",
    thumb: "/season-thumb",
    art: "",
    addedAt: 0,
    updatedAt: 0,
    index,
    parentRatingKey: "show-1",
    parentTitle: "Test Show",
    leafCount: 10,
    viewedLeafCount: 0,
    parentThumb: "/show-thumb",
  };
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueueProvider>{children}</QueueProvider>
);

// Composite hook so we can observe both useQueueAutoPopulate's side effects
// and useQueue's state in a single renderHook.
function useSubject(args: {
  serverUri: string | undefined;
  serverToken: string | undefined;
  ratingKey: string | undefined;
  itemType: string | undefined;
}) {
  useQueueAutoPopulate(args.serverUri, args.serverToken, args.ratingKey, args.itemType);
  return useQueue();
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("useQueueAutoPopulate", () => {
  describe("basic population", () => {
    it("populates queue with remaining season episodes when ratingKey is not in queue", async () => {
      const s1e1 = makeEp({ ratingKey: "ep-1", index: 1 });
      const s1e2 = makeEp({ ratingKey: "ep-2", index: 2 });
      const s1e3 = makeEp({ ratingKey: "ep-3", index: 3 });

      mockGetItemMetadata.mockResolvedValueOnce(s1e1);
      mockGetItemChildren.mockResolvedValueOnce([s1e1, s1e2, s1e3]);

      const { result } = renderHook(
        () => useSubject({ serverUri: "https://plex", serverToken: "tok", ratingKey: "ep-1", itemType: "episode" }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.queue.items).toHaveLength(3);
      });

      expect(result.current.queue.items[0].ratingKey).toBe("ep-1");
      expect(result.current.queue.items[1].ratingKey).toBe("ep-2");
      expect(result.current.queue.items[2].ratingKey).toBe("ep-3");
      expect(result.current.queue.currentIndex).toBe(0);
      expect(result.current.queue.source).toBe("auto-episodes");
    });

    it("does nothing for non-episode itemType", async () => {
      const { result } = renderHook(
        () => useSubject({ serverUri: "https://plex", serverToken: "tok", ratingKey: "movie-1", itemType: "movie" }),
        { wrapper },
      );

      await act(async () => { await Promise.resolve(); });

      expect(mockGetItemMetadata).not.toHaveBeenCalled();
      expect(result.current.queue.items).toHaveLength(0);
    });
  });

  describe("stale-queue clear (BUG 1 regression)", () => {
    it("immediately clears a stale queue when a new ratingKey is not in the queue", async () => {
      // Simulate a stale queue from a previous session (persisted in localStorage).
      // On initial render the stale queue should be cleared synchronously before
      // the async fetch resolves so hasNextItem sees an empty queue.
      const staleItems = [
        { ratingKey: "old-ep-1", title: "Old", subtitle: "", thumb: "", duration: 0, type: "episode" as const },
        { ratingKey: "old-ep-2", title: "Old 2", subtitle: "", thumb: "", duration: 0, type: "episode" as const },
      ];
      localStorage.setItem(
        "prexu_playback_queue",
        JSON.stringify({ items: staleItems, currentIndex: 0, source: "auto-episodes" }),
      );

      // Delay the metadata fetch so we can observe the intermediate state.
      let resolveMeta!: (v: unknown) => void;
      mockGetItemMetadata.mockReturnValueOnce(new Promise((r) => { resolveMeta = r; }));

      const { result } = renderHook(
        () => useSubject({ serverUri: "https://plex", serverToken: "tok", ratingKey: "new-ep-1", itemType: "episode" }),
        { wrapper },
      );

      // The stale queue is loaded from localStorage initially, but the hook
      // should clear it synchronously before the fetch resolves.
      await waitFor(() => {
        expect(result.current.queue.items).toHaveLength(0);
      });
      expect(result.current.queue.currentIndex).toBe(-1);

      // Now let the fetch resolve so the test doesn't leak.
      const ep = makeEp({ ratingKey: "new-ep-1", index: 1 });
      resolveMeta(ep);
      mockGetItemChildren.mockResolvedValueOnce([ep]);

      await waitFor(() => {
        expect(result.current.queue.items).toHaveLength(1);
      });
    });
  });

  describe("cross-season append (BUG 2 fix)", () => {
    it("appends next season episodes when current episode is the last in its season", async () => {
      const s1e5 = makeEp({ ratingKey: "s1e5", index: 5, parentRatingKey: "season-1" });
      const s2e1 = makeEp({ ratingKey: "s2e1", index: 1, parentIndex: 2, parentRatingKey: "season-2" });
      const s2e2 = makeEp({ ratingKey: "s2e2", index: 2, parentIndex: 2, parentRatingKey: "season-2" });

      mockGetItemMetadata.mockResolvedValueOnce(s1e5);
      // First call: season-1 episodes (only s1e5 = last in season)
      mockGetItemChildren.mockResolvedValueOnce([s1e5]);
      // Second call: show's seasons
      mockGetItemChildren.mockResolvedValueOnce([
        makeSeason("season-1", 1),
        makeSeason("season-2", 2),
      ]);
      // Third call: season-2 episodes
      mockGetItemChildren.mockResolvedValueOnce([s2e1, s2e2]);

      const { result } = renderHook(
        () => useSubject({ serverUri: "https://plex", serverToken: "tok", ratingKey: "s1e5", itemType: "episode" }),
        { wrapper },
      );

      await waitFor(() => {
        // s1e5 + s2e1 + s2e2
        expect(result.current.queue.items).toHaveLength(3);
      });

      expect(result.current.queue.items[0].ratingKey).toBe("s1e5");
      expect(result.current.queue.items[1].ratingKey).toBe("s2e1");
      expect(result.current.queue.items[2].ratingKey).toBe("s2e2");
      // currentIndex=0 → queueHasNext=true → hasNextItem works correctly
      expect(result.current.queue.currentIndex).toBe(0);
    });

    it("does NOT append next season when there are more episodes remaining in the current season", async () => {
      const s1e1 = makeEp({ ratingKey: "s1e1", index: 1, parentRatingKey: "season-1" });
      const s1e2 = makeEp({ ratingKey: "s1e2", index: 2, parentRatingKey: "season-1" });

      mockGetItemMetadata.mockResolvedValueOnce(s1e1);
      mockGetItemChildren.mockResolvedValueOnce([s1e1, s1e2]);

      const { result } = renderHook(
        () => useSubject({ serverUri: "https://plex", serverToken: "tok", ratingKey: "s1e1", itemType: "episode" }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.queue.items).toHaveLength(2);
      });

      // Only one getItemChildren call — no season lookup
      expect(mockGetItemChildren).toHaveBeenCalledTimes(1);
    });

    it("does not append when current season is the last season", async () => {
      const s2e3 = makeEp({ ratingKey: "s2e3", index: 3, parentIndex: 2, parentRatingKey: "season-2" });

      mockGetItemMetadata.mockResolvedValueOnce(s2e3);
      mockGetItemChildren.mockResolvedValueOnce([s2e3]);
      // seasons: only season-2
      mockGetItemChildren.mockResolvedValueOnce([makeSeason("season-2", 2)]);

      const { result } = renderHook(
        () => useSubject({ serverUri: "https://plex", serverToken: "tok", ratingKey: "s2e3", itemType: "episode" }),
        { wrapper },
      );

      await waitFor(() => {
        expect(result.current.queue.items).toHaveLength(1);
      });

      expect(result.current.queue.items[0].ratingKey).toBe("s2e3");
    });
  });

  describe("re-population guard", () => {
    it("updates currentIndex instead of re-fetching when ratingKey is already in the queue", async () => {
      const s1e1 = makeEp({ ratingKey: "s1e1", index: 1 });
      const s1e2 = makeEp({ ratingKey: "s1e2", index: 2 });

      // Pre-populate queue with both episodes, currentIndex at 0
      mockGetItemMetadata.mockResolvedValueOnce(s1e1);
      mockGetItemChildren.mockResolvedValueOnce([s1e1, s1e2]);

      const { result, rerender } = renderHook(
        (props: { ratingKey: string }) =>
          useSubject({ serverUri: "https://plex", serverToken: "tok", ratingKey: props.ratingKey, itemType: "episode" }),
        { wrapper, initialProps: { ratingKey: "s1e1" } },
      );

      await waitFor(() => {
        expect(result.current.queue.items).toHaveLength(2);
      });

      vi.clearAllMocks();

      // Advance to s1e2 — it's already in the queue, should only update currentIndex
      act(() => {
        result.current.playNext();
      });
      rerender({ ratingKey: "s1e2" });

      await waitFor(() => {
        expect(result.current.queue.currentIndex).toBe(1);
      });

      // No new API calls — guard fired
      expect(mockGetItemMetadata).not.toHaveBeenCalled();
      expect(mockGetItemChildren).not.toHaveBeenCalled();
    });
  });
});
