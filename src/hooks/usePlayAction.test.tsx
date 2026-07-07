import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { usePlayAction } from "./usePlayAction";
import { emitWatchStateChanged } from "../services/watch-state-events";
import type { PlexMediaItem } from "../types/library";

const mockPlay = vi.fn();
vi.mock("../contexts/PlayerContext", () => ({
  usePlayerSession: () => ({
    session: null,
    play: mockPlay,
    stop: vi.fn(),
    replaceRatingKey: vi.fn(),
    updateSession: vi.fn(),
  }),
}));

vi.mock("./useAuth", () => ({
  useAuth: () => ({
    server: { uri: "https://plex.test", accessToken: "token" },
  }),
}));

const mockGetItemMetadata = vi.fn();
vi.mock("../services/plex-library", () => ({
  getItemMetadata: (...args: unknown[]) => mockGetItemMetadata(...args),
}));

function makeMovie(overrides: Partial<PlexMediaItem & { viewOffset?: number }> = {}) {
  return {
    ratingKey: "1",
    title: "Test Movie",
    type: "movie",
    thumb: "/t",
    addedAt: 0,
    ...overrides,
  } as PlexMediaItem;
}

function makeClickEvent(): React.MouseEvent {
  return {
    stopPropagation: vi.fn(),
    clientX: 100,
    clientY: 200,
  } as unknown as React.MouseEvent;
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

describe("usePlayAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses cached viewOffset to show ResumePopover instantly without fetching", async () => {
    const { result } = renderHook(() => usePlayAction(), { wrapper });
    const item = makeMovie({ viewOffset: 60_000 });

    const handler = result.current.getPlayHandler(item);
    expect(handler).toBeDefined();

    act(() => {
      handler!(makeClickEvent());
    });

    // No network call should have happened
    expect(mockGetItemMetadata).not.toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
    // Popover content should now be present
    expect(result.current.playOverlay).not.toBeNull();
  });

  it("navigates immediately when no cached offset and metadata says viewOffset=0", async () => {
    mockGetItemMetadata.mockResolvedValue({ viewOffset: 0 });
    const { result } = renderHook(() => usePlayAction(), { wrapper });
    const item = makeMovie({ viewOffset: 0 });

    act(() => {
      result.current.getPlayHandler(item)!(makeClickEvent());
    });

    await waitFor(() => {
      expect(mockPlay).toHaveBeenCalledWith("1");
    });
  });

  it("shows loading popover during fetch when no cached offset is present", () => {
    let resolveMeta: (val: unknown) => void = () => {};
    mockGetItemMetadata.mockReturnValue(
      new Promise((resolve) => {
        resolveMeta = resolve;
      }),
    );

    const { result } = renderHook(() => usePlayAction(), { wrapper });
    const item = makeMovie({ viewOffset: 0 });

    act(() => {
      result.current.getPlayHandler(item)!(makeClickEvent());
    });

    // While fetch is pending, an overlay should be rendered (the loading state)
    expect(result.current.playOverlay).not.toBeNull();

    // Drain the pending promise to keep test runner clean
    act(() => {
      resolveMeta({ viewOffset: 0 });
    });
  });

  it("falls back to direct navigation when getItemMetadata throws", async () => {
    mockGetItemMetadata.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => usePlayAction(), { wrapper });
    const item = makeMovie({ viewOffset: 0 });

    act(() => {
      result.current.getPlayHandler(item)!(makeClickEvent());
    });

    await waitFor(() => {
      expect(mockPlay).toHaveBeenCalledWith("1");
    });
  });

  it("returns undefined for non-playable item types", () => {
    const { result } = renderHook(() => usePlayAction(), { wrapper });
    const showItem = makeMovie({ type: "show" });
    expect(result.current.getPlayHandler(showItem)).toBeUndefined();
  });

  // prexu-0szx.13: getPlayHandler(item) used to return a brand-new closure
  // on every call, so every PosterCard call site's `onPlay={getPlayHandler(item)}`
  // handed React.memo a "changed" prop on every render regardless of
  // anything else. The fix caches one handler per ratingKey.
  describe("handler identity stability (prexu-0szx.13)", () => {
    it("returns the SAME handler for the same ratingKey across renders", () => {
      const { result, rerender } = renderHook(() => usePlayAction(), { wrapper });
      const item = makeMovie({ ratingKey: "1" });

      const first = result.current.getPlayHandler(item);
      rerender();
      const second = result.current.getPlayHandler(item);

      expect(first).toBeDefined();
      expect(second).toBe(first);
    });

    it("returns DIFFERENT handlers for different ratingKeys", () => {
      const { result } = renderHook(() => usePlayAction(), { wrapper });
      const a = result.current.getPlayHandler(makeMovie({ ratingKey: "1" }));
      const b = result.current.getPlayHandler(makeMovie({ ratingKey: "2" }));
      expect(a).not.toBe(b);
    });

    it("reads fresh item data (e.g. an updated viewOffset) even though the handler identity stays the same", async () => {
      const { result, rerender } = renderHook(() => usePlayAction(), { wrapper });

      // First render: no cached offset yet.
      const handler = result.current.getPlayHandler(makeMovie({ ratingKey: "1", viewOffset: 0 }));
      mockGetItemMetadata.mockResolvedValue({ viewOffset: 0 });
      act(() => {
        handler!(makeClickEvent());
      });
      await waitFor(() => expect(mockPlay).toHaveBeenCalledWith("1"));
      mockPlay.mockClear();
      mockGetItemMetadata.mockClear();

      // Parent re-renders with an updated item (viewOffset now populated) —
      // getPlayHandler returns the SAME cached closure identity...
      rerender();
      const sameHandler = result.current.getPlayHandler(
        makeMovie({ ratingKey: "1", viewOffset: 60_000 }),
      );
      expect(sameHandler).toBe(handler);

      // ...but invoking it uses the LATEST item data, not what was
      // captured when the handler was first created.
      act(() => {
        sameHandler!(makeClickEvent());
      });
      expect(mockGetItemMetadata).not.toHaveBeenCalled();
      expect(result.current.playOverlay).not.toBeNull();
    });
  });

  describe("watch-state events patch the item cache (prexu-r8ib)", () => {
    it("popover shows the stop-time offset even when no re-render refreshed the item", () => {
      const { result } = renderHook(() => usePlayAction(), { wrapper });
      const item = makeMovie({ viewOffset: 821_287 });
      // Render-time registration (memoized card chain never re-renders after
      // a viewOffset-only state change, so this is the ONLY registration).
      const handler = result.current.getPlayHandler(item)!;

      act(() => {
        emitWatchStateChanged("1", { viewOffsetMs: 860_318 });
      });
      act(() => {
        handler(makeClickEvent());
      });

      const overlay = result.current.playOverlay as React.ReactElement<{
        viewOffset: number;
      }>;
      expect(overlay).not.toBeNull();
      expect(overlay.props.viewOffset).toBe(860_318);
      expect(mockGetItemMetadata).not.toHaveBeenCalled();
    });

    it("reset events zero the cached offset so the click plays from the start", async () => {
      mockGetItemMetadata.mockResolvedValue({ viewOffset: 0 });
      const { result } = renderHook(() => usePlayAction(), { wrapper });
      const item = makeMovie({ viewOffset: 821_287 });
      const handler = result.current.getPlayHandler(item)!;

      act(() => {
        emitWatchStateChanged("1", { viewOffsetMs: 0, reset: true });
      });
      act(() => {
        handler(makeClickEvent());
      });

      await waitFor(() => {
        expect(mockPlay).toHaveBeenCalledWith("1");
      });
    });

    it("ignores events for other ratingKeys", () => {
      const { result } = renderHook(() => usePlayAction(), { wrapper });
      const item = makeMovie({ viewOffset: 821_287 });
      const handler = result.current.getPlayHandler(item)!;

      act(() => {
        emitWatchStateChanged("999", { viewOffsetMs: 5 });
      });
      act(() => {
        handler(makeClickEvent());
      });

      const overlay = result.current.playOverlay as React.ReactElement<{
        viewOffset: number;
      }>;
      expect(overlay.props.viewOffset).toBe(821_287);
    });

    it("stops patching after unmount", () => {
      const { result, unmount } = renderHook(() => usePlayAction(), {
        wrapper,
      });
      result.current.getPlayHandler(makeMovie({ viewOffset: 1 }));
      unmount();
      expect(() => {
        act(() => {
          emitWatchStateChanged("1", { viewOffsetMs: 2 });
        });
      }).not.toThrow();
    });
  });
});
