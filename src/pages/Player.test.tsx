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
  usePlayer: () => ({
    engine: "html5",
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

// Renders the received `reflowTick` prop as a data attribute so tests can
// assert Player.tsx actually forwards its renderTick down (prexu-trbl) —
// ControlsBottomBar/SkipButtons need this to escape their own memoization
// on a plain viewport resize; see PlayerControls.tickrender.test.tsx for
// the deeper memo-defeat behavior with the real component stack.
vi.mock("../components/PlayerControls", () => ({
  default: ({
    reflowTick,
    visible,
    suppressTransition,
  }: {
    reflowTick?: number;
    visible?: boolean;
    suppressTransition?: boolean;
  }) => (
    <div
      data-testid="player-controls"
      data-reflow-tick={reflowTick}
      data-visible={String(visible)}
      data-suppress-transition={String(suppressTransition)}
    />
  ),
}));

// prexu-uf4m: the host-transition chrome hide listens for
// player://host-window-busy, but only when the popout capability exists —
// force it on in jsdom, keeping everything else from the real module.
vi.mock("../hooks/player/engineResolution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks/player/engineResolution")>()),
  SUPPORTS_PLAYER_POPOUT: true,
}));

// Captures the Player's tauri event subscriptions so tests can fire
// player://host-window-busy like the Rust popout enter/exit paths do.
const tauriEventHandlers = vi.hoisted(
  () => ({}) as Record<string, (evt: unknown) => void>,
);
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: (evt: unknown) => void) => {
    tauriEventHandlers[event] = cb;
    return () => {
      delete tauriEventHandlers[event];
    };
  }),
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

  it("forwards renderTick to PlayerControls as reflowTick within the same act() flush (prexu-trbl)", async () => {
    const { getByTestId } = renderPlayer();

    // Baseline: no resize yet.
    expect(getByTestId("player-controls").dataset.reflowTick).toBe("0");

    const observer = MockResizeObserver.getLatest();

    // Simulate the popout-exit → full-size resize sequence: an intermediate
    // size (mid-transition) followed by the final dimensions, exactly as
    // the hardware-observed bug report describes multiple viewport-resize
    // log lines during the transition.
    await act(async () => {
      observer.simulateResize(900, 600);
    });
    expect(getByTestId("player-controls").dataset.reflowTick).toBe("1");

    await act(async () => {
      observer.simulateResize(1920, 1080);
    });
    // Both the outer container's data-render-tick (asserted above) and the
    // PlayerControls prop must track together, in the same flush — nothing
    // here is debounced or deferred to a later tick.
    expect(getByTestId("player-controls").dataset.reflowTick).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// prexu-uf4m: host-transition chrome hide. Popout enter/exit is a
// programmatic mega-resize whose browser-side signals (resize event,
// ResizeObserver) lag by up to ~1s on WebKitGTK at 4K — so the chrome must
// hide when Rust announces the transition (player://host-window-busy) and
// reveal on the first viewport reflow that follows, when its layout is
// actually correct against the new dimensions.
// ---------------------------------------------------------------------------

describe("Player – host-transition chrome hide (prexu-uf4m)", () => {
  let originalResizeObserver: typeof globalThis.ResizeObserver;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    MockResizeObserver.reset();
    for (const key of Object.keys(tauriEventHandlers)) delete tauriEventHandlers[key];
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    vi.useRealTimers();
  });

  function renderPlayer() {
    return render(
      <MemoryRouter initialEntries={["/play/123"]}>
        <Player ratingKey="123" offset={null} />
      </MemoryRouter>,
    );
  }

  async function renderAndFlushListeners() {
    const utils = renderPlayer();
    // The busy listener registers through a dynamic import — flush it.
    await act(async () => {});
    expect(tauriEventHandlers["player://host-window-busy"]).toBeDefined();
    return utils;
  }

  it("hides the chrome the moment host-window-busy fires — before any viewport resize arrives", async () => {
    const { getByTestId } = await renderAndFlushListeners();

    expect(getByTestId("player-controls").dataset.visible).toBe("true");

    await act(async () => {
      tauriEventHandlers["player://host-window-busy"](null);
    });

    expect(getByTestId("player-controls").dataset.visible).toBe("false");
    expect(getByTestId("player-controls").dataset.suppressTransition).toBe("true");
  });

  it("reveals the chrome on the first viewport reflow after the transition", async () => {
    const { getByTestId } = await renderAndFlushListeners();

    await act(async () => {
      tauriEventHandlers["player://host-window-busy"](null);
    });
    expect(getByTestId("player-controls").dataset.visible).toBe("false");

    const observer = MockResizeObserver.getLatest();
    await act(async () => {
      observer.simulateResize(1920, 2112);
    });

    expect(getByTestId("player-controls").dataset.visible).toBe("true");
    expect(getByTestId("player-controls").dataset.suppressTransition).toBe("false");
    // The same reflow also nudged the memoized chrome (prexu-trbl contract).
    expect(getByTestId("player-controls").dataset.reflowTick).toBe("1");
  });

  it("falls back to revealing the chrome after 1500ms if no reflow ever arrives", async () => {
    const { getByTestId } = await renderAndFlushListeners();

    vi.useFakeTimers();
    await act(async () => {
      tauriEventHandlers["player://host-window-busy"](null);
    });
    expect(getByTestId("player-controls").dataset.visible).toBe("false");

    await act(async () => {
      vi.advanceTimersByTime(1499);
    });
    expect(getByTestId("player-controls").dataset.visible).toBe("false");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(getByTestId("player-controls").dataset.visible).toBe("true");
  });

  it("a plain viewport reflow without a host transition never touches visibility", async () => {
    const { getByTestId } = await renderAndFlushListeners();

    const observer = MockResizeObserver.getLatest();
    await act(async () => {
      observer.simulateResize(1280, 720);
    });

    expect(getByTestId("player-controls").dataset.visible).toBe("true");
    expect(getByTestId("player-controls").dataset.suppressTransition).toBe("false");
  });
});
