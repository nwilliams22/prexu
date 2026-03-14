/**
 * TMDb (The Movie Database) API client for content search.
 * Used by the content request system for movie/TV show lookup.
 */

import type {
  TmdbMovie,
  TmdbTvShow,
  TmdbSearchResult,
  TmdbSearchMovieResponse,
  TmdbSearchTvResponse,
  TmdbFindResponse,
} from "../types/content-request";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

/** Search TMDb for movies by title. */
export async function searchTmdbMovies(
  apiKey: string,
  query: string,
  page = 1,
): Promise<{ results: TmdbMovie[]; totalResults: number }> {
  const params = new URLSearchParams({
    query,
    page: String(page),
    include_adult: "false",
    language: "en-US",
  });

  const resp = await fetch(`${TMDB_API_BASE}/search/movie?${params}`, {
    headers: authHeaders(apiKey),
  });

  if (!resp.ok) {
    throw new Error(`TMDb movie search failed: ${resp.status} ${resp.statusText}`);
  }

  const data: TmdbSearchMovieResponse = await resp.json();
  return { results: data.results, totalResults: data.total_results };
}

/** Search TMDb for TV shows by title. */
export async function searchTmdbTvShows(
  apiKey: string,
  query: string,
  page = 1,
): Promise<{ results: TmdbTvShow[]; totalResults: number }> {
  const params = new URLSearchParams({
    query,
    page: String(page),
    include_adult: "false",
    language: "en-US",
  });

  const resp = await fetch(`${TMDB_API_BASE}/search/tv?${params}`, {
    headers: authHeaders(apiKey),
  });

  if (!resp.ok) {
    throw new Error(`TMDb TV search failed: ${resp.status} ${resp.statusText}`);
  }

  const data: TmdbSearchTvResponse = await resp.json();
  return { results: data.results, totalResults: data.total_results };
}

/**
 * Look up a movie or TV show by IMDb ID.
 * Returns the first matching result with its media type, or null if not found.
 */
export async function findByImdbId(
  apiKey: string,
  imdbId: string,
): Promise<TmdbSearchResult | null> {
  const params = new URLSearchParams({
    external_source: "imdb_id",
    language: "en-US",
  });

  const resp = await fetch(`${TMDB_API_BASE}/find/${imdbId}?${params}`, {
    headers: authHeaders(apiKey),
  });

  if (!resp.ok) {
    throw new Error(`TMDb find by IMDb ID failed: ${resp.status} ${resp.statusText}`);
  }

  const data: TmdbFindResponse = await resp.json();

  if (data.movie_results.length > 0) {
    return { ...data.movie_results[0], media_type: "movie" };
  }
  if (data.tv_results.length > 0) {
    return { ...data.tv_results[0], media_type: "tv" };
  }

  return null;
}

/**
 * Validate a TMDb API key by performing a test search.
 * Returns true if the key is valid, false otherwise.
 */
export async function validateTmdbApiKey(apiKey: string): Promise<boolean> {
  try {
    const resp = await fetch(
      `${TMDB_API_BASE}/search/movie?query=test&page=1`,
      { headers: authHeaders(apiKey) },
    );
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
  apiKey: string,
  query: string,
): Promise<TmdbPersonSearchResult | null> {
  const params = new URLSearchParams({
    query,
    include_adult: "false",
    language: "en-US",
  });

  const resp = await fetch(`${TMDB_API_BASE}/search/person?${params}`, {
    headers: authHeaders(apiKey),
  });

  if (!resp.ok) return null;

  const data: { results: TmdbPersonSearchResult[] } = await resp.json();
  return data.results.length > 0 ? data.results[0] : null;
}

/** Get detailed person info from TMDB by person ID. */
export async function getTmdbPersonDetail(
  apiKey: string,
  personId: number,
): Promise<TmdbPersonDetail | null> {
  const resp = await fetch(
    `${TMDB_API_BASE}/person/${personId}?language=en-US`,
    { headers: authHeaders(apiKey) },
  );

  if (!resp.ok) return null;
  return resp.json();
}

/** Get combined (movie + TV) credits for a person. */
export async function getTmdbPersonCredits(
  apiKey: string,
  personId: number,
): Promise<TmdbCreditEntry[]> {
  const resp = await fetch(
    `${TMDB_API_BASE}/person/${personId}/combined_credits?language=en-US`,
    { headers: authHeaders(apiKey) },
  );

  if (!resp.ok) return [];

  const data: { cast: TmdbCreditEntry[]; crew: TmdbCreditEntry[] } =
    await resp.json();
  // Merge cast + crew, tag media_type (API returns it)
  return [...data.cast, ...data.crew];
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
  apiKey: string,
  movieId: number,
): Promise<TmdbMovieDetail | null> {
  const resp = await fetch(
    `${TMDB_API_BASE}/movie/${movieId}?language=en-US&append_to_response=credits`,
    { headers: authHeaders(apiKey) },
  );
  if (!resp.ok) return null;
  return resp.json();
}

/** Get TMDB TV show details by ID. */
export async function getTmdbTvDetail(
  apiKey: string,
  tvId: number,
): Promise<TmdbTvDetail | null> {
  const resp = await fetch(
    `${TMDB_API_BASE}/tv/${tvId}?language=en-US&append_to_response=credits`,
    { headers: authHeaders(apiKey) },
  );
  if (!resp.ok) return null;
  return resp.json();
}

/** Validate IMDb ID format (tt followed by 7+ digits). */
export function isValidImdbId(id: string): boolean {
  return /^tt\d{7,}$/.test(id);
}
