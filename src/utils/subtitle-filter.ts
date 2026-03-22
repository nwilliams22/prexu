import type { PlexStream } from "../types/library";

/**
 * Filter subtitle tracks by search query, language, and hearing impaired flag.
 * Useful when a media file has many embedded subtitle tracks.
 */
export function filterSubtitleTracks(
  tracks: PlexStream[],
  query?: string,
  language?: string,
  hearingImpaired?: boolean
): PlexStream[] {
  let filtered = tracks;

  if (query) {
    const q = query.toLowerCase();
    filtered = filtered.filter(
      (t) =>
        t.displayTitle.toLowerCase().includes(q) ||
        (t.language && t.language.toLowerCase().includes(q)) ||
        (t.languageCode && t.languageCode.toLowerCase().includes(q)) ||
        (t.codec && t.codec.toLowerCase().includes(q))
    );
  }

  if (language) {
    const lang = language.toLowerCase();
    filtered = filtered.filter(
      (t) =>
        (t.languageCode && t.languageCode.toLowerCase() === lang) ||
        (t.language && t.language.toLowerCase() === lang)
    );
  }

  if (hearingImpaired !== undefined) {
    filtered = filtered.filter(
      (t) => (t.hearingImpaired ?? false) === hearingImpaired
    );
  }

  return filtered;
}
