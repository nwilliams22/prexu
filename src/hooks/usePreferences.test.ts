import { renderHook, act, waitFor } from "@testing-library/react";
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

const defaultPrefs = {
  playback: {
    quality: "1080p" as const,
    preferredAudioLanguage: "",
    preferredSubtitleLanguage: "",
    defaultSubtitles: "auto" as const,
    subtitleSize: 100,
    audioBoost: 100,
    directPlayPreference: "auto" as const,
    volumeBoost: 1.0,
    normalizationPreset: "off" as const,
    audioOffsetMs: 0,
  },
  appearance: {
    posterSize: "medium" as const,
    sidebarCollapsed: false,
    dashboardSections: {
      continueWatching: true,
      recentMovies: true,
      recentShows: true,
    },
  },
};

describe("usePreferencesState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getDefaultPreferences.mockReturnValue({ ...defaultPrefs });
    mockStorage.getPreferences.mockResolvedValue({ ...defaultPrefs });
    mockStorage.getUserPreferences.mockResolvedValue({ ...defaultPrefs });
  });

  it("initializes with default preferences", () => {
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

  it("updatePreferences() saves to global when no userId", () => {
    const { result } = renderHook(() => usePreferencesState());

    act(() => {
      result.current.updatePreferences({ playback: { quality: "480p" } });
    });

    expect(mockStorage.savePreferences).toHaveBeenCalled();
    expect(mockStorage.saveUserPreferences).not.toHaveBeenCalled();
  });

  it("updatePreferences() saves to user key when userId provided", () => {
    const { result } = renderHook(() => usePreferencesState(42));

    act(() => {
      result.current.updatePreferences({ playback: { quality: "480p" } });
    });

    expect(mockStorage.saveUserPreferences).toHaveBeenCalledWith(42, expect.any(Object));
    expect(mockStorage.savePreferences).not.toHaveBeenCalled();
  });

  it("resetPreferences() resets to defaults", () => {
    const { result } = renderHook(() => usePreferencesState());

    // Change something first
    act(() => {
      result.current.updatePreferences({ playback: { quality: "480p" } });
    });
    expect(result.current.preferences.playback.quality).toBe("480p");

    // Reset
    act(() => {
      result.current.resetPreferences();
    });

    expect(result.current.preferences.playback.quality).toBe("1080p");
    expect(mockStorage.savePreferences).toHaveBeenCalled();
  });

  it("resetPreferences() saves to user key when userId provided", () => {
    const { result } = renderHook(() => usePreferencesState(42));

    act(() => {
      result.current.resetPreferences();
    });

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
    act(() => {
      result.current.updatePreferences({ playback: { quality: "720p" } });
    });
    expect(result.current.preferences.playback.quality).toBe("720p");
    expect(result.current).not.toBe(before);
  });
});
