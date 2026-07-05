/**
 * Shared dashboard-data prefetch (prexu-0szx.9).
 *
 * Fetches library sections + recently-added (movies/shows) + on-deck for a
 * server and warms the shared API cache (src/services/api-cache.ts) that
 * Dashboard/Sidebar read from. Memoized per server URI so two callers that
 * trigger the same prefetch — the optimistic auth-boot warm-up in
 * useAuth.ts (fired in parallel with the plex.tv token validation, before
 * we know whether the account token is even still valid) and App.tsx's
 * post-auth splash-quorum gate — share one in-flight network request
 * instead of hitting the Plex server twice.
 *
 * If the account token ultimately fails validation, the cache entries this
 * writes are simply never surfaced: Dashboard never mounts (AppLayout
 * redirects to /login), so there's no auth state leaked — just some
 * unused, non-sensitive library-metadata cache entries scoped by server
 * URI, which is harmless and expires via the existing cache TTLs.
 */

import type { ServerData } from "../types/plex";
import {
  getLibrarySections,
  getRecentlyAddedBySection,
  getOnDeck,
} from "../services/plex-library";
import { groupRecentlyAdded } from "./groupRecentlyAdded";
import { cacheSet } from "../services/api-cache";
import { logger } from "../services/logger";

export interface DashboardPrefetchHandle {
  /** Resolves to `true` once sections were fetched (and the movies/shows/
   *  deck fetches kicked off), or `false` if the sections fetch itself
   *  failed outright. Never rejects. */
  sectionsSettled: Promise<boolean>;
  /** Resolve (never reject) once their respective fetch has settled. */
  movies: Promise<void>;
  shows: Promise<void>;
  deck: Promise<void>;
}

const inFlight = new Map<string, DashboardPrefetchHandle>();

/** Test-only escape hatch — clears the in-flight memo between test cases. */
export function __resetDashboardPrefetchForTests(): void {
  inFlight.clear();
}

/**
 * Kick off (or reuse an already-running) dashboard prefetch for `server`.
 * Fire-and-forget: callers that only want to warm the cache can ignore the
 * returned handle; callers that need to know when data has settled (e.g.
 * App.tsx's splash-dismissal quorum) can await its promises.
 */
export function prefetchDashboardData(server: ServerData): DashboardPrefetchHandle {
  const existing = inFlight.get(server.uri);
  if (existing) return existing;

  const { uri, accessToken } = server;

  let resolveMovies!: () => void;
  let resolveShows!: () => void;
  let resolveDeck!: () => void;
  const movies = new Promise<void>((res) => (resolveMovies = res));
  const shows = new Promise<void>((res) => (resolveShows = res));
  const deck = new Promise<void>((res) => (resolveDeck = res));

  const sectionsSettled = getLibrarySections(uri, accessToken)
    .then((sections) => {
      cacheSet(`library-sections:${uri}`, sections, 30 * 60 * 1000, true);

      const movieSections = sections.filter((s) => s.type === "movie");
      const tvSections = sections.filter((s) => s.type === "show");

      getRecentlyAddedBySection(uri, accessToken, movieSections, 30)
        .then((items) => {
          const sorted = items.sort((a, b) => b.addedAt - a.addedAt);
          cacheSet(`dashboard:${uri}:movies`, sorted, 60 * 60 * 1000);
        })
        .catch((err) => {
          logger.warn("splash", "movies prefetch failed", String(err));
        })
        .finally(() => resolveMovies());

      getRecentlyAddedBySection(uri, accessToken, tvSections, 30)
        .then((items) => {
          const grouped = groupRecentlyAdded(items.sort((a, b) => b.addedAt - a.addedAt));
          cacheSet(`dashboard:${uri}:shows`, grouped, 60 * 60 * 1000);
        })
        .catch((err) => {
          logger.warn("splash", "shows prefetch failed", String(err));
        })
        .finally(() => resolveShows());

      getOnDeck(uri, accessToken)
        .then((items) => {
          cacheSet(`dashboard:${uri}:deck`, items, 60 * 60 * 1000);
        })
        .catch((err) => {
          logger.warn("splash", "deck prefetch failed", String(err));
        })
        .finally(() => resolveDeck());

      return true;
    })
    .catch((err) => {
      logger.warn("splash", "sections prefetch failed", String(err));
      // Sections failed outright — the three dependent fetches never
      // started. Resolve them (never reject) so a quorum-style consumer
      // isn't left waiting forever.
      resolveMovies();
      resolveShows();
      resolveDeck();
      return false;
    });

  const handle: DashboardPrefetchHandle = { sectionsSettled, movies, shows, deck };
  inFlight.set(uri, handle);

  // Once everything has settled, drop the memo entry so a later, genuinely
  // fresh prefetch (e.g. a subsequent cold boot later in a long-running
  // session) doesn't reuse a long-stale resolved handle — actual data
  // freshness is governed by the cacheSet TTLs above, this map only dedupes
  // near-simultaneous callers during the same boot.
  Promise.all([sectionsSettled, movies, shows, deck]).finally(() => {
    if (inFlight.get(uri) === handle) inFlight.delete(uri);
  });

  return handle;
}
