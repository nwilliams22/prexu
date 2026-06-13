import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetchJson = vi.fn();
const mockFetch = vi.fn();
const mockGetItemMetadata = vi.fn();

vi.mock("./plex-library/base", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

vi.mock("./plex-library", () => ({
  getItemMetadata: (...args: unknown[]) => mockGetItemMetadata(...args),
}));

vi.mock("./plex-api", () => ({
  getServerHeaders: vi.fn().mockResolvedValue({ Accept: "application/json" }),
  timedFetch: (...args: unknown[]) => mockFetch(...args),
}));

import {
  searchSubtitles,
  downloadSubtitle,
  setSelectedSubtitleStream,
  waitForDownloadedSubtitle,
} from "./subtitle-search";

const SERVER = "https://server.example:32400";
const TOKEN = "tok";

beforeEach(() => {
  mockFetchJson.mockReset();
  mockFetch.mockReset();
  mockGetItemMetadata.mockReset();
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
            title: "Movie.2026.1080p.WEBRip.srt",
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
      fileName: "Movie.2026.1080p.WEBRip.srt",
      language: "English",
      format: "srt",
      hearingImpaired: true,
      matchConfidence: 0.92,
      provider: "OpenSubtitles",
    });
    // title (source filename) preferred for fileName; srt fallback format;
    // score absent → null confidence so the UI hides the match percentage
    expect(results[1]).toMatchObject({
      id: "102",
      fileName: "fallback-title.srt",
      format: "srt",
      hearingImpaired: false,
      matchConfidence: null,
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

  it("maps ISO 639-2 codes to 639-1 (Plex agent 500s on three-letter codes)", async () => {
    mockFetchJson.mockResolvedValue({ MediaContainer: { size: 0 } });
    await searchSubtitles(SERVER, TOKEN, "1", "deu");
    expect(mockFetchJson).toHaveBeenCalledWith(
      SERVER,
      TOKEN,
      "/library/metadata/1/subtitles?language=de",
    );
    await searchSubtitles(SERVER, TOKEN, "1", "eng");
    expect(mockFetchJson).toHaveBeenLastCalledWith(
      SERVER,
      TOKEN,
      "/library/metadata/1/subtitles?language=en",
    );
  });

  it("maps ISO 639-2/B codes to the same 639-1 targets as their /T counterparts", async () => {
    mockFetchJson.mockResolvedValue({ MediaContainer: { size: 0 } });

    const cases: [string, string][] = [
      ["fre", "fr"], // French   — /B alias for fra
      ["ger", "de"], // German   — /B alias for deu
      ["chi", "zh"], // Chinese  — /B alias for zho
      ["dut", "nl"], // Dutch    — /B alias for nld
      ["cze", "cs"], // Czech    — /B alias for ces
      ["gre", "el"], // Greek    — /B alias for ell
      ["ice", "is"], // Icelandic — /B alias for isl
      ["mac", "mk"], // Macedonian — /B alias for mkd
      ["may", "ms"], // Malay    — /B alias for msa
      ["bur", "my"], // Burmese  — /B alias for mya
      ["per", "fa"], // Persian  — /B alias for fas
      ["rum", "ro"], // Romanian — /B alias for ron
      ["slo", "sk"], // Slovak   — /B alias for slk
      ["tib", "bo"], // Tibetan  — /B alias for bod
      ["wel", "cy"], // Welsh    — /B alias for cym
      ["arm", "hy"], // Armenian — /B alias for hye
      ["geo", "ka"], // Georgian — /B alias for kat
      ["baq", "eu"], // Basque   — /B alias for eus
      ["alb", "sq"], // Albanian — /B alias for sqi
    ];

    for (const [b, one] of cases) {
      mockFetchJson.mockClear();
      await searchSubtitles(SERVER, TOKEN, "1", b);
      expect(mockFetchJson).toHaveBeenCalledWith(
        SERVER,
        TOKEN,
        `/library/metadata/1/subtitles?language=${one}`,
      );
    }
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

describe("waitForDownloadedSubtitle", () => {
  const metaWithSubs = (streams: object[]) => ({
    ratingKey: "67632",
    Media: [
      {
        id: 1,
        Part: [{ id: 5523, key: "/library/parts/5523", Stream: streams }],
      },
    ],
  });

  it("returns the new stream and full track list once it appears", async () => {
    mockGetItemMetadata.mockResolvedValue(
      metaWithSubs([
        { id: 7, streamType: 3, codec: "srt", displayTitle: "English" },
        { id: 8, streamType: 3, codec: "srt", displayTitle: "Spanish", title: "Movie.spa.srt" },
        { id: 1, streamType: 1, codec: "h264" },
      ]),
    );

    const result = await waitForDownloadedSubtitle(SERVER, TOKEN, "67632", 5523, [7], 3, 0);

    expect(result).not.toBeNull();
    expect(result!.added.id).toBe(8);
    expect(result!.tracks.map((t) => t.id)).toEqual([7, 8]);
  });

  it("polls until the stream appears", async () => {
    mockGetItemMetadata
      .mockResolvedValueOnce(metaWithSubs([{ id: 7, streamType: 3, codec: "srt", displayTitle: "English" }]))
      .mockResolvedValueOnce(
        metaWithSubs([
          { id: 7, streamType: 3, codec: "srt", displayTitle: "English" },
          { id: 8, streamType: 3, codec: "srt", displayTitle: "Spanish" },
        ]),
      );

    const result = await waitForDownloadedSubtitle(SERVER, TOKEN, "67632", 5523, [7], 3, 0);

    expect(mockGetItemMetadata).toHaveBeenCalledTimes(2);
    expect(result!.added.id).toBe(8);
  });

  it("returns null when no new stream appears within the attempt budget", async () => {
    mockGetItemMetadata.mockResolvedValue(
      metaWithSubs([{ id: 7, streamType: 3, codec: "srt", displayTitle: "English" }]),
    );

    const result = await waitForDownloadedSubtitle(SERVER, TOKEN, "67632", 5523, [7], 2, 0);

    expect(result).toBeNull();
    expect(mockGetItemMetadata).toHaveBeenCalledTimes(2);
  });

  it("survives poll errors and keeps retrying", async () => {
    mockGetItemMetadata
      .mockRejectedValueOnce(new Error("Plex API error: 500"))
      .mockResolvedValueOnce(
        metaWithSubs([
          { id: 7, streamType: 3, codec: "srt", displayTitle: "English" },
          { id: 9, streamType: 3, codec: "srt", displayTitle: "Spanish" },
        ]),
      );

    const result = await waitForDownloadedSubtitle(SERVER, TOKEN, "67632", 5523, [7], 3, 0);

    expect(result!.added.id).toBe(9);
  });

  it("falls back to the first part when partId does not match", async () => {
    mockGetItemMetadata.mockResolvedValue(
      metaWithSubs([
        { id: 7, streamType: 3, codec: "srt", displayTitle: "English" },
        { id: 8, streamType: 3, codec: "srt", displayTitle: "Spanish" },
      ]),
    );

    const result = await waitForDownloadedSubtitle(SERVER, TOKEN, "67632", undefined, [7], 1, 0);

    expect(result!.added.id).toBe(8);
  });
});
