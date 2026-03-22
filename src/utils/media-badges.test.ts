import { describe, it, expect } from "vitest";
import {
  getResolutionBadge,
  getHdrBadge,
  getAudioBadge,
  getMediaBadges,
  formatBitrate,
  extractStreamsForBadges,
} from "./media-badges";
import type { PlexMediaInfo, PlexStream } from "../types/library";

describe("getResolutionBadge", () => {
  it("returns 4K for 2160", () => {
    expect(getResolutionBadge("2160")).toBe("4K");
  });

  it("returns 4K for 4k (case-insensitive)", () => {
    expect(getResolutionBadge("4k")).toBe("4K");
    expect(getResolutionBadge("4K")).toBe("4K");
  });

  it("returns 1080p for 1080", () => {
    expect(getResolutionBadge("1080")).toBe("1080p");
  });

  it("returns 720p for 720", () => {
    expect(getResolutionBadge("720")).toBe("720p");
  });

  it("returns SD for 480 and 576", () => {
    expect(getResolutionBadge("480")).toBe("SD");
    expect(getResolutionBadge("576")).toBe("SD");
  });

  it("returns null for unknown resolutions", () => {
    expect(getResolutionBadge("360")).toBeNull();
    expect(getResolutionBadge("unknown")).toBeNull();
  });
});

describe("getHdrBadge", () => {
  it("returns DV when DOVIPresent is true", () => {
    const stream = { DOVIPresent: true } as PlexStream;
    expect(getHdrBadge(stream)).toBe("DV");
  });

  it("returns DV from extendedDisplayTitle", () => {
    const stream = { extendedDisplayTitle: "HEVC Main 10 Dolby Vision" } as PlexStream;
    expect(getHdrBadge(stream)).toBe("DV");
  });

  it("returns HDR10 from extendedDisplayTitle", () => {
    const stream = { extendedDisplayTitle: "HEVC Main 10 HDR10" } as PlexStream;
    expect(getHdrBadge(stream)).toBe("HDR10");
  });

  it("returns HDR from bt2020 colorspace with 10-bit depth", () => {
    const stream = { colorSpace: "bt2020", bitDepth: 10 } as PlexStream;
    expect(getHdrBadge(stream)).toBe("HDR");
  });

  it("returns null for SDR content", () => {
    const stream = { colorSpace: "bt709", bitDepth: 8 } as PlexStream;
    expect(getHdrBadge(stream)).toBeNull();
  });

  it("returns null when no stream provided", () => {
    expect(getHdrBadge(null)).toBeNull();
    expect(getHdrBadge(undefined)).toBeNull();
  });
});

describe("getAudioBadge", () => {
  it("returns Atmos from extendedDisplayTitle", () => {
    const stream = { extendedDisplayTitle: "TrueHD 7.1 (Atmos)" } as PlexStream;
    expect(getAudioBadge("truehd", 8, undefined, stream)).toBe("Atmos");
  });

  it("returns DTS:X from extendedDisplayTitle", () => {
    const stream = { extendedDisplayTitle: "DTS:X 7.1" } as PlexStream;
    expect(getAudioBadge("dca", 8, undefined, stream)).toBe("DTS:X");
  });

  it("returns TrueHD for truehd codec with 6+ channels", () => {
    expect(getAudioBadge("truehd", 8)).toBe("TrueHD");
    expect(getAudioBadge("truehd", 6)).toBe("TrueHD");
  });

  it("returns DTS-HD MA for DTS with ma profile", () => {
    expect(getAudioBadge("dca", 6, "ma")).toBe("DTS-HD MA");
    expect(getAudioBadge("dts", 6, "ma")).toBe("DTS-HD MA");
  });

  it("returns DTS for DTS codec with 6+ channels", () => {
    expect(getAudioBadge("dca", 6)).toBe("DTS");
    expect(getAudioBadge("dts", 8)).toBe("DTS");
  });

  it("returns null for standard codecs", () => {
    expect(getAudioBadge("aac", 2)).toBeNull();
    expect(getAudioBadge("ac3", 6)).toBeNull();
    expect(getAudioBadge("mp3", 2)).toBeNull();
  });
});

describe("getMediaBadges", () => {
  it("returns resolution, HDR, and audio badges", () => {
    const media: PlexMediaInfo = {
      id: 1,
      duration: 7200000,
      bitrate: 20000,
      videoResolution: "2160",
      videoCodec: "hevc",
      audioCodec: "truehd",
      audioChannels: 8,
      Part: [{
        id: 1, key: "/library/parts/1", duration: 7200000,
        file: "movie.mkv", size: 50000000000, container: "mkv",
        Stream: [
          { id: 1, streamType: 1, codec: "hevc", index: 0, displayTitle: "4K HDR10", colorSpace: "bt2020", bitDepth: 10 } as PlexStream,
          { id: 2, streamType: 2, codec: "truehd", index: 1, displayTitle: "English TrueHD 7.1", extendedDisplayTitle: "English (TrueHD 7.1 Atmos)", channels: 8 } as PlexStream,
        ],
      }],
    };

    const { videoStream, audioStream } = extractStreamsForBadges(media);
    const badges = getMediaBadges(media, videoStream, audioStream);

    expect(badges).toHaveLength(3);
    expect(badges[0]).toEqual({ label: "4K", type: "resolution" });
    expect(badges[1]).toEqual({ label: "HDR", type: "hdr" });
    expect(badges[2]).toEqual({ label: "Atmos", type: "audio" });
  });

  it("returns only resolution for basic 1080p content", () => {
    const media: PlexMediaInfo = {
      id: 1, duration: 7200000, bitrate: 8000,
      videoResolution: "1080", videoCodec: "h264",
      audioCodec: "aac", audioChannels: 2,
    };

    const badges = getMediaBadges(media);
    expect(badges).toHaveLength(1);
    expect(badges[0]).toEqual({ label: "1080p", type: "resolution" });
  });
});

describe("formatBitrate", () => {
  it("formats Mbps for high bitrates", () => {
    expect(formatBitrate(20000)).toBe("20.0 Mbps");
    expect(formatBitrate(8500)).toBe("8.5 Mbps");
  });

  it("formats Kbps for low bitrates", () => {
    expect(formatBitrate(856)).toBe("856 Kbps");
    expect(formatBitrate(500)).toBe("500 Kbps");
  });
});

describe("extractStreamsForBadges", () => {
  it("extracts first video and audio streams", () => {
    const media: PlexMediaInfo = {
      id: 1, duration: 100, bitrate: 1000,
      videoResolution: "1080", videoCodec: "h264",
      audioCodec: "aac", audioChannels: 2,
      Part: [{
        id: 1, key: "/k", duration: 100, file: "f", size: 100, container: "mkv",
        Stream: [
          { id: 1, streamType: 1, codec: "h264", index: 0, displayTitle: "Video" } as PlexStream,
          { id: 2, streamType: 2, codec: "aac", index: 1, displayTitle: "Audio" } as PlexStream,
          { id: 3, streamType: 3, codec: "srt", index: 2, displayTitle: "Subs" } as PlexStream,
        ],
      }],
    };

    const { videoStream, audioStream } = extractStreamsForBadges(media);
    expect(videoStream?.id).toBe(1);
    expect(audioStream?.id).toBe(2);
  });

  it("returns null when no parts", () => {
    const media: PlexMediaInfo = {
      id: 1, duration: 100, bitrate: 1000,
      videoResolution: "1080", videoCodec: "h264",
      audioCodec: "aac", audioChannels: 2,
    };

    const { videoStream, audioStream } = extractStreamsForBadges(media);
    expect(videoStream).toBeNull();
    expect(audioStream).toBeNull();
  });
});
