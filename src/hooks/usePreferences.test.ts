import { StrictMode, createElement, type ReactNode } from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { getDefaultPreferences } from "../services/storage/preferences";
import { usePreferencesState } from "./usePreferences";

// Mock storage
vi.mock("../services/storage", () => ({
  getDefaultPreferences: vi.fn(),
  getPreferences: vi.fn(),
  savePreferences: vi.fn(),
  getUserPreferences: vi.fn(),
  saveUserPreferences: vi.fn(),
}));

import * as storage from "../services/storage";
const mockStorage = vi.mocked(storage);

const defaultPrefs = getDefaultPreferences();

describe("usePreferencesState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getDefaultPreferences.mockReturnValue({ ...defaultPrefs });
    mockStorage.getPreferences.mockResolvedValue({ ...defaultPrefs });
    mockStorage.getUserPreferences.mockResolvedValue({ ...defaultPrefs });
  });

  it("initializes with default preferences", async () => {
    const { result } = renderHook(() => usePreferencesState());
    expect(result.current.preferences.playback.quality).toBe("1080p");
    expect(result.current.preferences.appearance.posterSize).toBe("medium");
  });

  it("loads global preferences when no userId", async () => {
    const customPrefs = {
      ...defaultPrefs,
      playback: { ...defaultPrefs.playback, quality: "720p" as const },
    };
    mockStorage.getPreferences.mockResolvedValue(customPrefs);

    const { result } = renderHook(() => usePreferencesState());

    await waitFor(() => {
      expect(result.current.preferences.playback.quality).toBe("720p");
    });

    expect(mockStorage.getPreferences).toHaveBeenCalled();
  });

  it("loads user-specific preferences when userId is provided", async () => {
    const userPrefs = {
      ...defaultPrefs,
      playback: { ...defaultPrefs.playback, quality: "480p" as const },
    };
    mockStorage.getUserPreferences.mockResolvedValue(userPrefs);

    const { result } = renderHook(() => usePreferencesState(42));

    await waitFor(() => {
      expect(result.current.preferences.playback.quality).toBe("480p");
    });

    expect(mockStorage.getUserPreferences).toHaveBeenCalledWith(42);
  });

  it("updatePreferences() deep-merges partial updates", async () => {
    const { result } = renderHook(() => usePreferencesState());

    await act(async () => {});
    act(() => {
      result.current.updatePreferences({
        playback: { quality: "720p" },
      });
    });

    // Quality should be updated
    expect(result.current.preferences.playback.quality).toBe("720p");
    // Other playback fields preserved
    expect(result.current.preferences.playback.subtitleSize).toBe(100);
    // Appearance untouched
    expect(result.current.preferences.appearance.posterSize).toBe("medium");
  });

  it("updatePreferences() deep merges dashboardSections", async () => {
    const { result } = renderHook(() => usePreferencesState());

    await act(async () => {});
    act(() => {
      result.current.updatePreferences({
        appearance: { dashboardSections: { continueWatching: false } },
      });
    });

    expect(result.current.preferences.appearance.dashboardSections.continueWatching).toBe(false);
    // Other dashboard sections preserved
    expect(result.current.preferences.appearance.dashboardSections.recentMovies).toBe(true);
    expect(result.current.preferences.appearance.dashboardSections.recentShows).toBe(true);
  });

  it("updatePreferences() saves to global when no userId", async () => {
    const { result } = renderHook(() => usePreferencesState());

    await act(async () => {});
    act(() => {
      result.current.updatePreferences({ playback: { quality: "480p" } });
    });

    await act(async () => {});
    expect(mockStorage.savePreferences).toHaveBeenCalled();
    await act(async () => {});
    expect(mockStorage.saveUserPreferences).not.toHaveBeenCalled();
  });

  it("updatePreferences() saves to user key when userId provided", async () => {
    const { result } = renderHook(() => usePreferencesState(42));

    await act(async () => {});
    act(() => {
      result.current.updatePreferences({ playback: { quality: "480p" } });
    });

    await act(async () => {});
    expect(mockStorage.saveUserPreferences).toHaveBeenCalledWith(42, expect.any(Object));
    await act(async () => {});
    expect(mockStorage.savePreferences).not.toHaveBeenCalled();
  });

  it("resetPreferences() resets to defaults", async () => {
    const { result } = renderHook(() => usePreferencesState());

    // Change something first
    await act(async () => {});
    act(() => {
      result.current.updatePreferences({ playback: { quality: "480p" } });
    });
    expect(result.current.preferences.playback.quality).toBe("480p");

    // Reset
    await act(async () => {});
    act(() => {
      result.current.resetPreferences();
    });

    expect(result.current.preferences.playback.quality).toBe("1080p");
    await act(async () => {});
    expect(mockStorage.savePreferences).toHaveBeenCalled();
  });

  it("resetPreferences() saves to user key when userId provided", async () => {
    mockStorage.getUserPreferences.mockResolvedValue({ ...defaultPrefs, playback: { ...defaultPrefs.playback, quality: "480p" } });
    const { result } = renderHook(() => usePreferencesState(42));

    await act(async () => {});
    act(() => {
      result.current.resetPreferences();
    });

    await act(async () => {});
    expect(mockStorage.saveUserPreferences).toHaveBeenCalledWith(42, expect.any(Object));
  });
});

// Regression for prexu-9f4s.1: the context value must keep a stable identity
// across re-renders that don't change preferences, so a sibling hook's
// high-frequency state churn in AppProviders doesn't re-render every
// Preferences consumer.
describe("usePreferencesState — context value identity (prexu-9f4s.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getDefaultPreferences.mockReturnValue({ ...defaultPrefs });
    mockStorage.getPreferences.mockResolvedValue({ ...defaultPrefs });
    mockStorage.getUserPreferences.mockResolvedValue({ ...defaultPrefs });
  });

  it("returns a stable object across a re-render that doesn't change its state", async () => {
    const { result, rerender } = renderHook(() => usePreferencesState());
    // Let the async mount-load settle so state is quiescent before comparing.
    await act(async () => {});
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("returns a new object when preferences change", async () => {
    const { result } = renderHook(() => usePreferencesState());
    await act(async () => {});
    const before = result.current;
    await act(async () => {});
    act(() => {
      result.current.updatePreferences({ playback: { quality: "720p" } });
    });
    expect(result.current.preferences.playback.quality).toBe("720p");
    expect(result.current).not.toBe(before);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("observable persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockStorage.getDefaultPreferences.mockImplementation(() => structuredClone(defaultPrefs));
    mockStorage.getPreferences.mockResolvedValue(structuredClone(defaultPrefs));
    mockStorage.getUserPreferences.mockResolvedValue(structuredClone(defaultPrefs));
    mockStorage.savePreferences.mockResolvedValue(undefined);
    mockStorage.saveUserPreferences.mockResolvedValue(undefined);
  });
  it("blocks changes before hydration and retries a failed read", async () => {
    const pending = deferred<typeof defaultPrefs>();
    mockStorage.getPreferences.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => usePreferencesState());
    act(() => result.current.updatePreferences({ playback: { quality: "480p" } }));
    expect(result.current.loadState).toBe("loading");
    expect(mockStorage.savePreferences).not.toHaveBeenCalled();
    await act(async () => pending.reject(new Error("read failed")));
    expect(result.current.loadState).toBe("error");
    await act(async () => result.current.retryLoad());
    expect(result.current.loadState).toBe("ready");
    expect(result.current.preferences.playback.quality).toBe("1080p");
  });
  it("serializes rapid writes and never reports an older write as the latest saved value", async () => {
    const first = deferred<void>();
    mockStorage.savePreferences.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => usePreferencesState());
    await act(async () => {});
    await act(async () => result.current.updatePreferences({ playback: { audioBoost: 110 } }));
    act(() => result.current.updatePreferences({ playback: { audioBoost: 120 } }));
    act(() => result.current.updatePreferences({ playback: { audioBoost: 130 } }));
    expect(result.current.preferences.playback.audioBoost).toBe(130);
    expect(result.current.saveStates["playback.audioBoost"]).toBe("saving");
    expect(mockStorage.savePreferences).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve());
    expect(mockStorage.savePreferences.mock.calls.map(([value]) => value.playback.audioBoost)).toEqual([110, 120, 130]);
    expect(result.current.saveStates["playback.audioBoost"]).toBe("saved");
  });
  it("keeps failed drafts out of unrelated saves, then reverts to the last confirmed value", async () => {
    const { result } = renderHook(() => usePreferencesState());
    await act(async () => {});
    await act(async () => result.current.updatePreferences({ playback: { quality: "720p" } }));
    mockStorage.savePreferences.mockRejectedValueOnce(new Error("disk full"));
    await act(async () => result.current.updatePreferences({ playback: { quality: "480p" } }));
    expect(result.current.preferences.playback.quality).toBe("480p");
    expect(result.current.saveStates["playback.quality"]).toBe("error");
    await act(async () => result.current.updatePreferences({ appearance: { theme: "light" } }));
    expect(mockStorage.savePreferences).toHaveBeenLastCalledWith(expect.objectContaining({ playback: expect.objectContaining({ quality: "720p" }) }));
    expect(result.current.preferences.playback.quality).toBe("480p");
    act(() => result.current.revertPreference("playback.quality"));
    expect(result.current.preferences.playback.quality).toBe("720p");
    expect(result.current.saveStates["playback.quality"]).toBeUndefined();
  });
  it("retries the failed leaf and preserves nested siblings", async () => {
    const { result } = renderHook(() => usePreferencesState());
    await act(async () => {});
    mockStorage.savePreferences.mockRejectedValueOnce(new Error("disk full"));
    await act(async () => result.current.updatePreferences({ playback: { subtitleStyle: { fontFamily: "serif" } } }));
    expect(result.current.saveStates["playback.subtitleStyle.fontFamily"]).toBe("error");
    await act(async () => result.current.retryPreference("playback.subtitleStyle.fontFamily"));
    expect(result.current.saveStates["playback.subtitleStyle.fontFamily"]).toBe("saved");
    expect(result.current.preferences.playback.subtitleStyle.textColor).toBe("#FFFFFF");
    expect(mockStorage.savePreferences).toHaveBeenCalledTimes(2);
  });
  it("ignores stale profile reads and old callbacks after switching users", async () => {
    const pending = deferred<typeof defaultPrefs>();
    mockStorage.getUserPreferences.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ id }) => usePreferencesState(id), { initialProps: { id: 1 } });
    await act(async () => {});
    const staleUpdate = result.current.updatePreferences;
    rerender({ id: 2 });
    await act(async () => {});
    await act(async () => result.current.updatePreferences({ appearance: { theme: "dark" } }));
    await act(async () => pending.resolve(defaultPrefs));
    act(() => staleUpdate({ playback: { quality: "480p" } }));
    expect(result.current.preferences.appearance.theme).toBe("dark");
    expect(mockStorage.saveUserPreferences).toHaveBeenCalledTimes(1);
    expect(mockStorage.saveUserPreferences).toHaveBeenCalledWith(2, expect.any(Object));
  });
  it("waits for an old profile write before reading that profile again", async () => {
    const pending = deferred<void>();
    mockStorage.saveUserPreferences.mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ id }) => usePreferencesState(id), { initialProps: { id: 10 } });
    await act(async () => {});
    await act(async () => result.current.updatePreferences({ playback: { quality: "720p" } }));
    rerender({ id: 20 });
    await act(async () => {});
    expect(result.current.preferences.playback.quality).toBe("1080p");
    rerender({ id: 10 });
    await act(async () => {});
    expect(result.current.loadState).toBe("loading");
    expect(mockStorage.getUserPreferences.mock.calls.map(([id]) => id)).toEqual([10, 20]);
    mockStorage.getUserPreferences.mockResolvedValue({ ...defaultPrefs, playback: { ...defaultPrefs.playback, quality: "720p" } });
    await act(async () => pending.resolve());
    expect(result.current.preferences.playback.quality).toBe("720p");
    expect(result.current.saveStates).toEqual({});
  });
  it("shows Saved for two seconds after persistence, not after editing", async () => {
    vi.useFakeTimers();
    try {
      const pending = deferred<void>();
      mockStorage.savePreferences.mockReturnValueOnce(pending.promise);
      const { result } = renderHook(() => usePreferencesState());
      await act(async () => {});
      await act(async () => result.current.updatePreferences({ playback: { audioBoost: 120 } }));
      act(() => vi.advanceTimersByTime(3000));
      expect(result.current.saveStates["playback.audioBoost"]).toBe("saving");
      await act(async () => pending.resolve());
      act(() => vi.advanceTimersByTime(1999));
      expect(result.current.saveStates["playback.audioBoost"]).toBe("saved");
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.saveStates["playback.audioBoost"]).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
  it("does not duplicate writes in StrictMode", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children);
    const { result } = renderHook(() => usePreferencesState(), { wrapper });
    await act(async () => {});
    await act(async () => result.current.updatePreferences({ playback: { quality: "720p" } }));
    expect(mockStorage.savePreferences).toHaveBeenCalledTimes(1);
  });
  it("keeps the newest row Saving when an older write fails", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    mockStorage.savePreferences.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => usePreferencesState());
    await act(async () => {});
    await act(async () => result.current.updatePreferences({ playback: { audioBoost: 110 } }));
    act(() => result.current.updatePreferences({ playback: { audioBoost: 120 } }));
    await act(async () => first.reject(new Error("old write failed")));
    expect(result.current.saveStates["playback.audioBoost"]).toBe("saving");
    expect(result.current.preferences.playback.audioBoost).toBe(120);
    await act(async () => second.resolve());
    expect(result.current.saveStates["playback.audioBoost"]).toBe("saved");
  });

});
