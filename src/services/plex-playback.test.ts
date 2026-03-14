import {
  canDirectPlay,
  buildDirectPlayUrl,
  buildTranscodeUrl,
  categorizeStreams,
  reportTimeline,
  reportTimelineBeacon,
  getSavedVolume,
  saveVolume,
  QUALITY_PRESETS,
} from "./plex-playback";
import {
  createPlexMediaInfo,
  createPlexMediaPart,
  createPlexStream,
} from "../__tests__/mocks/plex-data";

// Mock dependencies for async functions
vi.mock("./storage", () => ({
  getClientIdentifier: vi.fn().mockResolvedValue("test-client-id"),
}));

vi.mock("./plex-api", () => ({
  getServerHeaders: vi.fn().mockResolvedValue({
    Accept: "application/json",
    "X-Plex-Token": "server-token",
    "X-Plex-Client-Identifier": "test-client-id",
  }),
}));

const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
vi.stubGlobal("fetch", mockFetch);

describe("plex-playback — pure functions", () => {
  // ── canDirectPlay ──

  describe("canDirectPlay", () => {
    it("returns true for mp4 + h264 + aac", () => {
      const media = createPlexMediaInfo({
        videoCodec: "h264",
        audioCodec: "aac",
        Part: [createPlexMediaPart({ container: "mp4" })],
      });
      expect(canDirectPlay(media)).toBe(true);
    });

    it("returns true for m4v + h264 + aac", () => {
      const media = createPlexMediaInfo({
        videoCodec: "h264",
        audioCodec: "aac",
        Part: [createPlexMediaPart({ container: "m4v" })],
      });
      expect(canDirectPlay(media)).toBe(true);
    });

    it("returns true for mov + h264 + mp3", () => {
      const media = createPlexMediaInfo({
        videoCodec: "h264",
        audioCodec: "mp3",
        Part: [createPlexMediaPart({ container: "mov" })],
      });
      expect(canDirectPlay(media)).toBe(true);
    });

    it("returns true for mp4 + avc1 + aac", () => {
      const media = createPlexMediaInfo({
        videoCodec: "avc1",
        audioCodec: "aac",
        Part: [createPlexMediaPart({ container: "mp4" })],
      });
      expect(canDirectPlay(media)).toBe(true);
    });

    it("returns true for mp4 + h264 + flac", () => {
      const media = createPlexMediaInfo({
        videoCodec: "h264",
        audioCodec: "flac",
        Part: [createPlexMediaPart({ container: "mp4" })],
      });
      expect(canDirectPlay(media)).toBe(true);
    });

    it("returns true for mp4 + h264 + opus", () => {
      const media = createPlexMediaInfo({
        videoCodec: "h264",
        audioCodec: "opus",
        Part: [createPlexMediaPart({ container: "mp4" })],
      });
      expect(canDirectPlay(media)).toBe(true);
    });

    it("returns true for mp4 + h264 + ac3", () => {
      const media = createPlexMediaInfo({
        videoCodec: "h264",
        audioCodec: "ac3",
        Part: [createPlexMediaPart({ container: "mp4" })],
      });
      expect(canDirectPlay(media)).toBe(true);
    });

    it("returns true for mp4 + h264 + eac3", () => {
      const media = createPlexMediaInfo({
        videoCodec: "h264",
        audioCodec: "eac3",
        Part: [createPlexMediaPart({ container: "mp4" })],
      });
      expect(canDirectPlay(media)).toBe(true);
    });

    it("returns false for mkv container", () => {
      const media = createPlexMediaInfo({
        videoCodec: "h264",
        audioCodec: "aac",
        Part: [createPlexMediaPart({ container: "mkv" })],
      });
      expect(canDirectPlay(media)).toBe(false);
    });

    it("returns false for avi container", () => {
      const media = createPlexMediaInfo({
        videoCodec: "h264",
        audioCodec: "aac",
        Part: [createPlexMediaPart({ container: "avi" })],
      });
      expect(canDirectPlay(media)).toBe(false);
    });

    it("returns false for hevc video codec", () => {
      const media = createPlexMediaInfo({
        videoCodec: "hevc",
        audioCodec: "aac",
        Part: [createPlexMediaPart({ container: "mp4" })],
      });
      expect(canDirectPlay(media)).toBe(false);
    });

    it("returns false for h265 video codec", () => {
      const media = createPlexMediaInfo({
        videoCodec: "h265",
        audioCodec: "aac",
        Part: [createPlexMediaPart({ container: "mp4" })],
      });
      expect(canDirectPlay(media)).toBe(false);
    });

    it("returns false for dts audio codec", () => {
      const media = createPlexMediaInfo({
        videoCodec: "h264",
        audioCodec: "dts",
        Part: [createPlexMediaPart({ container: "mp4" })],
      });
      expect(canDirectPlay(media)).toBe(false);
    });

    it("returns false for truehd audio codec", () => {
      const media = createPlexMediaInfo({
        videoCodec: "h264",
        audioCodec: "truehd",
        Part: [createPlexMediaPart({ container: "mp4" })],
      });
      expect(canDirectPlay(media)).toBe(false);
    });

    it("returns false when Part array is empty", () => {
      const media = createPlexMediaInfo({ Part: [] });
      expect(canDirectPlay(media)).toBe(false);
    });

    it("returns false when Part is undefined", () => {
      const media = createPlexMediaInfo({ Part: undefined });
      expect(canDirectPlay(media)).toBe(false);
    });

    it("handles case-insensitive codecs", () => {
      const media = createPlexMediaInfo({
        videoCodec: "H264",
        audioCodec: "AAC",
        Part: [createPlexMediaPart({ container: "MP4" })],
      });
      expect(canDirectPlay(media)).toBe(true);
    });

    it("handles mixed-case codecs", () => {
      const media = createPlexMediaInfo({
        videoCodec: "H264",
        audioCodec: "Aac",
        Part: [createPlexMediaPart({ container: "Mp4" })],
      });
      expect(canDirectPlay(media)).toBe(true);
    });
  });

  // ── buildDirectPlayUrl ──

  describe("buildDirectPlayUrl", () => {
    it("constructs correct URL with token param", () => {
      const url = buildDirectPlayUrl(
        "https://192.168.1.100:32400",
        "my-token",
        "/library/parts/123/file.mp4"
      );
      expect(url).toBe(
        "https://192.168.1.100:32400/library/parts/123/file.mp4?X-Plex-Token=my-token"
      );
    });

    it("handles special characters in token", () => {
      const url = buildDirectPlayUrl(
        "https://server:32400",
        "token+with&special=chars",
        "/library/parts/1/file.mp4"
      );
      expect(url).toContain("X-Plex-Token=token%2Bwith%26special%3Dchars");
    });

    it("works with different server URIs", () => {
      const url = buildDirectPlayUrl(
        "http://localhost:32400",
        "test-token",
        "/library/parts/456/movie.mp4"
      );
      expect(url).toContain("http://localhost:32400/library/parts/456/movie.mp4");
      expect(url).toContain("X-Plex-Token=test-token");
    });
  });

  // ── categorizeStreams ──

  describe("categorizeStreams", () => {
    it("categorizes video, audio, and subtitle streams", () => {
      const part = createPlexMediaPart({
        Stream: [
          createPlexStream({ streamType: 1, codec: "h264", displayTitle: "1080p" }),
          createPlexStream({ streamType: 2, codec: "aac", displayTitle: "English AAC" }),
          createPlexStream({ streamType: 2, codec: "dts", displayTitle: "English DTS" }),
          createPlexStream({ streamType: 3, codec: "srt", displayTitle: "English SRT" }),
        ],
      });

      const result = categorizeStreams(part);

      expect(result.video).not.toBeNull();
      expect(result.video!.streamType).toBe(1);
      expect(result.audio).toHaveLength(2);
      expect(result.audio[0].streamType).toBe(2);
      expect(result.audio[1].streamType).toBe(2);
      expect(result.subtitles).toHaveLength(1);
      expect(result.subtitles[0].streamType).toBe(3);
    });

    it("returns null video when no video stream exists", () => {
      const part = createPlexMediaPart({
        Stream: [
          createPlexStream({ streamType: 2, codec: "aac" }),
        ],
      });

      const result = categorizeStreams(part);
      expect(result.video).toBeNull();
      expect(result.audio).toHaveLength(1);
      expect(result.subtitles).toHaveLength(0);
    });

    it("handles empty streams array", () => {
      const part = createPlexMediaPart({ Stream: [] });
      const result = categorizeStreams(part);
      expect(result.video).toBeNull();
      expect(result.audio).toHaveLength(0);
      expect(result.subtitles).toHaveLength(0);
    });

    it("handles undefined streams", () => {
      const part = createPlexMediaPart({ Stream: undefined });
      const result = categorizeStreams(part);
      expect(result.video).toBeNull();
      expect(result.audio).toHaveLength(0);
      expect(result.subtitles).toHaveLength(0);
    });

    it("picks the first video stream when multiple exist", () => {
      const part = createPlexMediaPart({
        Stream: [
          createPlexStream({ streamType: 1, codec: "h264", displayTitle: "1080p" }),
          createPlexStream({ streamType: 1, codec: "hevc", displayTitle: "4K" }),
        ],
      });

      const result = categorizeStreams(part);
      expect(result.video!.displayTitle).toBe("1080p");
    });
  });

  // ── getSavedVolume / saveVolume ──

  describe("getSavedVolume / saveVolume", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("returns 1 when no stored value", () => {
      expect(getSavedVolume()).toBe(1);
    });

    it("returns stored value when valid", () => {
      localStorage.setItem("prexu_volume", "0.5");
      expect(getSavedVolume()).toBe(0.5);
    });

    it("returns stored value at boundaries", () => {
      localStorage.setItem("prexu_volume", "0");
      expect(getSavedVolume()).toBe(0);

      localStorage.setItem("prexu_volume", "1");
      expect(getSavedVolume()).toBe(1);
    });

    it("returns 1 for invalid (NaN) value", () => {
      localStorage.setItem("prexu_volume", "not-a-number");
      expect(getSavedVolume()).toBe(1);
    });

    it("returns 1 for out-of-range values", () => {
      localStorage.setItem("prexu_volume", "1.5");
      expect(getSavedVolume()).toBe(1);

      localStorage.setItem("prexu_volume", "-0.5");
      expect(getSavedVolume()).toBe(1);
    });

    it("saveVolume stores to localStorage", () => {
      saveVolume(0.75);
      expect(localStorage.getItem("prexu_volume")).toBe("0.75");
    });

    it("round-trips through save and get", () => {
      saveVolume(0.33);
      expect(getSavedVolume()).toBe(0.33);
    });
  });

  // ── QUALITY_PRESETS ──

  describe("QUALITY_PRESETS", () => {
    it("has 1080p preset", () => {
      expect(QUALITY_PRESETS["1080p"]).toEqual({
        resolution: "1920x1080",
        bitrate: 20000,
      });
    });

    it("has 720p preset", () => {
      expect(QUALITY_PRESETS["720p"]).toEqual({
        resolution: "1280x720",
        bitrate: 4000,
      });
    });

    it("has 480p preset", () => {
      expect(QUALITY_PRESETS["480p"]).toEqual({
        resolution: "720x480",
        bitrate: 2000,
      });
    });
  });
});

// ── Async functions (require mocked fetch / storage) ──

describe("plex-playback — async functions", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true } as Response);
  });

  // ── buildTranscodeUrl ──

  describe("buildTranscodeUrl", () => {
    it("builds a transcode URL with default options", async () => {
      const url = await buildTranscodeUrl(
        "https://server:32400",
        "my-token",
        "12345"
      );

      expect(url).toContain("https://server:32400/video/:/transcode/universal/start.m3u8?");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("path")).toBe("/library/metadata/12345");
      expect(parsed.searchParams.get("protocol")).toBe("hls");
      expect(parsed.searchParams.get("videoResolution")).toBe("1920x1080");
      expect(parsed.searchParams.get("maxVideoBitrate")).toBe("20000");
      expect(parsed.searchParams.get("X-Plex-Token")).toBe("my-token");
      expect(parsed.searchParams.get("X-Plex-Client-Identifier")).toBe("test-client-id");
    });

    it("applies quality preset", async () => {
      const url = await buildTranscodeUrl(
        "https://server:32400",
        "token",
        "1",
        { quality: "720p" }
      );

      const parsed = new URL(url);
      expect(parsed.searchParams.get("videoResolution")).toBe("1280x720");
      expect(parsed.searchParams.get("maxVideoBitrate")).toBe("4000");
    });

    it("sets offset when provided", async () => {
      const url = await buildTranscodeUrl(
        "https://server:32400",
        "token",
        "1",
        { offset: 30000 }
      );

      const parsed = new URL(url);
      expect(parsed.searchParams.get("offset")).toBe("30000");
    });

    it("does not set offset when 0", async () => {
      const url = await buildTranscodeUrl(
        "https://server:32400",
        "token",
        "1",
        { offset: 0 }
      );

      const parsed = new URL(url);
      expect(parsed.searchParams.has("offset")).toBe(false);
    });

    it("sets audio stream ID", async () => {
      const url = await buildTranscodeUrl(
        "https://server:32400",
        "token",
        "1",
        { audioStreamId: 42 }
      );

      const parsed = new URL(url);
      expect(parsed.searchParams.get("audioStreamID")).toBe("42");
    });

    it("sets subtitle stream ID and burn subtitles", async () => {
      const url = await buildTranscodeUrl(
        "https://server:32400",
        "token",
        "1",
        { subtitleStreamId: 99 }
      );

      const parsed = new URL(url);
      expect(parsed.searchParams.get("subtitleStreamID")).toBe("99");
      expect(parsed.searchParams.get("subtitles")).toBe("burn");
    });

    it("omits subtitles param when no subtitle stream", async () => {
      const url = await buildTranscodeUrl(
        "https://server:32400",
        "token",
        "1"
      );

      const parsed = new URL(url);
      expect(parsed.searchParams.get("subtitles")).toBeNull();
    });

    it("applies custom subtitle size and audio boost", async () => {
      const url = await buildTranscodeUrl(
        "https://server:32400",
        "token",
        "1",
        { subtitleSize: 150, audioBoost: 200 }
      );

      const parsed = new URL(url);
      expect(parsed.searchParams.get("subtitleSize")).toBe("150");
      expect(parsed.searchParams.get("audioBoost")).toBe("200");
    });
  });

  // ── reportTimeline ──

  describe("reportTimeline", () => {
    it("makes GET request with correct params", async () => {
      await reportTimeline(
        "https://server:32400",
        "my-token",
        "12345",
        "playing",
        60000,
        7200000
      );

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("https://server:32400/:/timeline?");
      expect(url).toContain("ratingKey=12345");
      expect(url).toContain("state=playing");
      expect(url).toContain("time=60000");
      expect(url).toContain("duration=7200000");
      expect(options.method).toBe("GET");
    });

    it("does not throw on fetch failure (best-effort)", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      // Should not throw
      await reportTimeline(
        "https://server:32400",
        "token",
        "1",
        "stopped",
        0,
        0
      );
    });
  });

  // ── reportTimelineBeacon ──

  describe("reportTimelineBeacon", () => {
    it("uses sendBeacon when available", async () => {
      const mockBeacon = vi.fn<(url: string, data?: BodyInit | null) => boolean>(() => true);
      Object.defineProperty(navigator, "sendBeacon", {
        value: mockBeacon,
        writable: true,
      });

      await reportTimelineBeacon(
        "https://server:32400",
        "my-token",
        "12345",
        30000,
        7200000
      );

      expect(mockBeacon).toHaveBeenCalledOnce();
      const beaconUrl = mockBeacon.mock.calls[0][0];
      expect(beaconUrl).toContain("https://server:32400/:/timeline?");
      expect(beaconUrl).toContain("state=stopped");
      expect(beaconUrl).toContain("ratingKey=12345");
    });
  });
});
