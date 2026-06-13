/**
 * Render-count tests for the player chrome's time-pos tick path
 * (prexu-bgz.5).
 *
 * Mounts the REAL useNativePlayer + PlayerControls + ControlsBottomBar
 * stack with the Tauri event bridge mocked, fires player://time-pos
 * ticks at the captured listeners, and counts renders of two leaves:
 *   - SeekBar (displays time)        → MUST re-render on every tick
 *   - SkipButtons (transport chrome) → must NOT re-render on ticks
 *
 * SkipButtons is rendered by ControlsBottomBar, which is memoized over
 * the tick-stable `player.chrome` slice — so its render count is a
 * faithful proxy for "did the memoized bottom-bar subtree re-render".
 * Mock/event plumbing mirrors useNativePlayer.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/logger")>()),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

const { serverMock, timelineMock } = vi.hoisted(() => ({
  serverMock: { uri: "https://server", accessToken: "token" },
  timelineMock: {
    currentTimeRef: { current: 0 },
    durationRef: { current: 0 },
    isPlayingRef: { current: false },
    ratingKeyRef: { current: "" },
    startTimeline: vi.fn(),
    stopTimeline: vi.fn(),
    reportStopped: vi.fn(),
  },
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    server: serverMock,
    isAuthenticated: true,
    serverSelected: true,
  }),
}));

vi.mock("../hooks/usePreferences", () => ({
  usePreferences: () => ({
    preferences: {
      playback: {
        quality: "original",
        preferredAudioLanguage: "",
        preferredSubtitleLanguage: "",
        defaultSubtitles: "auto",
        subtitleSize: 100,
        audioBoost: 1,
        directPlayPreference: "auto",
        volumeBoost: 1,
        normalizationPreset: "off",
        audioOffsetMs: 0,
        skipIntroEnabled: true,
        skipCreditsEnabled: true,
        autoPlayEnabled: true,
        subtitleStyle: {},
      },
    },
    updatePreferences: vi.fn(),
  }),
}));

vi.mock("../hooks/player/useTimelineReporting", () => ({
  useTimelineReporting: () => timelineMock,
}));

vi.mock("../services/plex-playback", () => ({
  // Never resolves: keeps init from mutating player state mid-test so the
  // only state changes after mount are the ticks we fire deliberately.
  prepareSource: vi.fn(() => new Promise(() => {})),
  deriveDisplayTitles: vi.fn(() => ({ title: "", subtitle: "" })),
  reportTimeline: vi.fn(),
  getSavedVolume: () => 1,
  saveVolume: vi.fn(),
}));

vi.mock("../services/storage", () => ({
  addPendingWatchSync: vi.fn(),
  getClientIdentifier: vi.fn().mockResolvedValue("client-id"),
}));

vi.mock("../services/subtitle-search", () => ({
  setSelectedSubtitleStream: vi.fn(),
  waitForDownloadedSubtitle: vi.fn(),
}));

vi.mock("../hooks/useBreakpoint", () => ({
  useBreakpoint: () => "desktop",
  isMobile: () => false,
}));

// ── Render counters ──────────────────────────────────────────────────────
const counters = vi.hoisted(() => ({ seekBar: 0, skipButtons: 0 }));

vi.mock("./player/SeekBar", () => ({
  default: ({ currentTime }: { currentTime: number }) => {
    counters.seekBar++;
    return <div data-testid="seekbar" data-time={currentTime} />;
  },
}));

vi.mock("./player/SkipButtons", () => ({
  default: () => {
    counters.skipButtons++;
    return <div data-testid="skip-buttons" />;
  },
}));

// Popup panels never open in these tests — stub to keep the module graph
// (and their transitive service imports) out of the picture.
vi.mock("./TrackMenu", () => ({
  default: () => <div data-testid="track-menu" />,
}));
vi.mock("./AudioEnhancementsPanel", () => ({
  default: () => <div data-testid="audio-enhancements-panel" />,
}));
vi.mock("./player/SubtitleSearchPanel", () => ({
  default: () => <div data-testid="subtitle-search-panel" />,
}));

// Capture player://* listeners so the tests can fire ticks on demand.
const { eventHandlers } = vi.hoisted(() => {
  const handlers: Record<string, ((evt: { payload: unknown }) => void)[]> = {};
  return { eventHandlers: handlers };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (name: string, handler: (evt: { payload: unknown }) => void) => {
      if (!eventHandlers[name]) eventHandlers[name] = [];
      eventHandlers[name].push(handler);
      return () => {
        const list = eventHandlers[name] ?? [];
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
  ),
  emit: vi.fn().mockResolvedValue(undefined),
  emitTo: vi.fn().mockResolvedValue(undefined),
  once: vi.fn().mockResolvedValue(() => {}),
  TauriEvent: {},
}));

import { listen } from "@tauri-apps/api/event";
import { useNativePlayer } from "../hooks/player/useNativePlayer";
import PlayerControls from "./PlayerControls";

beforeEach(() => {
  vi.clearAllMocks();
  counters.seekBar = 0;
  counters.skipButtons = 0;
  for (const k of Object.keys(eventHandlers)) delete eventHandlers[k];
  vi.mocked(listen).mockImplementation(
    async (name: string, handler: (evt: { payload: unknown }) => void) => {
      if (!eventHandlers[name]) eventHandlers[name] = [];
      eventHandlers[name].push(handler);
      return () => {
        const list = eventHandlers[name] ?? [];
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    },
  );
});

function fireTimePos(seconds: number) {
  const subs = eventHandlers["player://time-pos"];
  if (!subs || subs.length === 0) {
    throw new Error("player://time-pos handlers not registered yet");
  }
  for (const h of subs) h({ payload: seconds });
}

const noop = () => {};

function Harness({ ratingKey }: { ratingKey: string }) {
  const player = useNativePlayer(ratingKey);
  return <PlayerControls player={player} onExit={noop} visible />;
}

describe("player chrome render counts on time-pos ticks (prexu-bgz.5)", () => {
  it("re-renders the seek bar per tick but not the memoized bottom-bar chrome", async () => {
    const { getByTestId } = render(<Harness ratingKey="123" />);

    await waitFor(() => {
      expect(eventHandlers["player://time-pos"]?.length ?? 0).toBeGreaterThan(0);
    });
    // Flush any trailing mount-time microtasks before snapshotting.
    await act(async () => {});

    // Both leaves rendered at least once on mount.
    expect(counters.seekBar).toBeGreaterThan(0);
    expect(counters.skipButtons).toBeGreaterThan(0);

    const seekBarBefore = counters.seekBar;
    const skipButtonsBefore = counters.skipButtons;

    const TICKS = 8;
    for (let i = 1; i <= TICKS; i++) {
      act(() => {
        fireTimePos(i * 0.25);
      });
    }

    // Time genuinely propagated to the time-displaying leaf...
    expect(getByTestId("seekbar").dataset.time).toBe(String(TICKS * 0.25));
    expect(counters.seekBar - seekBarBefore).toBe(TICKS);
    // ...while the memoized chrome subtree never re-rendered.
    expect(counters.skipButtons - skipButtonsBefore).toBe(0);
  });

  it("does re-render the bottom-bar chrome on a real state change (play/pause)", async () => {
    render(<Harness ratingKey="123" />);

    await waitFor(() => {
      expect(eventHandlers["player://paused"]?.length ?? 0).toBeGreaterThan(0);
    });
    await act(async () => {});

    const skipButtonsBefore = counters.skipButtons;

    // paused=false → isPlaying true: chrome state the transport displays.
    act(() => {
      for (const h of eventHandlers["player://paused"]) h({ payload: false });
    });

    expect(counters.skipButtons).toBeGreaterThan(skipButtonsBefore);
  });
});
