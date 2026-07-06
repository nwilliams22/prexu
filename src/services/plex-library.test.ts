import {
  getImageUrl,
  getLibrarySections,
  getLibraryItems,
  searchLibrary,
  markAsWatched,
  markAsUnwatched,
} from "./plex-library";

// Mock plex-api module
vi.mock("./plex-api", () => ({
  serverFetch: vi.fn(),
  getServerHeaders: vi.fn().mockResolvedValue({
    Accept: "application/json",
    "X-Plex-Token": "server-token",
  }),
}));

import { serverFetch } from "./plex-api";
import { cacheClear } from "./api-cache";
const mockServerFetch = vi.mocked(serverFetch);

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

describe("plex-library — pure functions", () => {
  describe("getImageUrl", () => {
    const serverUri = "https://192.168.1.100:32400";
    const token = "test-token";

    it("returns empty string for falsy imagePath", () => {
      expect(getImageUrl(serverUri, token, "", 300, 450)).toBe("");
    });

    it("constructs /photo/:/transcode URL with correct params", () => {
      const url = getImageUrl(
        serverUri,
        token,
        "/library/metadata/123/thumb",
        300,
        450
      );

      expect(url).toContain(`${serverUri}/photo/:/transcode?`);
      const parsed = new URL(url);
      expect(parsed.searchParams.get("url")).toBe("/library/metadata/123/thumb");
      expect(parsed.searchParams.get("width")).toBe("300");
      expect(parsed.searchParams.get("height")).toBe("450");
      expect(parsed.searchParams.get("minSize")).toBe("1");
      expect(parsed.searchParams.get("upscale")).toBe("1");
      expect(parsed.searchParams.get("X-Plex-Token")).toBe("test-token");
    });

    it("handles different dimensions", () => {
      const url = getImageUrl(serverUri, token, "/library/metadata/456/thumb", 150, 225);
      const parsed = new URL(url);
      expect(parsed.searchParams.get("width")).toBe("150");
      expect(parsed.searchParams.get("height")).toBe("225");
    });

    it("handles different server URIs", () => {
      const url = getImageUrl("http://localhost:32400", "other-token", "/library/metadata/1/thumb", 300, 450);
      expect(url).toContain("http://localhost:32400/photo/:/transcode?");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("X-Plex-Token")).toBe("other-token");
    });

    it("encodes special characters in image path", () => {
      const url = getImageUrl(serverUri, token, "/library/metadata/123/thumb?special=val", 300, 450);
      const parsed = new URL(url);
      expect(parsed.searchParams.get("url")).toBe("/library/metadata/123/thumb?special=val");
    });
  });
});

// ── Async functions (require mocked serverFetch) ──

describe("plex-library — async functions", () => {
  beforeEach(() => {
    mockServerFetch.mockReset();
    // getLibrarySections is now short-TTL cached (prexu-0szx.18) — clear
    // between tests so one test's response doesn't leak into the next.
    cacheClear();
  });

  // ── getLibrarySections ──

  describe("getLibrarySections", () => {
    it("returns sections from Directory array", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({
          MediaContainer: {
            size: 2,
            Directory: [
              { key: "1", title: "Movies", type: "movie" },
              { key: "2", title: "TV Shows", type: "show" },
            ],
          },
        })
      );

      const sections = await getLibrarySections("https://server:32400", "token");
      expect(sections).toHaveLength(2);
      expect(sections[0].title).toBe("Movies");
      expect(sections[1].type).toBe("show");
    });

    it("returns empty array when Directory is undefined", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { size: 0 } })
      );

      const sections = await getLibrarySections("https://server:32400", "token");
      expect(sections).toEqual([]);
    });

    it("caches sections so a second call within the TTL skips the network (prexu-0szx.18)", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({
          MediaContainer: {
            size: 1,
            Directory: [{ key: "1", title: "Movies", type: "movie" }],
          },
        })
      );

      const first = await getLibrarySections("https://server:32400", "token");
      const second = await getLibrarySections("https://server:32400", "token");

      expect(first).toEqual(second);
      expect(mockServerFetch).toHaveBeenCalledTimes(1);
    });

    it("cache hits return fresh identities, not the cached reference (SWR re-render contract)", async () => {
      // REGRESSION (PR #45 e2e): useLibrary's revalidation does
      // setSections(await getLibrarySections(...)). When the cache handed back
      // the same array reference, that setState was identity-equal, no
      // re-render happened, and LibraryView's document.title effect never
      // re-fired after the route announcer's generic fallback — the tab title
      // stuck on "Library - Prexu". Every call must yield fresh identities,
      // matching the fresh-JSON-parse behavior callers were built against.
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({
          MediaContainer: {
            size: 1,
            Directory: [{ key: "1", title: "Movies", type: "movie" }],
          },
        })
      );

      const first = await getLibrarySections("https://server:32400", "token");
      const second = await getLibrarySections("https://server:32400", "token");
      const third = await getLibrarySections("https://server:32400", "token");

      expect(second).toEqual(first);
      expect(second).not.toBe(first);       // fresh array
      expect(second[0]).not.toBe(first[0]); // fresh elements (deep copy)
      expect(third).not.toBe(second);
      expect(mockServerFetch).toHaveBeenCalledTimes(1);
    });

    it("isolates the cache per server URI", async () => {
      mockServerFetch
        .mockResolvedValueOnce(
          jsonResponse({
            MediaContainer: { size: 1, Directory: [{ key: "1", title: "Server A", type: "movie" }] },
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            MediaContainer: { size: 1, Directory: [{ key: "2", title: "Server B", type: "movie" }] },
          })
        );

      const a = await getLibrarySections("https://server-a:32400", "token");
      const b = await getLibrarySections("https://server-b:32400", "token");

      expect(a[0].title).toBe("Server A");
      expect(b[0].title).toBe("Server B");
      expect(mockServerFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ── getLibraryItems ──

  describe("getLibraryItems", () => {
    it("returns paginated result", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({
          MediaContainer: {
            size: 2,
            totalSize: 100,
            offset: 0,
            Metadata: [
              { ratingKey: "1", title: "Movie 1" },
              { ratingKey: "2", title: "Movie 2" },
            ],
          },
        })
      );

      const result = await getLibraryItems("https://server:32400", "token", "1");
      expect(result.items).toHaveLength(2);
      expect(result.totalSize).toBe(100);
      expect(result.offset).toBe(0);
      expect(result.hasMore).toBe(true);
    });

    it("sets hasMore to false when at end", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({
          MediaContainer: {
            size: 2,
            totalSize: 2,
            offset: 0,
            Metadata: [
              { ratingKey: "1", title: "M1" },
              { ratingKey: "2", title: "M2" },
            ],
          },
        })
      );

      const result = await getLibraryItems("https://server:32400", "token", "1");
      expect(result.hasMore).toBe(false);
    });

    it("applies sort and filter params to URL", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { size: 0, totalSize: 0, Metadata: [] } })
      );

      await getLibraryItems("https://server:32400", "token", "1", {
        sort: "year:desc",
        filters: { genre: "Action", unwatched: true },
      });

      const path = mockServerFetch.mock.calls[0][2];
      expect(path).toContain("sort=year%3Adesc");
      expect(path).toContain("genre=Action");
      expect(path).toContain("unwatched=1");
      // unwatchedLeaves is only sent for show libraries
      expect(path).not.toContain("unwatchedLeaves=1");
    });

    it("sends unwatchedLeaves for show libraries", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { size: 0, totalSize: 0, Metadata: [] } })
      );

      await getLibraryItems("https://server:32400", "token", "1", {
        filters: { unwatched: true, sectionType: "show" },
      });

      const path = mockServerFetch.mock.calls[0][2];
      expect(path).toContain("unwatchedLeaves=1");
      expect(path).not.toContain("unwatched=1");
    });

    it("handles pagination params", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { size: 0, totalSize: 0, Metadata: [] } })
      );

      await getLibraryItems("https://server:32400", "token", "1", {
        start: 50,
        size: 25,
      });

      const path = mockServerFetch.mock.calls[0][2];
      expect(path).toContain("X-Plex-Container-Start=50");
      expect(path).toContain("X-Plex-Container-Size=25");
    });

    // ── Year range operators (prexu-6qi5.8) ──
    //
    // Plex's filter query language appends the operator to the field name
    // and lets the mandatory `key=value` separator supply the "=" half of
    // >=/<=, so the wire pair `year>=1980` is field name "year>" + value
    // "1980". URLSearchParams percent-encodes ">"/"<" in the key (e.g.
    // "year%3E=1980"), which decodes back to the identical key/value pair —
    // these assertions check for the encoded form actually sent over HTTP.

    it("sends year>= for yearMin", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { size: 0, totalSize: 0, Metadata: [] } })
      );

      await getLibraryItems("https://server:32400", "token", "1", {
        filters: { yearMin: "1980" },
      });

      const path = mockServerFetch.mock.calls[0][2];
      expect(path).toContain("year%3E=1980");
      expect(path).not.toContain("year%3C");
    });

    it("sends year<= for yearMax", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { size: 0, totalSize: 0, Metadata: [] } })
      );

      await getLibraryItems("https://server:32400", "token", "1", {
        filters: { yearMax: "1989" },
      });

      const path = mockServerFetch.mock.calls[0][2];
      expect(path).toContain("year%3C=1989");
      expect(path).not.toContain("year%3E");
    });

    it("sends both bounds for a full year range", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { size: 0, totalSize: 0, Metadata: [] } })
      );

      await getLibraryItems("https://server:32400", "token", "1", {
        filters: { yearMin: "1980", yearMax: "1989" },
      });

      const path = mockServerFetch.mock.calls[0][2];
      expect(path).toContain("year%3E=1980");
      expect(path).toContain("year%3C=1989");

      // Round-trip through URLSearchParams to confirm the server-side
      // decode recovers the documented `year>`/`year<` operator keys.
      const query = path.split("?")[1] ?? "";
      const decoded = new URLSearchParams(query);
      expect(decoded.get("year>")).toBe("1980");
      expect(decoded.get("year<")).toBe("1989");
    });

    it("combines a year range with other filters (ANDed, per Plex's filter semantics)", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { size: 0, totalSize: 0, Metadata: [] } })
      );

      await getLibraryItems("https://server:32400", "token", "1", {
        filters: { genre: "Documentary", yearMin: "1980", yearMax: "1989", unwatched: true },
      });

      const path = mockServerFetch.mock.calls[0][2];
      expect(path).toContain("genre=Documentary");
      expect(path).toContain("year%3E=1980");
      expect(path).toContain("year%3C=1989");
      expect(path).toContain("unwatched=1");
    });

    it("omits year params entirely when no range bound is set", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { size: 0, totalSize: 0, Metadata: [] } })
      );

      await getLibraryItems("https://server:32400", "token", "1", {
        filters: { genre: "Action" },
      });

      const path = mockServerFetch.mock.calls[0][2];
      expect(path).not.toContain("year%3E");
      expect(path).not.toContain("year%3C");
    });
  });

  // ── searchLibrary ──

  describe("searchLibrary", () => {
    it("returns hubs from search results", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({
          MediaContainer: {
            size: 1,
            Hub: [
              {
                hubKey: "/hubs/search/movie",
                title: "Movies",
                type: "movie",
                size: 3,
                Metadata: [
                  { ratingKey: "1", title: "Found Movie" },
                ],
              },
            ],
          },
        })
      );

      const hubs = await searchLibrary("https://server:32400", "token", "found");
      expect(hubs).toHaveLength(1);
      expect(hubs[0].title).toBe("Movies");
    });

    it("encodes query and limit in URL", async () => {
      mockServerFetch.mockResolvedValueOnce(
        jsonResponse({ MediaContainer: { size: 0, Hub: [] } })
      );

      await searchLibrary("https://server:32400", "token", "test query", 20);

      const path = mockServerFetch.mock.calls[0][2];
      expect(path).toContain("query=test+query");
      expect(path).toContain("limit=20");
    });
  });

  // ── markAsWatched / markAsUnwatched ──

  describe("markAsWatched", () => {
    it("calls scrobble endpoint", async () => {
      mockServerFetch.mockResolvedValueOnce(jsonResponse({}));

      await markAsWatched("https://server:32400", "token", "123");

      const path = mockServerFetch.mock.calls[0][2];
      expect(path).toContain("/:/scrobble");
      expect(path).toContain("key=123");
    });

    it("throws on non-ok response", async () => {
      mockServerFetch.mockResolvedValueOnce(jsonResponse({}, 500));
      await expect(
        markAsWatched("https://server:32400", "token", "123")
      ).rejects.toThrow("Failed to mark as watched");
    });
  });

  describe("markAsUnwatched", () => {
    it("calls unscrobble endpoint", async () => {
      mockServerFetch.mockResolvedValueOnce(jsonResponse({}));

      await markAsUnwatched("https://server:32400", "token", "123");

      const path = mockServerFetch.mock.calls[0][2];
      expect(path).toContain("/:/unscrobble");
      expect(path).toContain("key=123");
    });

    it("throws on non-ok response", async () => {
      mockServerFetch.mockResolvedValueOnce(jsonResponse({}, 500));
      await expect(
        markAsUnwatched("https://server:32400", "token", "123")
      ).rejects.toThrow("Failed to mark as unwatched");
    });
  });
});
