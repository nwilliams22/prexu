import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isValidImdbId,
  getTmdbImageUrl,
  searchTmdbMovies,
  searchTmdbTvShows,
  findByImdbId,
  isTmdbAvailable,
  searchTmdbPerson,
  getTmdbPersonDetail,
  getTmdbPersonCredits,
  resetTmdbRelayCache,
} from "./tmdb";

// Mock storage to return a known relay URL
vi.mock("./storage", () => ({
  getRelayHttpUrl: vi.fn().mockResolvedValue("http://relay.test:9847"),
  getServer: vi.fn().mockResolvedValue(null),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock plex-api to provide timedFetch that delegates to the mocked fetch
vi.mock("./plex-api", () => ({
  timedFetch: (...args: unknown[]) => mockFetch(...args),
}));

function jsonResponse(data: unknown, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    statusText: ok ? "OK" : "Not Found",
    json: () => Promise.resolve(data),
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  resetTmdbRelayCache();
});

// ── isValidImdbId ──

describe("isValidImdbId", () => {
  it("returns true for valid IMDb IDs with 7 digits", () => {
    expect(isValidImdbId("tt1234567")).toBe(true);
  });

  it("returns true for valid IMDb IDs with more than 7 digits", () => {
    expect(isValidImdbId("tt12345678")).toBe(true);
  });

  it("returns false for IDs missing the tt prefix", () => {
    expect(isValidImdbId("1234567")).toBe(false);
  });

  it("returns false for IDs with fewer than 7 digits", () => {
    expect(isValidImdbId("tt123456")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidImdbId("")).toBe(false);
  });
});

// ── getTmdbImageUrl ──

describe("getTmdbImageUrl", () => {
  it("returns full URL with default size", () => {
    expect(getTmdbImageUrl("/abc.jpg")).toBe(
      "https://image.tmdb.org/t/p/w342/abc.jpg",
    );
  });

  it("returns full URL with custom size", () => {
    expect(getTmdbImageUrl("/abc.jpg", "w500")).toBe(
      "https://image.tmdb.org/t/p/w500/abc.jpg",
    );
  });

  it("returns null when path is null", () => {
    expect(getTmdbImageUrl(null)).toBeNull();
  });

  it("returns null when path is empty string", () => {
    expect(getTmdbImageUrl("")).toBeNull();
  });
});

// ── searchTmdbMovies ──

describe("searchTmdbMovies", () => {
  it("returns results and totalResults on success", async () => {
    mockFetch.mockReturnValue(
      jsonResponse({ results: [{ id: 1, title: "Test" }], total_results: 1 }),
    );
    const result = await searchTmdbMovies("Test");
    expect(result.results).toEqual([{ id: 1, title: "Test" }]);
    expect(result.totalResults).toBe(1);
  });

  it("calls relay proxy URL", async () => {
    mockFetch.mockReturnValue(
      jsonResponse({ results: [], total_results: 0 }),
    );
    await searchTmdbMovies("Test");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("http://relay.test:9847/tmdb/search/movie"),
    );
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockReturnValue(jsonResponse({}, false, 401));
    await expect(searchTmdbMovies("Test")).rejects.toThrow(
      "TMDb proxy error",
    );
  });
});

// ── searchTmdbTvShows ──

describe("searchTmdbTvShows", () => {
  it("returns results and totalResults on success", async () => {
    mockFetch.mockReturnValue(
      jsonResponse({ results: [{ id: 2, name: "Show" }], total_results: 5 }),
    );
    const result = await searchTmdbTvShows("Show");
    expect(result.results).toEqual([{ id: 2, name: "Show" }]);
    expect(result.totalResults).toBe(5);
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockReturnValue(jsonResponse({}, false, 500));
    await expect(searchTmdbTvShows("Show")).rejects.toThrow(
      "TMDb proxy error",
    );
  });
});

// ── findByImdbId ──

describe("findByImdbId", () => {
  it("returns movie result when movie_results is populated", async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        movie_results: [{ id: 10, title: "Movie" }],
        tv_results: [],
      }),
    );
    const result = await findByImdbId("tt1234567");
    expect(result).toEqual({ id: 10, title: "Movie", media_type: "movie" });
  });

  it("returns tv result when only tv_results is populated", async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        movie_results: [],
        tv_results: [{ id: 20, name: "TV" }],
      }),
    );
    const result = await findByImdbId("tt1234567");
    expect(result).toEqual({ id: 20, name: "TV", media_type: "tv" });
  });

  it("returns null when no results found", async () => {
    mockFetch.mockReturnValue(
      jsonResponse({ movie_results: [], tv_results: [] }),
    );
    const result = await findByImdbId("tt0000000");
    expect(result).toBeNull();
  });
});

// ── isTmdbAvailable ──

describe("isTmdbAvailable", () => {
  it("returns true when relay responds ok", async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    expect(await isTmdbAvailable()).toBe(true);
  });

  it("returns false when relay responds not ok", async () => {
    mockFetch.mockReturnValue(jsonResponse({}, false, 503));
    expect(await isTmdbAvailable()).toBe(false);
  });

  it("returns false when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    expect(await isTmdbAvailable()).toBe(false);
  });
});

// ── searchTmdbPerson ──

describe("searchTmdbPerson", () => {
  it("returns first person on success", async () => {
    mockFetch.mockReturnValue(
      jsonResponse({ results: [{ id: 100, name: "Actor" }] }),
    );
    const result = await searchTmdbPerson("Actor");
    expect(result).toEqual({ id: 100, name: "Actor" });
  });

  it("returns null when no results", async () => {
    mockFetch.mockReturnValue(jsonResponse({ results: [] }));
    expect(await searchTmdbPerson("Nobody")).toBeNull();
  });
});

// ── getTmdbPersonDetail ──

describe("getTmdbPersonDetail", () => {
  it("returns detail on success", async () => {
    const detail = { id: 100, name: "Actor", biography: "Bio" };
    mockFetch.mockReturnValue(jsonResponse(detail));
    expect(await getTmdbPersonDetail(100)).toEqual(detail);
  });

  it("returns null on non-ok response", async () => {
    mockFetch.mockReturnValue(jsonResponse({}, false, 404));
    expect(await getTmdbPersonDetail(999)).toBeNull();
  });
});

// ── getTmdbPersonCredits ──

describe("getTmdbPersonCredits", () => {
  it("merges cast and crew arrays", async () => {
    mockFetch.mockReturnValue(
      jsonResponse({
        cast: [{ id: 1, media_type: "movie", character: "Hero" }],
        crew: [{ id: 2, media_type: "tv", job: "Director" }],
      }),
    );
    const credits = await getTmdbPersonCredits(100);
    expect(credits).toHaveLength(2);
    expect(credits[0]).toMatchObject({ id: 1, character: "Hero" });
    expect(credits[1]).toMatchObject({ id: 2, job: "Director" });
  });

  it("returns empty array on non-ok response", async () => {
    mockFetch.mockReturnValue(jsonResponse({}, false, 500));
    expect(await getTmdbPersonCredits(100)).toEqual([]);
  });
});
