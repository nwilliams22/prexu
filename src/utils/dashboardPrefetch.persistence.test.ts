vi.mock("../services/plex-library", () => ({
  getLibrarySections: vi.fn().mockResolvedValue([]),
  getRecentlyAddedBySection: vi.fn().mockResolvedValue([]),
  getOnDeck: vi.fn().mockResolvedValue([]),
}));

it("persists all dashboard lists across a fresh module session", async () => {
  localStorage.clear();
  vi.resetModules();
  const { prefetchDashboardData } = await import("./dashboardPrefetch");
  const server = { uri: "https://plex.test", accessToken: "fixture-token", name: "Fixture", clientIdentifier: "fixture" };
  const handle = prefetchDashboardData(server);
  await Promise.all([handle.movies, handle.shows, handle.deck]);
  const stored = ["movies", "shows", "deck"].map((section) => {
    const key = `dashboard:${server.uri}:${section}`;
    const raw = localStorage.getItem(`prexu_cache:${key}`);
    expect(raw).not.toBeNull();
    return { key, raw };
  });
  vi.resetModules(); // new session: discard the module-level memory cache
  const { cacheGet, cacheGetAge, cacheClear } = await import("../services/api-cache");
  for (const { key, raw } of stored) {
    expect(cacheGetAge(key)).toBeNull();
    expect(cacheGet(key)).toEqual([]);
    expect(localStorage.getItem(`prexu_cache:${key}`)).toBe(raw);
  }
  cacheClear();
});
