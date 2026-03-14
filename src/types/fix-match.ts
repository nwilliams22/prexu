/**
 * Types for Plex match/fix metadata API responses.
 */

export interface PlexSearchResult {
  guid: string;
  name: string;
  year: number;
  score: number;
  summary?: string;
  lifespanEnded?: boolean;
  thumb?: string;
}

export interface PlexMatchSearchResponse {
  MediaContainer: {
    size: number;
    SearchResult?: PlexSearchResult[];
  };
}
