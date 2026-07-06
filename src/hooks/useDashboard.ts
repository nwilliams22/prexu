import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "./useAuth";
import { useLibrary } from "./useLibrary";
import { useCompletionCounter } from "./useServerActivity";
import { getRecentlyAddedBySection, getOnDeck } from "../services/plex-library";
import { cacheGet, cacheGetAge, cacheSet, cacheInvalidate } from "../services/api-cache";
import { onWatchStateChanged } from "../services/watch-state-events";
import { applyOffsetFloors, DECK_INVALIDATION_DELAY_MS } from "../services/cache-invalidators";
import { groupRecentlyAdded } from "../utils/groupRecentlyAdded";
import { logger } from "../services/logger";
import type { PlexMediaItem, GroupedRecentItem, LibrarySection } from "../types/library";

export type DashboardSection = "movies" | "shows" | "deck";

export interface UseDashboardResult {
  recentMovies: PlexMediaItem[];
  recentShows: GroupedRecentItem[];
  onDeck: PlexMediaItem[];

  loading: Record<DashboardSection, boolean>;
  errors: Record<DashboardSection, string | null>;

  /** Refresh one section, or all sections if no section is specified. */
  refresh: (section?: DashboardSection) => void;
}

const CACHE_TTL = 60 * 60 * 1000;
// Also doubles as the mount-time "fresh enough, skip refetch" threshold
// below (prexu-6qi5.3) — re-entering Dashboard within this window renders
// straight from cache with no network waterfall, matching the window the
// existing visibilitychange handler already treats as "still fresh".
const STALE_THRESHOLD = 2 * 60 * 1000;

function moviesKey(uri: string) { return `dashboard:${uri}:movies`; }
function showsKey(uri: string) { return `dashboard:${uri}:shows`; }
function deckKey(uri: string) { return `dashboard:${uri}:deck`; }

/**
 * Whether a cache entry aged `ageMs` is fresh enough to skip a mount-time
 * refetch. `null` means the entry is missing, past its own TTL, or was
 * invalidated (e.g. cache-invalidators.ts clearing `dashboard:*:deck` on a
 * watch-state change) — always treated as NOT fresh, so those cases refetch
 * exactly as an empty cache always has.
 */
export function isCacheFresh(ageMs: number | null, thresholdMs: number = STALE_THRESHOLD): boolean {
  return ageMs !== null && ageMs <= thresholdMs;
}

/**
 * Structural equality used to skip a redundant setState when a background
 * revalidation resolves to data identical to what's already rendered
 * (prexu-6qi5.3). Keeps the render-hygiene work from prexu-0szx.13/.14 intact
 * when SWR fetches land after a fresh-cache paint.
 */
export function isSameData<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useDashboard(): UseDashboardResult {
  const { server } = useAuth();
  const { sections } = useLibrary();
  // Narrow subscription (prexu-0szx.14): completionCounter is the ONLY
  // field this hook needs from server activity. Reading it via
  // useServerActivity() would re-render on every session/activity update
  // (anything playing on the server), since that context bundles
  // fast-churning sessions/activities into the same memoized value.
  const completionCounter = useCompletionCounter();

  const [recentMovies, setRecentMovies] = useState<PlexMediaItem[]>(() =>
    server ? cacheGet<PlexMediaItem[]>(moviesKey(server.uri)) ?? [] : [],
  );
  const [recentShows, setRecentShows] = useState<GroupedRecentItem[]>(() =>
    server ? cacheGet<GroupedRecentItem[]>(showsKey(server.uri)) ?? [] : [],
  );
  const [onDeck, setOnDeck] = useState<PlexMediaItem[]>(() =>
    server ? cacheGet<PlexMediaItem[]>(deckKey(server.uri)) ?? [] : [],
  );

  const [loading, setLoading] = useState<Record<DashboardSection, boolean>>(
    () => ({
      movies: !cacheGet(server ? moviesKey(server.uri) : ""),
      shows: !cacheGet(server ? showsKey(server.uri) : ""),
      deck: !cacheGet(server ? deckKey(server.uri) : ""),
    }),
  );
  const [errors, setErrors] = useState<Record<DashboardSection, string | null>>({
    movies: null, shows: null, deck: null,
  });

  const [refreshTriggers, setRefreshTriggers] = useState<Record<DashboardSection, number>>({
    movies: 0, shows: 0, deck: 0,
  });

  // Compare-before-set wrappers (prexu-6qi5.3): a background revalidation
  // landing on top of an already-fresh cache paint frequently resolves to
  // data identical to what's rendered. Bail out of the setState in that case
  // so it doesn't re-render every shelf for a no-op update, preserving the
  // idle render-hygiene work from prexu-0szx.13/.14.
  const setRecentMoviesIfChanged = useCallback((next: PlexMediaItem[]) => {
    setRecentMovies((prev) => (isSameData(prev, next) ? prev : next));
  }, []);
  const setRecentShowsIfChanged = useCallback((next: GroupedRecentItem[]) => {
    setRecentShows((prev) => (isSameData(prev, next) ? prev : next));
  }, []);
  const setOnDeckIfChanged = useCallback((next: PlexMediaItem[]) => {
    setOnDeck((prev) => (isSameData(prev, next) ? prev : next));
  }, []);

  // Derive a value-stable key from sections so effects don't re-fire when the
  // array ref changes but contents are identical.
  const sectionsKey = useMemo(
    () => sections.map((s) => `${s.type}:${s.key}`).sort().join(","),
    [sections],
  );
  const movieSections = useMemo(
    () => sections.filter((s) => s.type === "movie"),
    [sectionsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const tvSections = useMemo(
    () => sections.filter((s) => s.type === "show"),
    [sectionsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const fetchMovies = useCallback(
    async (cancel: { cancelled: boolean }, movieSections: LibrarySection[], uri: string, token: string) => {
      const startedAt = performance.now();
      try {
        const items = await getRecentlyAddedBySection(uri, token, movieSections, 30);
        if (cancel.cancelled) return;
        const sorted = items.sort((a, b) => b.addedAt - a.addedAt);
        setRecentMoviesIfChanged(sorted);
        setErrors((prev) => (prev.movies === null ? prev : { ...prev, movies: null }));
        cacheSet(moviesKey(uri), sorted, CACHE_TTL);
        logger.trace("api", "dashboard movies fetch complete", {
          ms: Math.round(performance.now() - startedAt),
          count: sorted.length,
        });
      } catch (err) {
        if (cancel.cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load movies";
        logger.warn("dashboard", "fetch movies failed", { error: msg });
        setErrors((prev) => ({ ...prev, movies: msg }));
      } finally {
        if (!cancel.cancelled) setLoading((prev) => (prev.movies ? { ...prev, movies: false } : prev));
      }
    },
    [setRecentMoviesIfChanged],
  );

  const fetchShows = useCallback(
    async (cancel: { cancelled: boolean }, tvSections: LibrarySection[], uri: string, token: string) => {
      const startedAt = performance.now();
      try {
        const items = await getRecentlyAddedBySection(uri, token, tvSections, 30);
        if (cancel.cancelled) return;
        const grouped = groupRecentlyAdded(items.sort((a, b) => b.addedAt - a.addedAt));
        setRecentShowsIfChanged(grouped);
        setErrors((prev) => (prev.shows === null ? prev : { ...prev, shows: null }));
        cacheSet(showsKey(uri), grouped, CACHE_TTL);
        logger.trace("api", "dashboard shows fetch complete", {
          ms: Math.round(performance.now() - startedAt),
          count: grouped.length,
        });
      } catch (err) {
        if (cancel.cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load shows";
        logger.warn("dashboard", "fetch shows failed", { error: msg });
        setErrors((prev) => ({ ...prev, shows: msg }));
      } finally {
        if (!cancel.cancelled) setLoading((prev) => (prev.shows ? { ...prev, shows: false } : prev));
      }
    },
    [setRecentShowsIfChanged],
  );

  const fetchDeck = useCallback(
    async (cancel: { cancelled: boolean }, uri: string, token: string) => {
      const startedAt = performance.now();
      try {
        const fetched = await getOnDeck(uri, token);
        if (cancel.cancelled) return;
        // Stale-response guard (prexu-8nl0): this fetch can race PMS's own
        // async ingestion of a just-completed stop write — see
        // cache-invalidators.ts's optimistic offset patch for the full
        // mechanism. applyOffsetFloors overrides any item whose fetched
        // viewOffset is older than a value the player itself just reported,
        // within a short window; it's a no-op once no floors are live.
        const items = applyOffsetFloors(fetched);
        setOnDeckIfChanged(items);
        setErrors((prev) => (prev.deck === null ? prev : { ...prev, deck: null }));
        cacheSet(deckKey(uri), items, CACHE_TTL);
        logger.trace("api", "dashboard deck fetch complete", {
          ms: Math.round(performance.now() - startedAt),
          count: items.length,
        });
      } catch (err) {
        if (cancel.cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load Continue Watching";
        logger.warn("dashboard", "fetch deck failed", { error: msg });
        setErrors((prev) => ({ ...prev, deck: msg }));
      } finally {
        if (!cancel.cancelled) setLoading((prev) => (prev.deck ? { ...prev, deck: false } : prev));
      }
    },
    [setOnDeckIfChanged],
  );

  const serverUri = server?.uri;
  const serverToken = server?.accessToken;

  // Movies effect — stale-while-revalidate (prexu-6qi5.3): a fresh cache
  // entry (aged <= STALE_THRESHOLD) is rendered and the refetch is skipped
  // entirely, so re-entering Dashboard shortly after leaving it paints from
  // cache with no network waterfall. A missing entry (never fetched, past
  // its 60-minute TTL, or invalidated — e.g. deck on watch-state change)
  // always refetches, same as before this change.
  useEffect(() => {
    if (!serverUri || !serverToken || sectionsKey === "") return;
    const cancel = { cancelled: false };
    const key = moviesKey(serverUri);
    const cached = cacheGet<PlexMediaItem[]>(key);
    const ageMs = cacheGetAge(key);
    if (cached) {
      setRecentMoviesIfChanged(cached);
      setLoading((prev) => (prev.movies ? { ...prev, movies: false } : prev));
    }
    if (isCacheFresh(ageMs)) {
      logger.trace("api", "dashboard movies cache fresh, skipping refetch", { ageMs });
      return () => { cancel.cancelled = true; };
    }
    logger.debug("api", "dashboard movies refetch triggered", { ageMs, hadCache: !!cached });
    fetchMovies(cancel, movieSections, serverUri, serverToken);
    return () => { cancel.cancelled = true; };
  }, [serverUri, serverToken, sectionsKey, movieSections, refreshTriggers.movies, fetchMovies, setRecentMoviesIfChanged]);

  // Shows effect — same fresh-cache-skips-refetch policy as movies above.
  useEffect(() => {
    if (!serverUri || !serverToken || sectionsKey === "") return;
    const cancel = { cancelled: false };
    const key = showsKey(serverUri);
    const cached = cacheGet<GroupedRecentItem[]>(key);
    const ageMs = cacheGetAge(key);
    if (cached) {
      setRecentShowsIfChanged(cached);
      setLoading((prev) => (prev.shows ? { ...prev, shows: false } : prev));
    }
    if (isCacheFresh(ageMs)) {
      logger.trace("api", "dashboard shows cache fresh, skipping refetch", { ageMs });
      return () => { cancel.cancelled = true; };
    }
    logger.debug("api", "dashboard shows refetch triggered", { ageMs, hadCache: !!cached });
    fetchShows(cancel, tvSections, serverUri, serverToken);
    return () => { cancel.cancelled = true; };
  }, [serverUri, serverToken, sectionsKey, tvSections, refreshTriggers.shows, fetchShows, setRecentShowsIfChanged]);

  // Deck effect — same policy. Composes with cache-invalidators.ts (PR #50):
  // an invalidated deck entry is simply absent, so cacheGetAge returns null,
  // isCacheFresh is false, and this always refetches — no separate "was
  // invalidated" flag needed.
  useEffect(() => {
    if (!serverUri || !serverToken || sectionsKey === "") return;
    const cancel = { cancelled: false };
    const key = deckKey(serverUri);
    const cached = cacheGet<PlexMediaItem[]>(key);
    const ageMs = cacheGetAge(key);
    if (cached) {
      setOnDeckIfChanged(cached);
      setLoading((prev) => (prev.deck ? { ...prev, deck: false } : prev));
    }
    if (isCacheFresh(ageMs)) {
      logger.trace("api", "dashboard deck cache fresh, skipping refetch", { ageMs });
      return () => { cancel.cancelled = true; };
    }
    logger.debug("api", "dashboard deck refetch triggered", { ageMs, hadCache: !!cached });
    fetchDeck(cancel, serverUri, serverToken);
    return () => { cancel.cancelled = true; };
  }, [serverUri, serverToken, sectionsKey, refreshTriggers.deck, fetchDeck, setOnDeckIfChanged]);

  const refresh = useCallback(
    (section?: DashboardSection) => {
      if (!serverUri) return;
      if (!section || section === "movies") cacheInvalidate(moviesKey(serverUri));
      if (!section || section === "shows") cacheInvalidate(showsKey(serverUri));
      if (!section || section === "deck") cacheInvalidate(deckKey(serverUri));
      setRefreshTriggers((prev) => ({
        movies: !section || section === "movies" ? prev.movies + 1 : prev.movies,
        shows: !section || section === "shows" ? prev.shows + 1 : prev.shows,
        deck: !section || section === "deck" ? prev.deck + 1 : prev.deck,
      }));
    },
    [serverUri],
  );

  // Refresh Continue Watching when playback stops (resume offset cleared on an
  // early stop, or a new offset recorded). The player overlay never remounts
  // the dashboard, so without this the On Deck shelf would stay stale until an
  // app restart.
  //
  // prexu-dqfc: this refetch is deliberately delayed by
  // DECK_INVALIDATION_DELAY_MS rather than firing at T+0. Before this change
  // it raced PMS's async onDeck-rebuild far harder than cache-invalidators.ts's
  // own backstop invalidation does (that module waits out the SAME delay
  // before invalidating, precisely so a forced refetch doesn't land before
  // PMS has ingested the stop write) — this hook's immediate refetch bypassed
  // that calibration entirely, leaving the fixed-window offset floor
  // (applyOffsetFloors, see cache-invalidators.ts) as the ONLY thing standing
  // between an early refetch and a stale response. A hardware repro showed a
  // real PMS response landing after the floor had already expired, cementing
  // the pre-stop offset into both state and the 60-minute cache with nothing
  // left to correct it. Aligning this refetch with the same ingestion buffer
  // makes it far more likely PMS has already ingested by the time it fires,
  // and turns the offset floor back into a backstop instead of the front
  // line of defense against a same-tick race.
  const deckRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsubscribe = onWatchStateChanged(() => {
      if (deckRefreshTimerRef.current) clearTimeout(deckRefreshTimerRef.current);
      logger.debug("playback", "deck refresh scheduled after watch-state change", {
        delayMs: DECK_INVALIDATION_DELAY_MS,
      });
      deckRefreshTimerRef.current = setTimeout(() => {
        deckRefreshTimerRef.current = null;
        refresh("deck");
      }, DECK_INVALIDATION_DELAY_MS);
    });
    return () => {
      unsubscribe();
      if (deckRefreshTimerRef.current) {
        clearTimeout(deckRefreshTimerRef.current);
        deckRefreshTimerRef.current = null;
      }
    };
  }, [refresh]);

  // Auto-refresh on server activity completion
  const prevCompletion = useRef(completionCounter);
  useEffect(() => {
    if (completionCounter > prevCompletion.current) {
      prevCompletion.current = completionCounter;
      refresh();
    }
  }, [completionCounter, refresh]);

  // Stale-on-visibility refresh
  const lastFetchTime = useRef(Date.now());
  const anyLoading = loading.movies || loading.shows || loading.deck;
  useEffect(() => {
    if (!anyLoading) lastFetchTime.current = Date.now();
  }, [anyLoading]);

  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastFetchTime.current > STALE_THRESHOLD
      ) {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return { recentMovies, recentShows, onDeck, loading, errors, refresh };
}
