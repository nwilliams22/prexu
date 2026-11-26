import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, useState } from "react";
import { render, renderHook, act, waitFor } from "@testing-library/react";

vi.hoisted(() => {
  Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", configurable: true });
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
});
const preferences = vi.hoisted(() => ({ playerEngine: "auto" as "auto" | "native" | "html5" }));

const { serverMock, hlsLoaderMock, timelineMock, streamsMock } = vi.hoisted(() => ({
  serverMock: { uri: "https://server", accessToken: "token" },
  hlsLoaderMock: {
    loadHls: vi.fn(),
    destroyHls: vi.fn(),
    hlsRef: { current: null },
  },
  timelineMock: {
    currentTimeRef: { current: 0 },
    durationRef: { current: 0 },
    isPlayingRef: { current: false },
    ratingKeyRef: { current: "" },
    wasWatchedAtStartRef: { current: false },
    startTimeline: vi.fn(),
    stopTimeline: vi.fn(),
    reportStopped: vi.fn(),
  },
  streamsMock: {
    audioTracks: [],
    subtitleTracks: [],
    selectedAudioId: null,
    selectedSubtitleId: null,
    setAudioTracks: vi.fn(),
    setSubtitleTracks: vi.fn(),
    setSelectedAudioId: vi.fn(),
    setSelectedSubtitleId: vi.fn(),
    selectAudioTrack: vi.fn(),
    selectSubtitleTrack: vi.fn(),
  },
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

vi.mock("./useAuth", () => ({
  useAuth: () => ({
    server: serverMock,
    isAuthenticated: true,
    serverSelected: true,
  }),
}));

vi.mock("./usePreferences", () => ({
  usePreferences: () => ({
    preferences: {
      playback: {
        playerEngine: preferences.playerEngine,
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
        subtitleStyle: {
          fontFamily: "Arial",
          textColor: "#FFFFFF",
          backgroundColor: "#000000",
          backgroundOpacity: 0.5,
          outlineColor: "#000000",
          outlineWidth: 1,
          shadowEnabled: true,
        },
      },
    },
    updatePreferences: vi.fn(),
  }),
}));

vi.mock("./player/useHlsLoader", () => ({
  useHlsLoader: () => hlsLoaderMock,
}));

vi.mock("./player/useTimelineReporting", () => ({
  useTimelineReporting: () => timelineMock,
}));

vi.mock("./player/useStreamSelection", () => ({
  useStreamSelection: () => streamsMock,
}));

vi.mock("./player/useNativePlayer", () => ({
  useNativePlayer: vi.fn(() => ({ title: "Native", videoRef: { current: null } })),
}));

vi.mock("../services/plex-playback", () => ({
  prepareSource: vi.fn(),
  applyPreparedMetadata: vi.fn((prepared, setters) => {
    // Minimal implementation so the title-dependent test assertions still
    // work: call the setters that useHtml5Player checks in the test.
    setters.setTitle(prepared.item?.title ?? "");
    setters.setSubtitle("");
    setters.setChapters(prepared.part?.Chapter ?? []);
    setters.setMarkers(prepared.playable?.Marker ?? []);
    setters.setItemType(prepared.item?.type ?? "");
    setters.setParentRatingKey("");
    setters.setAudioTracks(prepared.categorized?.audio ?? []);
    setters.setSubtitleTracks(prepared.categorized?.subtitles ?? []);
    setters.setSelectedAudioId(null);
    setters.setSelectedSubtitleId(null);
    setters.setIsLocalPlayback(prepared.isLocal ?? false);
    setters.setPartId(prepared.part?.id);
  }),
  refreshDownloadedSubtitles: vi.fn().mockResolvedValue(undefined),
  buildHlsConfig: vi.fn(() => ({})),
  reportTimeline: vi.fn(),
  getSavedVolume: () => 1,
  saveVolume: vi.fn(),
}));

vi.mock("../services/storage", () => ({
  addPendingWatchSync: vi.fn(),
}));

vi.mock("../services/subtitle-search", () => ({
  setSelectedSubtitleStream: vi.fn(),
  waitForDownloadedSubtitle: vi.fn(),
}));

import { prepareSource } from "../services/plex-playback";
import { usePlayer } from "./usePlayer";

type Prepared = Awaited<ReturnType<typeof prepareSource>>;

function makePrepared(title: string): Prepared {
  return {
    item: { type: "movie", title },
    playable: { Marker: [], duration: 60000 },
    part: { id: 1, Chapter: [] },
    categorized: { audio: [], subtitles: [] },
    defaultAudio: undefined,
    defaultSub: undefined,
    isLocal: false,
    sourceKind: "hls",
    url: "https://server/index.m3u8",
    viewOffset: 0,
  } as unknown as Prepared;
}


import PlayerOverlay from "../components/PlayerOverlay";
import { useNativePlayer } from "./player/useNativePlayer";
import { __resetEngineFallbackForTests, setPendingResumeOffsetMs, setSessionFallbackActive } from "./player/engineResolution";

const sessionState = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock("../contexts/PlayerContext", () => ({
  usePlayerSession: () => {
    const [session, setSession] = useState({ ratingKey: "100", offset: 12000 });
    sessionState.updateSession.mockImplementation((update) => setSession((old) => ({ ...old, ...update })));
    return { session, updateSession: sessionState.updateSession };
  },
}));
vi.mock("./player/useTransparentWindow", () => ({ useTransparentWindow: vi.fn() }));
vi.mock("../pages/Player", () => ({
  default: ({ ratingKey, offset }: { ratingKey: string; offset: number }) => {
    const player = usePlayer(ratingKey, offset);
    return createElement("div", null, player.title);
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  __resetEngineFallbackForTests();
  preferences.playerEngine = "auto";
  vi.mocked(prepareSource).mockResolvedValue(makePrepared("HTML5"));
});

describe("usePlayer macOS engine selection", () => {
  it("uses HTML5 by default without entering native playback", async () => {
    const { result } = renderHook(() => usePlayer("100"));
    await waitFor(() => expect(result.current.title).toBe("HTML5"));
    expect(useNativePlayer).not.toHaveBeenCalled();
  });

  it("locks native opt-in until unmount, then applies the HTML5 preference", async () => {
    preferences.playerEngine = "native";
    const first = renderHook(() => usePlayer("100"));
    expect(first.result.current.title).toBe("Native");
    preferences.playerEngine = "html5";
    first.rerender();
    expect(first.result.current.title).toBe("Native");
    first.unmount();
    const second = renderHook(() => usePlayer("100"));
    await waitFor(() => expect(second.result.current.title).toBe("HTML5"));
  });

  it.each([null, 42500])("remounts native onto HTML5 and preserves resume position %s", async (position) => {
    preferences.playerEngine = "native";
    const view = render(createElement(PlayerOverlay));
    await view.findByText("Native");
    act(() => {
      setPendingResumeOffsetMs(position);
      setSessionFallbackActive(true);
    });
    await view.findByText("HTML5");
    expect(prepareSource).toHaveBeenCalledWith(expect.objectContaining({
      ratingKey: "100", offsetOverride: position ?? 12000,
    }));
    if (position !== null) expect(sessionState.updateSession).toHaveBeenCalledWith({ offset: position });
  });
});
