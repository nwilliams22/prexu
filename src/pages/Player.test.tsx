/**
 * Tests for Player page — chrome reflow nudge on viewport resize.
 *
 * The ResizeObserver on document.documentElement bumps `renderTick` so React
 * re-renders the container, forcing inset:0 to be recalculated against the
 * new WebView viewport size (fixes stale chrome after popout-exit / fullscreen-enter).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks — all required so the Player component tree can render
// ---------------------------------------------------------------------------

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    serverSelected: true,
    server: { uri: "https://plex.test", accessToken: "tok" },
  }),
}));

vi.mock("../hooks/usePlayer", () => ({
  IS_NATIVE_PLAYER: false,
  usePlayer: () => ({
    videoRef: { current: null },
    isPlaying: false,
    isLoading: false,
    isBuffering: false,
    playbackError: null,
    currentTime: 0,
    duration: 0,
    volume: 1,
    buffered: 0,
    title: "Test Movie",
    subtitle: "",
    itemType: "movie",
    markers: [],
    chapters: [],
    isFullscreen: false,
    togglePlay: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleMute: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    retry: vi.fn(),
    parentRatingKey: null,
    applySubtitleStyle: vi.fn(),
    applyAudioEnhancement: vi.fn(),
  }),
}));

vi.mock("../hooks/useWatchTogether", () => ({
  useWatchTogether: () => ({
    isInSession: false,
    isHost: false,
    participants: [],
    syncStatus: "idle",
    syncTogglePlay: vi.fn(),
    syncSeek: vi.fn(),
    showNextEpisodePrompt: false,
    loadNextEpisode: vi.fn(),
    leaveSession: vi.fn(),
  }),
}));

vi.mock("../hooks/useAudioEnhancements", () => ({
  useAudioEnhancements: () => ({
    volumeBoost: 1,
    normalizationPreset: "none",
    audioOffsetMs: 0,
    setVolumeBoost: vi.fn(),
    setNormalizationPreset: vi.fn(),
    setAudioOffsetMs: vi.fn(),
    setMainBoost: vi.fn(),
  }),
}));

vi.mock("../hooks/usePreferences", () => ({
  usePreferences: () => ({
    preferences: {
      playback: {
        subtitleStyle: {},
        volumeBoost: 1,
        normalizationPreset: "none",
        audioOffsetMs: 0,
        skipIntroEnabled: false,
        skipCreditsEnabled: false,
      },
    },
    updatePreferences: vi.fn(),
  }),
}));

vi.mock("../hooks/player/useSkipSegments", () => ({
  useSkipSegments: () => ({ activeSegment: null, dismissSegment: vi.fn() }),
}));

vi.mock("../hooks/player/usePlayerControlsVisibility", () => ({
  usePlayerControlsVisibility: () => ({
    controlsVisible: true,
    resetHideTimer: vi.fn(),
    handleMouseMove: vi.fn(),
  }),
}));

vi.mock("../hooks/player/useVideoClickHandling", () => ({
  useVideoClickHandling: () => vi.fn(),
}));

vi.mock("../hooks/player/useEpisodeNavigation", () => ({
  useEpisodeNavigation: () => ({
    handleNextEpisode: vi.fn(),
    handlePrevEpisode: vi.fn(),
  }),
}));

vi.mock("../hooks/player/useQueueAutoPopulate", () => ({
  useQueueAutoPopulate: () => undefined,
}));

vi.mock("../hooks/player/useNextEpisodeDetection", () => ({
  useNextEpisodeDetection: () => null,
}));

vi.mock("../hooks/player/usePlayerKeyboardShortcuts", () => ({
  usePlayerKeyboardShortcuts: () => undefined,
}));

vi.mock("../hooks/player/usePictureInPicture", () => ({
  usePictureInPicture: () => ({
    isPiPActive: false,
    isPiPSupported: false,
    togglePiP: vi.fn(),
  }),
}));

vi.mock("../contexts/QueueContext", () => ({
  useQueue: () => ({
    queue: { items: [], currentIndex: -1 },
    remainingCount: 0,
    playNext: vi.fn(),
    playPrev: vi.fn(),
  }),
}));

vi.mock("../hooks/useBreakpoint", () => ({
  useBreakpoint: () => "desktop",
  isMobile: () => false,
}));

vi.mock("../services/plex-library", () => ({
  getImageUrl: vi.fn(() => "http://img.test/poster.jpg"),
}));

vi.mock("../utils/subtitle-css", () => ({
  buildSubtitleCss: () => "",
}));

vi.mock("../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("../components/PlayerControls", () => ({
  default: () => <div data-testid="player-controls" />,
}));

vi.mock("../components/ParticipantOverlay", () => ({
  default: () => <div data-testid="participant-overlay" />,
}));

vi.mock("../components/SyncIndicator", () => ({
  default: () => <div data-testid="sync-indicator" />,
}));

vi.mock("../components/NextEpisodePrompt", () => ({
  default: () => <div data-testid="next-episode-prompt" />,
}));

vi.mock("../components/player/ErrorOverlay", () => ({
  default: () => <div data-testid="error-overlay" />,
}));

vi.mock("../components/player/SkipSegmentButton", () => ({
  default: () => <div data-testid="skip-segment-button" />,
}));

vi.mock("../components/player/QueuePanel", () => ({
  default: () => <div data-testid="queue-panel" />,
}));

vi.mock("../components/player/PostPlayScreen", () => ({
  default: () => <div data-testid="post-play-screen" />,
}));

vi.mock("../components/player/KeyboardShortcutsOverlay", () => ({
  default: () => <div data-testid="keyboard-shortcuts-overlay" />,
}));

vi.mock("../components/player/MinimizedPlayer", () => ({
  default: () => <div data-testid="minimized-player" />,
}));

// PlayerContext split (prexu-ii3): Player consumes the session + minimize
// slices directly. Stub both so the component renders the full-player path.
vi.mock("../contexts/PlayerContext", () => ({
  usePlayerSession: () => ({ session: null, replaceRatingKey: vi.fn() }),
  usePlayerMinimize: () => ({
    isMinimized: false,
    minimize: vi.fn(),
    restoreFromMinimize: vi.fn(),
  }),
}));

vi.mock("../hooks/player/useShowCreditsLength", () => ({
  useShowCreditsLength: () => 0,
}));

vi.mock("../hooks/player/usePopOutPlayer", () => ({
  usePopOutPlayer: () => ({
    isPopOut: false,
    isPopOutSupported: false,
    togglePopOut: vi.fn(),
  }),
}));

vi.mock("../hooks/player/usePlayerLifecycle", () => ({
  usePlayerLifecycle: () => ({
    exit: vi.fn(),
    navAwayPreservingMount: vi.fn(),
  }),
}));

vi.mock("../hooks/player/usePostPlay", () => ({
  usePostPlay: () => ({
    showPostPlay: false,
    nextQueueItem: null,
    onPlayNext: vi.fn(),
    onStop: vi.fn(),
    postPlayDetail: null,
  }),
}));

// ---------------------------------------------------------------------------
// ResizeObserver test double
// ---------------------------------------------------------------------------

type ROCallback = (entries: ResizeObserverEntry[]) => void;

class MockResizeObserver {
  private cb: ROCallback;
  private static instances: MockResizeObserver[] = [];

  constructor(cb: ROCallback) {
    this.cb = cb;
    MockResizeObserver.instances.push(this);
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  /** Simulate a viewport resize by invoking the callback with fake entries */
  simulateResize(width: number, height: number) {
    this.cb([
      {
        contentRect: { width, height } as DOMRectReadOnly,
      } as ResizeObserverEntry,
    ]);
  }

  static reset() {
    MockResizeObserver.instances = [];
  }

  static getLatest(): MockResizeObserver {
    return MockResizeObserver.instances[MockResizeObserver.instances.length - 1];
  }

  static getAll(): MockResizeObserver[] {
    return [...MockResizeObserver.instances];
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import Player from "./Player";

describe("Player – chrome reflow nudge on viewport resize", () => {
  let originalResizeObserver: typeof globalThis.ResizeObserver;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    MockResizeObserver.reset();
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  function renderPlayer() {
    return render(
      <MemoryRouter initialEntries={["/play/123"]}>
        <Player ratingKey="123" offset={null} />
      </MemoryRouter>,
    );
  }

  it("attaches a ResizeObserver to document.documentElement on mount", () => {
    renderPlayer();

    const observer = MockResizeObserver.getLatest();
    expect(observer).toBeDefined();
    expect(observer.observe).toHaveBeenCalledWith(document.documentElement);
  });

  it("increments data-render-tick when the viewport resizes", async () => {
    const { container } = renderPlayer();

    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.renderTick).toBe("0");

    const observer = MockResizeObserver.getLatest();

    await act(async () => {
      observer.simulateResize(1920, 1080);
    });

    expect(root.dataset.renderTick).toBe("1");
  });

  it("increments render tick again on a second viewport resize (covers back-to-back events)", async () => {
    const { container } = renderPlayer();

    const root = container.firstElementChild as HTMLElement;
    const observer = MockResizeObserver.getLatest();

    await act(async () => {
      observer.simulateResize(1280, 720);
    });
    await act(async () => {
      observer.simulateResize(1920, 1080);
    });

    expect(root.dataset.renderTick).toBe("2");
  });

  it("does not re-render when the ResizeObserver fires with an empty entries array", async () => {
    const { container } = renderPlayer();

    const root = container.firstElementChild as HTMLElement;
    const observer = MockResizeObserver.getLatest();

    await act(async () => {
      // Simulate callback with no entries (guard branch)
      (observer as unknown as { cb: ROCallback }).cb([]);
    });

    expect(root.dataset.renderTick).toBe("0");
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = renderPlayer();

    const observer = MockResizeObserver.getLatest();
    expect(observer.disconnect).not.toHaveBeenCalled();

    unmount();

    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it("creates exactly one ResizeObserver per Player mount", () => {
    renderPlayer();
    expect(MockResizeObserver.getAll()).toHaveLength(1);
  });
});
