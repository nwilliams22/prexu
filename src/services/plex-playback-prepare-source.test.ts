/**
 * Tests for prepareSource() and deriveDisplayTitles() in plex-playback.ts
 */

import { prepareSource, deriveDisplayTitles } from "./plex-playback";
import {
  createPlexMovie,
  createPlexEpisode,
  createPlexMediaInfo,
  createPlexMediaPart,
  createPlexStream,
  createPreferences,
  resetIdCounter,
} from "../__tests__/mocks/plex-data";
import type { PlaybackPreferences } from "../types/preferences";

// ── Module mocks ──

vi.mock("@tauri-apps/plugin-log", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}));

vi.mock("./storage", () => ({
  getClientIdentifier: vi.fn().mockResolvedValue("test-client-id"),
}));

const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
vi.stubGlobal("fetch", mockFetch);

vi.mock("./plex-api", () => ({
  getServerHeaders: vi.fn().mockResolvedValue({ Accept: "application/json" }),
  timedFetch: (...args: unknown[]) => mockFetch(...args),
}));

const mockGetItemMetadata = vi.fn();
vi.mock("./plex-library", () => ({
  getItemMetadata: (...args: unknown[]) => mockGetItemMetadata(...args),
}));

const mockGetLocalFilePath = vi.fn<() => Promise<string | null>>();
vi.mock("./downloads", () => ({
  getLocalFilePath: (...args: unknown[]) => mockGetLocalFilePath(...args),
}));

// ── Helpers ──

const SERVER = { uri: "https://server:32400", accessToken: "token" };
const RATING_KEY = "42";

function makePrefs(overrides: Partial<PlaybackPreferences> = {}): PlaybackPreferences {
  return { ...createPreferences().playback, ...overrides };
}

function makeMovie() {
  const part = createPlexMediaPart({
    container: "mp4",
    Stream: [
      createPlexStream({ streamType: 1, codec: "h264" }),
      createPlexStream({ streamType: 2, codec: "aac", languageCode: "eng", selected: true }),
      createPlexStream({ streamType: 2, codec: "dts", languageCode: "jpn" }),
      createPlexStream({ streamType: 3, codec: "srt", languageCode: "eng", selected: false }),
    ],
  });
  const media = createPlexMediaInfo({ videoCodec: "h264", audioCodec: "aac", Part: [part] });
  return createPlexMovie({ Media: [media] });
}

// ── Tests ──

beforeEach(() => {
  resetIdCounter();
  mockGetLocalFilePath.mockResolvedValue(null);
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true } as Response);
});

describe("prepareSource", () => {
  // Case 1: local file path
  it("returns sourceKind=local with raw path when getLocalFilePath resolves", async () => {
    const movie = makeMovie();
    mockGetItemMetadata.mockResolvedValue(movie);
    mockGetLocalFilePath.mockResolvedValue("C:\\Downloads\\movie.mkv");

    const result = await prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs(),
    });

    expect(result.sourceKind).toBe("local");
    expect(result.isLocal).toBe(true);
    expect(result.url).toBe("C:\\Downloads\\movie.mkv");
  });

  // Case 2: directPlayPreference = "always" → direct
  it("returns sourceKind=direct when directPlayPreference is always", async () => {
    const movie = makeMovie();
    mockGetItemMetadata.mockResolvedValue(movie);

    const result = await prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs({ directPlayPreference: "always" }),
    });

    expect(result.sourceKind).toBe("direct");
    expect(result.isLocal).toBe(false);
    expect(result.url).toContain("/library/parts/");
    expect(result.url).toContain("X-Plex-Token=token");
  });

  // Case 3: auto + canDirectPlay true → direct
  it("returns sourceKind=direct when directPlayPreference=auto and canDirectPlay is true", async () => {
    const movie = makeMovie(); // h264+aac+mp4 → canDirectPlay=true
    mockGetItemMetadata.mockResolvedValue(movie);

    const result = await prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs({ directPlayPreference: "auto" }),
      skipCodecCheck: false,
    });

    expect(result.sourceKind).toBe("direct");
  });

  // Case 4: auto + canDirectPlay false + skipCodecCheck=true → direct (native path)
  it("returns sourceKind=direct when canDirectPlay=false but skipCodecCheck=true", async () => {
    const part = createPlexMediaPart({
      container: "mkv",
      Stream: [
        createPlexStream({ streamType: 1, codec: "hevc" }),
        createPlexStream({ streamType: 2, codec: "dts", languageCode: "eng", selected: true }),
      ],
    });
    const media = createPlexMediaInfo({ videoCodec: "hevc", audioCodec: "dts", Part: [part] });
    const movie = createPlexMovie({ Media: [media] });
    mockGetItemMetadata.mockResolvedValue(movie);

    const result = await prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs({ directPlayPreference: "auto" }),
      skipCodecCheck: true,
    });

    expect(result.sourceKind).toBe("direct");
  });

  // Case 5: auto + canDirectPlay false + skipCodecCheck=false → transcode (HTML5 path)
  it("returns sourceKind=transcode when canDirectPlay=false and skipCodecCheck=false", async () => {
    const part = createPlexMediaPart({
      container: "mkv",
      Stream: [
        createPlexStream({ streamType: 1, codec: "hevc" }),
        createPlexStream({ streamType: 2, codec: "dts", languageCode: "eng", selected: true }),
      ],
    });
    const media = createPlexMediaInfo({ videoCodec: "hevc", audioCodec: "dts", Part: [part] });
    const movie = createPlexMovie({ Media: [media] });
    mockGetItemMetadata.mockResolvedValue(movie);

    const result = await prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs({ directPlayPreference: "auto" }),
      skipCodecCheck: false,
    });

    expect(result.sourceKind).toBe("transcode");
    expect(result.url).toContain("/transcode/universal/start.m3u8");
  });

  // Case 5b: directPlayPreference="always" still respects HTML5 codec gate.
  // Pre-extraction the HTML5 path had `shouldDirectPlay && canDirectPlay(media)`
  // guarding the direct branch even for "always". Preserve that silent
  // fallback so users on HTML5 + "always" + incompatible codec don't see
  // an error-flash before the transcode retry.
  it("returns sourceKind=transcode for 'always' when canDirectPlay=false and skipCodecCheck=false", async () => {
    const part = createPlexMediaPart({
      container: "mkv",
      Stream: [
        createPlexStream({ streamType: 1, codec: "hevc" }),
        createPlexStream({ streamType: 2, codec: "dts", languageCode: "eng", selected: true }),
      ],
    });
    const media = createPlexMediaInfo({ videoCodec: "hevc", audioCodec: "dts", Part: [part] });
    const movie = createPlexMovie({ Media: [media] });
    mockGetItemMetadata.mockResolvedValue(movie);

    const result = await prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs({ directPlayPreference: "always" }),
      skipCodecCheck: false,
    });

    expect(result.sourceKind).toBe("transcode");
  });

  // Case 6: directPlayPreference = "never" → transcode
  it("returns sourceKind=transcode when directPlayPreference is never", async () => {
    const movie = makeMovie();
    mockGetItemMetadata.mockResolvedValue(movie);

    const result = await prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs({ directPlayPreference: "never" }),
    });

    expect(result.sourceKind).toBe("transcode");
  });

  // Case 7: directPlayFailed=true → transcode regardless of preference
  it("returns sourceKind=transcode when directPlayFailed is true", async () => {
    const movie = makeMovie(); // canDirectPlay=true normally
    mockGetItemMetadata.mockResolvedValue(movie);

    const result = await prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs({ directPlayPreference: "always" }),
      directPlayFailed: true,
    });

    expect(result.sourceKind).toBe("transcode");
  });

  // Case 8: no Media[] → throws
  it("throws when item has no Media", async () => {
    const movie = createPlexMovie({ Media: [] });
    mockGetItemMetadata.mockResolvedValue(movie);

    await expect(
      prepareSource({
        server: SERVER,
        ratingKey: RATING_KEY,
        preferences: makePrefs(),
      })
    ).rejects.toThrow("No playable media found");
  });

  // Case 9: preferred audio language matches a track → that track wins over selected
  it("picks preferredAudioLanguage track over the selected flag", async () => {
    const part = createPlexMediaPart({
      container: "mp4",
      Stream: [
        createPlexStream({ streamType: 1, codec: "h264" }),
        createPlexStream({ streamType: 2, codec: "aac", languageCode: "eng", selected: true }),
        createPlexStream({ streamType: 2, codec: "aac", languageCode: "jpn", selected: false }),
      ],
    });
    const media = createPlexMediaInfo({ videoCodec: "h264", audioCodec: "aac", Part: [part] });
    const movie = createPlexMovie({ Media: [media] });
    mockGetItemMetadata.mockResolvedValue(movie);

    const result = await prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs({ preferredAudioLanguage: "jpn", directPlayPreference: "always" }),
    });

    expect(result.defaultAudio?.languageCode).toBe("jpn");
  });

  // Case 10: defaultSubtitles = "off" → defaultSub is undefined even when subs exist
  it("returns defaultSub=undefined when defaultSubtitles is off", async () => {
    const part = createPlexMediaPart({
      container: "mp4",
      Stream: [
        createPlexStream({ streamType: 1, codec: "h264" }),
        createPlexStream({ streamType: 2, codec: "aac", languageCode: "eng", selected: true }),
        createPlexStream({ streamType: 3, codec: "srt", languageCode: "eng", selected: true }),
      ],
    });
    const media = createPlexMediaInfo({ videoCodec: "h264", audioCodec: "aac", Part: [part] });
    const movie = createPlexMovie({ Media: [media] });
    mockGetItemMetadata.mockResolvedValue(movie);

    const result = await prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs({ defaultSubtitles: "off" }),
    });

    expect(result.defaultSub).toBeUndefined();
  });

  // Extra: viewOffset from offsetOverride takes priority over item.viewOffset
  it("uses offsetOverride when provided over item viewOffset", async () => {
    const movie = createPlexMovie({ viewOffset: 60000, Media: [createPlexMediaInfo()] });
    mockGetItemMetadata.mockResolvedValue(movie);

    const result = await prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs({ directPlayPreference: "always" }),
      offsetOverride: 0,
    });

    expect(result.viewOffset).toBe(0);
  });

  // prexu-ix52: with no offsetOverride (the "Resume" popover / detail-page
  // Resume button path — neither passes an explicit offset, see
  // usePlayAction.tsx / ItemHeroSection.tsx), prepareSource must use the
  // FRESH item.viewOffset from the getItemMetadata call it just made, never
  // a value the caller already had cached (e.g. from the onDeck shelf).
  // This is what makes the actual resume position immune to onDeck cache
  // staleness — only the popover LABEL can go stale, not the seek target.
  it("uses the freshly-fetched item.viewOffset when no offsetOverride is given", async () => {
    const movie = createPlexMovie({ viewOffset: 280_000, Media: [createPlexMediaInfo()] });
    mockGetItemMetadata.mockResolvedValue(movie);

    const result = await prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs({ directPlayPreference: "always" }),
      // No offsetOverride — mirrors the real "Resume" click path.
    });

    expect(result.viewOffset).toBe(280_000);
    // getItemMetadata is the only source consulted for the offset — the
    // caller passed nothing else in for prepareSource to read.
    expect(mockGetItemMetadata).toHaveBeenCalledWith(
      SERVER.uri,
      SERVER.accessToken,
      RATING_KEY,
    );
  });

  // Extra: metadata fetch and local-file lookup run concurrently, not as a
  // waterfall. Both must be invoked before either promise resolves, and
  // resolving the local-path lookup FIRST must not break anything.
  it("starts getItemMetadata and getLocalFilePath concurrently", async () => {
    const movie = makeMovie();
    // vi.fn() call history persists across tests in this file (restoreMocks
    // only affects vi.spyOn spies) — clear it so call counts below are exact.
    mockGetItemMetadata.mockClear();
    mockGetLocalFilePath.mockClear();
    let resolveMetadata!: (v: unknown) => void;
    let resolveLocal!: (v: string | null) => void;
    mockGetItemMetadata.mockReturnValue(
      new Promise((resolve) => {
        resolveMetadata = resolve;
      })
    );
    mockGetLocalFilePath.mockReturnValue(
      new Promise((resolve) => {
        resolveLocal = resolve;
      })
    );

    const pending = prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs(),
    });

    // Neither promise has resolved yet — a waterfall would not have called
    // getLocalFilePath until getItemMetadata resolved.
    expect(mockGetItemMetadata).toHaveBeenCalledTimes(1);
    expect(mockGetLocalFilePath).toHaveBeenCalledTimes(1);
    expect(mockGetLocalFilePath).toHaveBeenCalledWith(RATING_KEY);

    // Resolve the local-path lookup first, then metadata — out of waterfall order.
    resolveLocal("C:\\Downloads\\movie.mkv");
    resolveMetadata(movie);

    const result = await pending;
    expect(result.sourceKind).toBe("local");
    expect(result.url).toBe("C:\\Downloads\\movie.mkv");
  });

  // Extra: quality=original in auto mode → direct play without codec check
  it("returns direct when quality=original in auto mode", async () => {
    const part = createPlexMediaPart({
      container: "mkv",
      Stream: [
        createPlexStream({ streamType: 1, codec: "hevc" }),
        createPlexStream({ streamType: 2, codec: "dts", languageCode: "eng", selected: true }),
      ],
    });
    const media = createPlexMediaInfo({ videoCodec: "hevc", audioCodec: "dts", Part: [part] });
    const movie = createPlexMovie({ Media: [media] });
    mockGetItemMetadata.mockResolvedValue(movie);

    const result = await prepareSource({
      server: SERVER,
      ratingKey: RATING_KEY,
      preferences: makePrefs({ directPlayPreference: "auto", quality: "original" }),
      skipCodecCheck: false,
    });

    expect(result.sourceKind).toBe("direct");
  });
});

describe("deriveDisplayTitles", () => {
  it("returns episode format for episodes", () => {
    const ep = createPlexEpisode({
      index: 3,
      parentIndex: 2,
      grandparentTitle: "My Show",
      title: "The Pilot",
    });
    const result = deriveDisplayTitles(ep);
    expect(result.title).toBe("My Show");
    expect(result.subtitle).toBe("S02E03 — The Pilot");
  });

  it("pads season and episode numbers with leading zeros", () => {
    const ep = createPlexEpisode({ index: 1, parentIndex: 1 });
    const result = deriveDisplayTitles(ep);
    expect(result.subtitle).toMatch(/^S01E01/);
  });

  it("returns movie title and year for movies", () => {
    const movie = createPlexMovie({ title: "Inception", year: 2010 });
    const result = deriveDisplayTitles(movie);
    expect(result.title).toBe("Inception");
    expect(result.subtitle).toBe("2010");
  });

  it("returns empty subtitle for movie with no year", () => {
    const movie = createPlexMovie({ title: "No Year" });
    // year is 0 / falsy
    (movie as Record<string, unknown>).year = 0;
    const result = deriveDisplayTitles(movie);
    expect(result.subtitle).toBe("");
  });

  it("returns title and empty subtitle for unknown types", () => {
    const item = { type: "clip", title: "Some Clip" } as import("../types/library").PlexMediaItem;
    const result = deriveDisplayTitles(item);
    expect(result.title).toBe("Some Clip");
    expect(result.subtitle).toBe("");
  });
});
