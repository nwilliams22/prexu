import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "./useAuth";
import { useLibrary } from "./useLibrary";
import { useServerActivity } from "./useServerActivity";
import { getRecentlyAddedBySection, getOnDeck } from "../services/plex-library";
import { cacheGet, cacheSet, cacheInvalidate } from "../services/api-cache";
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
const STALE_THRESHOLD = 2 * 60 * 1000;

function moviesKey(uri: string) { return `dashboard:${uri}:movies`; }
function showsKey(uri: string) { return `dashboard:${uri}:shows`; }
function deckKey(uri: string) { return `dashboard:${uri}:deck`; }

export function useDashboard(): UseDashboardResult {
  const { server } = useAuth();
  const { sections } = useLibrary();
  const { completionCounter } = useServerActivity();

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
      try {
        const items = await getRecentlyAddedBySection(uri, token, movieSections, 30);
        if (cancel.cancelled) return;
        const sorted = items.sort((a, b) => b.addedAt - a.addedAt);
        setRecentMovies(sorted);
        setErrors((prev) => ({ ...prev, movies: null }));
        cacheSet(moviesKey(uri), sorted, CACHE_TTL);
      } catch (err) {
        if (cancel.cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load movies";
        logger.warn("dashboard", "fetch movies failed", { error: msg });
        setErrors((prev) => ({ ...prev, movies: msg }));
      } finally {
        if (!cancel.cancelled) setLoading((prev) => ({ ...prev, movies: false }));
      }
    },
    [],
  );

  const fetchShows = useCallback(
    async (cancel: { cancelled: boolean }, tvSections: LibrarySection[], uri: string, token: string) => {
      try {
        const items = await getRecentlyAddedBySection(uri, token, tvSections, 30);
        if (cancel.cancelled) return;
        const grouped = groupRecentlyAdded(items.sort((a, b) => b.addedAt - a.addedAt));
        setRecentShows(grouped);
        setErrors((prev) => ({ ...prev, shows: null }));
        cacheSet(showsKey(uri), grouped, CACHE_TTL);
      } catch (err) {
        if (cancel.cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load shows";
        logger.warn("dashboard", "fetch shows failed", { error: msg });
        setErrors((prev) => ({ ...prev, shows: msg }));
      } finally {
        if (!cancel.cancelled) setLoading((prev) => ({ ...prev, shows: false }));
      }
    },
    [],
  );

  const fetchDeck = useCallback(
    async (cancel: { cancelled: boolean }, uri: string, token: string) => {
      try {
        const items = await getOnDeck(uri, token);
        if (cancel.cancelled) return;
        setOnDeck(items);
        setErrors((prev) => ({ ...prev, deck: null }));
        cacheSet(deckKey(uri), items, CACHE_TTL);
      } catch (err) {
        if (cancel.cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load Continue Watching";
        logger.warn("dashboard", "fetch deck failed", { error: msg });
        setErrors((prev) => ({ ...prev, deck: msg }));
      } finally {
        if (!cancel.cancelled) setLoading((prev) => ({ ...prev, deck: false }));
      }
    },
    [],
  );

  const serverUri = server?.uri;
  const serverToken = server?.accessToken;

  // Movies effect
  useEffect(() => {
    if (!serverUri || !serverToken || sectionsKey === "") return;
    const cancel = { cancelled: false };
    const cached = cacheGet<PlexMediaItem[]>(moviesKey(serverUri));
    if (cached) {
      setRecentMovies(cached);
      setLoading((prev) => (prev.movies ? { ...prev, movies: false } : prev));
    }
    fetchMovies(cancel, movieSections, serverUri, serverToken);
    return () => { cancel.cancelled = true; };
  }, [serverUri, serverToken, sectionsKey, movieSections, refreshTriggers.movies, fetchMovies]);

  // Shows effect
  useEffect(() => {
    if (!serverUri || !serverToken || sectionsKey === "") return;
    const cancel = { cancelled: false };
    const cached = cacheGet<GroupedRecentItem[]>(showsKey(serverUri));
    if (cached) {
      setRecentShows(cached);
      setLoading((prev) => (prev.shows ? { ...prev, shows: false } : prev));
    }
    fetchShows(cancel, tvSections, serverUri, serverToken);
    return () => { cancel.cancelled = true; };
  }, [serverUri, serverToken, sectionsKey, tvSections, refreshTriggers.shows, fetchShows]);

  // Deck effect
  useEffect(() => {
    if (!serverUri || !serverToken || sectionsKey === "") return;
    const cancel = { cancelled: false };
    const cached = cacheGet<PlexMediaItem[]>(deckKey(serverUri));
    if (cached) {
      setOnDeck(cached);
      setLoading((prev) => (prev.deck ? { ...prev, deck: false } : prev));
    }
    fetchDeck(cancel, serverUri, serverToken);
    return () => { cancel.cancelled = true; };
  }, [serverUri, serverToken, sectionsKey, refreshTriggers.deck, fetchDeck]);

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
