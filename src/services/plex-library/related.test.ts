import { getRelatedItems, getMediaByActor } from "./related";
import { cacheClear } from "../api-cache";

vi.mock("../plex-api", () => ({
  serverFetch: vi.fn(),
}));

vi.mock("../logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

import { serverFetch } from "../plex-api";
import { logger } from "../logger";

const mockServerFetch = vi.mocked(serverFetch);
const mockLoggerDebug = vi.mocked(logger.debug);

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

const SERVER = "https://plex.example.com:32400";
const TOKEN = "test-token";
const KEY = "12345";

describe("getRelatedItems", () => {
  beforeEach(() => {
    mockServerFetch.mockReset();
    mockLoggerDebug.mockReset();
    cacheClear();
  });

  describe("episode type", () => {
    it("returns empty array without making any network request", async () => {
      const result = await getRelatedItems(SERVER, TOKEN, KEY, "episode");

      expect(result).toEqual([]);
      expect(mockServerFetch).not.toHaveBeenCalled();
    });

    it("logs a debug message when skipping", async () => {
      await getRelatedItems(SERVER, TOKEN, KEY, "episode");

      expect(mockLoggerDebug).toHaveBeenCalledWith(
        "api",
        "getRelatedItems: skipping /similar for episode",
        { ratingKey: KEY }
      );
    });
  });

  describe("movie type", () => {
    it("calls /similar and returns items when they exist", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({
          MediaContainer: {
            Metadata: [
              { ratingKey: "99", title: "Similar Movie", type: "movie" },
            ],
          },
        })
      );

      const result = await getRelatedItems(SERVER, TOKEN, KEY, "movie");

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Similar Movie");
      const calledPath: string = mockServerFetch.mock.calls[0][2] as string;
      expect(calledPath).toContain(`/library/metadata/${KEY}/similar`);
    });

    it("falls through to /related when /similar returns empty", async () => {
      mockServerFetch
        .mockResolvedValueOnce(
          jsonResponse({ MediaContainer: { Metadata: [] } })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            MediaContainer: {
              Metadata: [{ ratingKey: "88", title: "Related Movie", type: "movie" }],
            },
          })
        );

      const result = await getRelatedItems(SERVER, TOKEN, KEY, "movie");

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Related Movie");
      const paths = mockServerFetch.mock.calls.map((c) => c[2] as string);
      expect(paths[0]).toContain("/similar");
      expect(paths[1]).toContain("/related");
    });
  });

  describe("show type", () => {
    it("calls /similar for shows", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({
          MediaContainer: {
            Metadata: [{ ratingKey: "77", title: "Similar Show", type: "show" }],
          },
        })
      );

      const result = await getRelatedItems(SERVER, TOKEN, KEY, "show");

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe("Similar Show");
      const calledPath: string = mockServerFetch.mock.calls[0][2] as string;
      expect(calledPath).toContain(`/library/metadata/${KEY}/similar`);
    });
  });

  describe("no itemType provided (legacy behaviour)", () => {
    it("still calls /similar when itemType is omitted", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({
          MediaContainer: {
            Metadata: [{ ratingKey: "66", title: "Some Item", type: "movie" }],
          },
        })
      );

      const result = await getRelatedItems(SERVER, TOKEN, KEY);

      expect(result).toHaveLength(1);
      const calledPath: string = mockServerFetch.mock.calls[0][2] as string;
      expect(calledPath).toContain("/similar");
    });
  });
});

// ── getMediaByActor (prexu-0szx.4) ──

describe("getMediaByActor", () => {
  beforeEach(() => {
    mockServerFetch.mockReset();
    mockLoggerDebug.mockReset();
    cacheClear();
  });

  function sectionsResponse() {
    return jsonResponse({
      MediaContainer: {
        Directory: [
          { key: "1", title: "Movies", type: "movie" },
          { key: "2", title: "TV Shows", type: "show" },
          { key: "3", title: "Music", type: "artist" },
        ],
      },
    });
  }

  it("queries only movie and show sections with a shelf-sized container", async () => {
    mockServerFetch
      .mockResolvedValueOnce(sectionsResponse())
      .mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "m1", title: "Movie A", type: "movie" }] } })
      )
      .mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "s1", title: "Show A", type: "show" }] } })
      );

    const result = await getMediaByActor(SERVER, TOKEN, "Some Actor");

    expect(result.map((r) => r.ratingKey).sort()).toEqual(["m1", "s1"]);
    // 1 sections call (uncached, first time) + 2 section queries (music skipped)
    expect(mockServerFetch).toHaveBeenCalledTimes(3);

    const sectionPaths = mockServerFetch.mock.calls.slice(1).map((c) => c[2] as string);
    for (const path of sectionPaths) {
      expect(path).toContain("X-Plex-Container-Size=20");
    }
    const showPath = sectionPaths.find((p) => p.startsWith("/library/sections/2/"));
    expect(showPath).toContain("type=2");
  });

  it("dedupes items across sections by ratingKey", async () => {
    mockServerFetch
      .mockResolvedValueOnce(sectionsResponse())
      .mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "dup1", title: "Dup", type: "movie" }] } })
      )
      .mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "dup1", title: "Dup", type: "movie" }] } })
      );

    const result = await getMediaByActor(SERVER, TOKEN, "Actor");
    expect(result).toHaveLength(1);
  });

  it("caches results per actor so a repeat call skips the network entirely", async () => {
    mockServerFetch
      .mockResolvedValueOnce(sectionsResponse())
      .mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "m1", title: "Movie A", type: "movie" }] } })
      )
      .mockResolvedValueOnce(jsonResponse({ MediaContainer: { Metadata: [] } }));

    const first = await getMediaByActor(SERVER, TOKEN, "Cached Actor");
    mockServerFetch.mockClear();

    const second = await getMediaByActor(SERVER, TOKEN, "Cached Actor");

    expect(second).toEqual(first);
    expect(mockServerFetch).not.toHaveBeenCalled();
  });

  it("isolates the cache per actor name (sections stay shared/cached across actors)", async () => {
    mockServerFetch
      .mockResolvedValueOnce(sectionsResponse())
      .mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "m1", title: "Movie A", type: "movie" }] } })
      )
      .mockResolvedValueOnce(jsonResponse({ MediaContainer: { Metadata: [] } }))
      .mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "m2", title: "Movie B", type: "movie" }] } })
      )
      .mockResolvedValueOnce(jsonResponse({ MediaContainer: { Metadata: [] } }));

    const a = await getMediaByActor(SERVER, TOKEN, "Actor A");
    const b = await getMediaByActor(SERVER, TOKEN, "Actor B");

    expect(a.map((i) => i.ratingKey)).toEqual(["m1"]);
    expect(b.map((i) => i.ratingKey)).toEqual(["m2"]);
    // sections fetched once total (cached in base.ts) + 2 section queries per actor = 5
    expect(mockServerFetch).toHaveBeenCalledTimes(5);
  });
});
