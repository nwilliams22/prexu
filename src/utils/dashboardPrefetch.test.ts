import type { ServerData } from "../types/plex";
import type { LibrarySection } from "../types/library";

vi.mock("../services/plex-library", () => ({
  getLibrarySections: vi.fn(),
  getRecentlyAddedBySection: vi.fn(),
  getOnDeck: vi.fn(),
}));

vi.mock("../services/api-cache", () => ({
  cacheSet: vi.fn(),
}));

vi.mock("../services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

import * as plexLibrary from "../services/plex-library";
import { cacheSet } from "../services/api-cache";
import {
  prefetchDashboardData,
  __resetDashboardPrefetchForTests,
} from "./dashboardPrefetch";

const mockPlexLibrary = vi.mocked(plexLibrary);
const mockCacheSet = vi.mocked(cacheSet);

const server: ServerData = {
  name: "Server",
  clientIdentifier: "server-id",
  accessToken: "server-token",
  uri: "https://server:32400",
};

const sections: LibrarySection[] = [
  { key: "1", title: "Movies", type: "movie" } as LibrarySection,
  { key: "2", title: "Shows", type: "show" } as LibrarySection,
];

describe("prefetchDashboardData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetDashboardPrefetchForTests();
    mockPlexLibrary.getLibrarySections.mockResolvedValue(sections);
    mockPlexLibrary.getRecentlyAddedBySection.mockResolvedValue([]);
    mockPlexLibrary.getOnDeck.mockResolvedValue([]);
  });

  it("fetches sections then the three dependent lists, caching each", async () => {
    const handle = prefetchDashboardData(server);

    await Promise.all([handle.sectionsSettled, handle.movies, handle.shows, handle.deck]);

    expect(mockPlexLibrary.getLibrarySections).toHaveBeenCalledWith(
      server.uri,
      server.accessToken,
    );
    expect(mockCacheSet).toHaveBeenCalledWith(
      `library-sections:${server.uri}`,
      sections,
      30 * 60 * 1000,
      true,
    );
    expect(mockCacheSet).toHaveBeenCalledWith(
      `dashboard:${server.uri}:movies`,
      [],
      60 * 60 * 1000,
    );
    expect(mockCacheSet).toHaveBeenCalledWith(
      `dashboard:${server.uri}:shows`,
      [],
      60 * 60 * 1000,
    );
    expect(mockCacheSet).toHaveBeenCalledWith(
      `dashboard:${server.uri}:deck`,
      [],
      60 * 60 * 1000,
    );
    expect(await handle.sectionsSettled).toBe(true);
  });

  it("dedupes concurrent calls for the same server URI into a single network request", async () => {
    const handle1 = prefetchDashboardData(server);
    const handle2 = prefetchDashboardData(server);

    expect(handle1).toBe(handle2);
    await Promise.all([handle1.movies, handle1.shows, handle1.deck]);
    expect(mockPlexLibrary.getLibrarySections).toHaveBeenCalledTimes(1);
  });

  it("resolves sectionsSettled to false and settles movies/shows/deck without hanging when sections fetch fails", async () => {
    mockPlexLibrary.getLibrarySections.mockRejectedValue(new Error("network down"));

    const handle = prefetchDashboardData(server);

    const ok = await handle.sectionsSettled;
    expect(ok).toBe(false);
    // Never reject and never hang — resolve promptly even though sections failed.
    await Promise.all([handle.movies, handle.shows, handle.deck]);
    expect(mockPlexLibrary.getRecentlyAddedBySection).not.toHaveBeenCalled();
  });

  it("starts a fresh fetch for a different server URI", async () => {
    const otherServer: ServerData = { ...server, uri: "https://other:32400" };

    const handle1 = prefetchDashboardData(server);
    await Promise.all([handle1.movies, handle1.shows, handle1.deck]);

    const handle2 = prefetchDashboardData(otherServer);
    await Promise.all([handle2.movies, handle2.shows, handle2.deck]);

    expect(mockPlexLibrary.getLibrarySections).toHaveBeenCalledTimes(2);
    expect(mockPlexLibrary.getLibrarySections).toHaveBeenNthCalledWith(
      2,
      otherServer.uri,
      otherServer.accessToken,
    );
  });
});
