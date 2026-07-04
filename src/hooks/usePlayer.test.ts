/**
 * Tests for useHtml5Player's initPlayback supersession guard (prexu-bgz.2).
 *
 * The HTML5 backend's initPlayback awaits prepareSource before writing any
 * metadata. If a new episode starts (ratingKey change) or the hook unmounts
 * while a previous init is still preparing, the stale continuation must not
 * write the old episode's metadata or touch the video pipeline.
 *
 * jsdom has no `__TAURI_INTERNALS__`, so usePlayer dispatches to the HTML5
 * backend here. Sub-hooks (hls loader, timeline, stream selection) are
 * stubbed with stable objects so the init effect only re-fires on ratingKey
 * changes, mirroring production behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

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
  useNativePlayer: vi.fn(),
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
  // Real-shaped localStorage impls (prexu-jphh) so persistence behavior
  // stays observable through the mock.
  getSavedMuted: () => localStorage.getItem("prexu_muted") === "true",
  saveMuted: vi.fn((muted: boolean) => {
    localStorage.setItem("prexu_muted", String(muted));
  }),
}));

vi.mock("../services/storage", () => ({
  addPendingWatchSync: vi.fn(),
}));

vi.mock("../services/subtitle-search", () => ({
  setSelectedSubtitleStream: vi.fn(),
  waitForDownloadedSubtitle: vi.fn(),
}));

import { prepareSource } from "../services/plex-playback";
import { logger } from "../services/logger";
import { usePlayer } from "./usePlayer";

type Prepared = Awaited<ReturnType<typeof prepareSource>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

beforeEach(() => {
  vi.clearAllMocks();
});

import { applyPreparedMetadata } from "../services/plex-playback";

describe("useHtml5Player initPlayback supersession (prexu-bgz.2)", () => {
  it("ignores a stale prepareSource result after a newer init starts", async () => {
    const first = deferred<Prepared>();
    const second = deferred<Prepared>();
    vi.mocked(prepareSource)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderHook(
      ({ rk }: { rk: string }) => usePlayer(rk),
      { initialProps: { rk: "100" } },
    );

    // Second episode starts while the first is still preparing.
    rerender({ rk: "200" });
    expect(prepareSource).toHaveBeenCalledTimes(2);

    // The first (now stale) prepare resolves late — no metadata writes.
    await act(async () => {
      first.resolve(makePrepared("Old Episode"));
      await first.promise;
      await Promise.resolve();
    });

    expect(result.current.title).not.toBe("Old Episode");
    // applyPreparedMetadata (and therefore setAudioTracks) should not be called
    // for the stale generation.
    expect(applyPreparedMetadata).not.toHaveBeenCalled();
    expect(streamsMock.setAudioTracks).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      "player",
      "initPlayback superseded",
      { gen: 1 },
    );

    // The current init proceeds normally once its prepare resolves.
    await act(async () => {
      second.resolve(makePrepared("New Episode"));
      await second.promise;
    });

    await waitFor(() => {
      expect(result.current.title).toBe("New Episode");
    });
    expect(streamsMock.setAudioTracks).toHaveBeenCalledTimes(1);
  });

  it("bails out when the hook unmounts mid-init", async () => {
    const first = deferred<Prepared>();
    vi.mocked(prepareSource).mockImplementationOnce(() => first.promise);

    const { unmount } = renderHook(() => usePlayer("100"));
    unmount();

    first.resolve(makePrepared("Old Episode"));
    await first.promise;
    await Promise.resolve();

    expect(applyPreparedMetadata).not.toHaveBeenCalled();
    expect(streamsMock.setAudioTracks).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      "player",
      "initPlayback superseded",
      { gen: 1 },
    );
  });
});
