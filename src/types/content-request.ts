/**
 * Types for the content request system and TMDb API responses.
 */

// ── TMDb search result types ──

export interface TmdbMovie {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  popularity: number;
}

export interface TmdbTvShow {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  first_air_date: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  popularity: number;
}

/** Unified search result with a discriminator field */
export type TmdbSearchResult =
  | (TmdbMovie & { media_type: "movie" })
  | (TmdbTvShow & { media_type: "tv" });

// ── TMDb API response shapes ──

export interface TmdbSearchMovieResponse {
  page: number;
  results: TmdbMovie[];
  total_pages: number;
  total_results: number;
}

export interface TmdbSearchTvResponse {
  page: number;
  results: TmdbTvShow[];
  total_pages: number;
  total_results: number;
}

export interface TmdbFindResponse {
  movie_results: TmdbMovie[];
  tv_results: TmdbTvShow[];
  tv_episode_results: unknown[];
  tv_season_results: unknown[];
  person_results: unknown[];
}

// ── Content request types ──

export type RequestStatus = "pending" | "approved" | "declined";
export type RequestMediaType = "movie" | "tv";

export interface ContentRequest {
  requestId: string;
  tmdbId: number;
  imdbId?: string;
  mediaType: RequestMediaType;
  title: string;
  year: string;
  posterPath: string | null;
  overview: string;
  requesterUsername: string;
  requesterThumb: string;
  status: RequestStatus;
  requestedAt: number;
  respondedAt?: number;
  adminNote?: string;
  /** Target server name (when user has access to multiple servers) */
  targetServerName?: string;
  /** Target server client identifier */
  targetServerId?: string;
}

// ── Relay message payloads ──

export interface ContentRequestMessage {
  type: "content_request";
  request_id: string;
  tmdb_id: number;
  imdb_id?: string;
  media_type: RequestMediaType;
  title: string;
  year: string;
  poster_path: string | null;
  overview: string;
  requester_username: string;
  requester_thumb: string;
  requested_at: number;
  target_server_name?: string;
  target_server_id?: string;
}

export interface ContentRequestResponseMessage {
  type: "content_request_response";
  request_id: string;
  status: "approved" | "declined";
  admin_note?: string;
}
