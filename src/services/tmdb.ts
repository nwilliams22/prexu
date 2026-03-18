/**
 * TMDb (The Movie Database) API client.
 *
 * All requests are proxied through the relay server, which holds the TMDb API
 * key as an environment variable. This keeps the key off the client.
 */

import type {
  TmdbMovie,
  TmdbTvShow,
  TmdbSearchResult,
  TmdbSearchMovieResponse,
  TmdbSearchTvResponse,
  TmdbFindResponse,
} from "../types/content-request";
import { getRelayHttpUrl, getServer } from "./storage";
import { timedFetch } from "./plex-api";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

/** Resolve the relay HTTP base URL, using a cached serverUri if available. */
let cachedRelayHttp: string | null = null;

async function relayBase(): Promise<string> {
  if (cachedRelayHttp) return cachedRelayHttp;
  const server = await getServer();
  cachedRelayHttp = await getRelayHttpUrl(server?.uri);
  return cachedRelayHttp;
}

/** Reset cached relay URL (call when server selection changes). */
export function resetTmdbRelayCache(): void {
  cachedRelayHttp = null;
}

/** Fetch JSON from the relay TMDb proxy. */
async function relayFetch<T>(path: string): Promise<T> {
  const base = await relayBase();
  const url = `${base}${path}`;

  try {
    const resp = await timedFetch(url);

    if (!resp.ok) {
      throw new Error(`TMDb proxy error: ${resp.status} ${resp.statusText} (${url})`);
    }

    return resp.json() as Promise<T>;
  } catch (err) {
    // Include the URL in the error so we can see what was tried
    if (err instanceof Error && !err.message.includes(base)) {
      throw new Error(`${err.message} — relay URL: ${url}`);
    }
    throw err;
  }
}

/** Search TMDb for movies by title. */
export async function searchTmdbMovies(
  query: string,
  page = 1,
): Promise<{ results: TmdbMovie[]; totalResults: number }> {
  const params = new URLSearchParams({ query, page: String(page) });
  const data = await relayFetch<TmdbSearchMovieResponse>(
    `/tmdb/search/movie?${params}`,
  );
  return { results: data.results, totalResults: data.total_results };
}

/** Search TMDb for TV shows by title. */
export async function searchTmdbTvShows(
  query: string,
  page = 1,
): Promise<{ results: TmdbTvShow[]; totalResults: number }> {
  const params = new URLSearchParams({ query, page: String(page) });
  const data = await relayFetch<TmdbSearchTvResponse>(
    `/tmdb/search/tv?${params}`,
  );
  return { results: data.results, totalResults: data.total_results };
}

/**
 * Look up a movie or TV show by IMDb ID.
 * Returns the first matching result with its media type, or null if not found.
 */
export async function findByImdbId(
  imdbId: string,
): Promise<TmdbSearchResult | null> {
  const data = await relayFetch<TmdbFindResponse>(`/tmdb/find/${imdbId}`);

  if (data.movie_results.length > 0) {
    return { ...data.movie_results[0], media_type: "movie" };
  }
  if (data.tv_results.length > 0) {
    return { ...data.tv_results[0], media_type: "tv" };
  }

  return null;
}

/**
 * Check if the relay server has TMDb proxy available.
 * Returns true if the relay has a TMDb API key configured.
 */
export async function isTmdbAvailable(): Promise<boolean> {
  try {
    const base = await relayBase();
    const resp = await timedFetch(`${base}/tmdb/status`);
    return resp.ok;
  } catch {
    return false;
  }
}

/** Build a full TMDb image URL from a poster/backdrop path. */
export function getTmdbImageUrl(
  path: string | null,
  size: "w92" | "w154" | "w185" | "w342" | "w500" | "w780" | "original" = "w342",
): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

// ── Person / Actor endpoints ──

/** TMDB person search result */
export interface TmdbPersonSearchResult {
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department: string;
  known_for: {
    id: number;
    title?: string;
    name?: string;
    media_type: "movie" | "tv";
    poster_path: string | null;
    release_date?: string;
    first_air_date?: string;
    overview: string;
  }[];
}

/** TMDB person detail */
export interface TmdbPersonDetail {
  id: number;
  name: string;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  profile_path: string | null;
  known_for_department: string;
  also_known_as: string[];
}

/** TMDB combined credits entry */
export interface TmdbCreditEntry {
  id: number;
  title?: string;        // movie title
  name?: string;         // tv show name
  media_type: "movie" | "tv";
  character?: string;
  department?: string;
  job?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  popularity: number;
}

/** Search TMDB for a person by name. */
export async function searchTmdbPerson(
  query: string,
): Promise<TmdbPersonSearchResult | null> {
  const params = new URLSearchParams({ query });
  const data = await relayFetch<{ results: TmdbPersonSearchResult[] }>(
    `/tmdb/search/person?${params}`,
  );
  return data.results.length > 0 ? data.results[0] : null;
}

/** Get detailed person info from TMDB by person ID. */
export async function getTmdbPersonDetail(
  personId: number,
): Promise<TmdbPersonDetail | null> {
  try {
    return await relayFetch<TmdbPersonDetail>(`/tmdb/person/${personId}`);
  } catch {
    return null;
  }
}

/** Get combined (movie + TV) credits for a person. */
export async function getTmdbPersonCredits(
  personId: number,
): Promise<TmdbCreditEntry[]> {
  try {
    const data = await relayFetch<{ cast: TmdbCreditEntry[]; crew: TmdbCreditEntry[] }>(
      `/tmdb/person/${personId}/credits`,
    );
    return [...data.cast, ...data.crew];
  } catch {
    return [];
  }
}

/** TMDB movie detail response (full detail page) */
export interface TmdbMovieDetail {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  runtime: number | null;
  genres: { id: number; name: string }[];
  tagline: string;
  status: string;
  budget: number;
  revenue: number;
  credits?: {
    cast: { id: number; name: string; character: string; profile_path: string | null; order: number }[];
    crew: { id: number; name: string; job: string; department: string; profile_path: string | null }[];
  };
}

/** TMDB TV show detail response (full detail page) */
export interface TmdbTvDetail {
  id: number;
  name: string;
  overview: string;
  first_air_date: string;
  last_air_date: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  number_of_seasons: number;
  number_of_episodes: number;
  episode_run_time: number[];
  genres: { id: number; name: string }[];
  tagline: string;
  status: string;
  networks: { id: number; name: string; logo_path: string | null }[];
  credits?: {
    cast: { id: number; name: string; character: string; profile_path: string | null; order: number }[];
    crew: { id: number; name: string; job: string; department: string; profile_path: string | null }[];
  };
}

/** Get TMDB movie details by ID. */
export async function getTmdbMovieDetail(
  movieId: number,
): Promise<TmdbMovieDetail | null> {
  try {
    return await relayFetch<TmdbMovieDetail>(`/tmdb/movie/${movieId}`);
  } catch {
    return null;
  }
}

/** Get TMDB TV show details by ID. */
export async function getTmdbTvDetail(
  tvId: number,
): Promise<TmdbTvDetail | null> {
  try {
    return await relayFetch<TmdbTvDetail>(`/tmdb/tv/${tvId}`);
  } catch {
    return null;
  }
}

/** Validate IMDb ID format (tt followed by 7+ digits). */
export function isValidImdbId(id: string): boolean {
  return /^tt\d{7,}$/.test(id);
}
