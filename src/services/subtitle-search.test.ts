import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetchJson = vi.fn();
const mockFetch = vi.fn();

vi.mock("./plex-library/base", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

vi.mock("./plex-api", () => ({
  getServerHeaders: vi.fn().mockResolvedValue({ Accept: "application/json" }),
  timedFetch: (...args: unknown[]) => mockFetch(...args),
}));

import {
  searchSubtitles,
  downloadSubtitle,
  setSelectedSubtitleStream,
} from "./subtitle-search";

const SERVER = "https://server.example:32400";
const TOKEN = "tok";

beforeEach(() => {
  mockFetchJson.mockReset();
  mockFetch.mockReset();
});

describe("searchSubtitles", () => {
  it("parses results from MediaContainer.Stream (not Metadata)", async () => {
    mockFetchJson.mockResolvedValue({
      MediaContainer: {
        size: 2,
        Stream: [
          {
            id: 101,
            key: "/library/streams/101",
            codec: "srt",
            providerTitle: "OpenSubtitles",
            score: 92,
            displayTitle: "English (SRT)",
            language: "English",
            languageCode: "en",
            hearingImpaired: 1,
          },
          {
            id: "102",
            key: "/library/streams/102",
            title: "fallback-title.srt",
          },
        ],
      },
    });

    const results = await searchSubtitles(SERVER, TOKEN, "67632", "en");

    expect(mockFetchJson).toHaveBeenCalledWith(
      SERVER,
      TOKEN,
      "/library/metadata/67632/subtitles?language=en",
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      id: "101",
      key: "/library/streams/101",
      fileName: "English (SRT)",
      language: "English",
      format: "srt",
      hearingImpaired: true,
      matchConfidence: 0.92,
      provider: "OpenSubtitles",
    });
    // Fallbacks: title for fileName, srt format, score absent → 0 confidence
    expect(results[1]).toMatchObject({
      id: "102",
      fileName: "fallback-title.srt",
      format: "srt",
      hearingImpaired: false,
      matchConfidence: 0,
      provider: "unknown",
    });
  });

  it("returns empty array when MediaContainer has no Stream entries", async () => {
    mockFetchJson.mockResolvedValue({ MediaContainer: { size: 0 } });
    const results = await searchSubtitles(SERVER, TOKEN, "1", "de");
    expect(results).toEqual([]);
  });

  it("caps matchConfidence at 1 for scores above 100", async () => {
    mockFetchJson.mockResolvedValue({
      MediaContainer: {
        size: 1,
        Stream: [{ id: 1, key: "/k", score: 150 }],
      },
    });
    const results = await searchSubtitles(SERVER, TOKEN, "1", "en");
    expect(results[0].matchConfidence).toBe(1);
  });

  it("URL-encodes the language parameter", async () => {
    mockFetchJson.mockResolvedValue({ MediaContainer: { size: 0 } });
    await searchSubtitles(SERVER, TOKEN, "1", "pt-BR");
    expect(mockFetchJson).toHaveBeenCalledWith(
      SERVER,
      TOKEN,
      "/library/metadata/1/subtitles?language=pt-BR",
    );
  });
});

describe("downloadSubtitle", () => {
  it("PUTs the subtitle key to the metadata subtitles endpoint", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await downloadSubtitle(SERVER, TOKEN, "67632", "/library/streams/101");
    expect(mockFetch).toHaveBeenCalledWith(
      `${SERVER}/library/metadata/67632/subtitles?key=${encodeURIComponent("/library/streams/101")}`,
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(
      downloadSubtitle(SERVER, TOKEN, "67632", "/k"),
    ).rejects.toThrow("Failed to download subtitle: 500");
  });
});

describe("setSelectedSubtitleStream", () => {
  it("PUTs subtitleStreamID with allParts=1 to the parts endpoint", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await setSelectedSubtitleStream(SERVER, TOKEN, 5523, 101);
    expect(mockFetch).toHaveBeenCalledWith(
      `${SERVER}/library/parts/5523?subtitleStreamID=101&allParts=1`,
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("sends subtitleStreamID=0 when clearing the selection (null)", async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await setSelectedSubtitleStream(SERVER, TOKEN, 5523, null);
    expect(mockFetch).toHaveBeenCalledWith(
      `${SERVER}/library/parts/5523?subtitleStreamID=0&allParts=1`,
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });
    await expect(
      setSelectedSubtitleStream(SERVER, TOKEN, 5523, 101),
    ).rejects.toThrow("Failed to set subtitle stream: 403");
  });
});
