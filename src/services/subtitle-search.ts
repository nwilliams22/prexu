/**
 * Subtitle search and download via the Plex server's built-in OpenSubtitles integration.
 * The Plex server proxies searches and downloads through its own subtitle agent.
 */

import { fetchJson } from "./plex-library/base";
import { getServerHeaders, timedFetch } from "./plex-api";
import type { ExternalSubtitle } from "../types/subtitles";

interface PlexSubtitleResult {
  id: string;
  key: string;
  codec: string;
  provider: string;
  score: number;
  displayTitle?: string;
  language?: string;
  languageCode?: string;
  hearingImpaired?: boolean;
}

interface PlexSubtitleResponse {
  MediaContainer: {
    size: number;
    Metadata?: PlexSubtitleResult[];
  };
}

/**
 * Search for subtitles via the Plex server's subtitle agent.
 * Uses the endpoint: GET /library/metadata/{ratingKey}/subtitles?language={lang}
 */
export async function searchSubtitles(
  serverUri: string,
  serverToken: string,
  ratingKey: string,
  language: string
): Promise<ExternalSubtitle[]> {
  const data = await fetchJson<PlexSubtitleResponse>(
    serverUri,
    serverToken,
    `/library/metadata/${ratingKey}/subtitles?language=${encodeURIComponent(language)}`
  );

  const results = data.MediaContainer.Metadata ?? [];

  return results.map((r) => ({
    id: r.id,
    key: r.key,
    fileName: r.displayTitle ?? `Subtitle (${r.languageCode ?? language})`,
    language: r.language ?? language,
    format: r.codec ?? "srt",
    hearingImpaired: r.hearingImpaired ?? false,
    matchConfidence: Math.min(r.score / 100, 1),
    provider: r.provider ?? "unknown",
  }));
}

/**
 * Download and attach a subtitle to a media item via the Plex server.
 * Uses PUT /library/metadata/{ratingKey}/subtitles?key={subtitleKey}
 *
 * The Plex server downloads the subtitle file from the provider and saves it
 * alongside the media file for future use.
 */
export async function downloadSubtitle(
  serverUri: string,
  serverToken: string,
  ratingKey: string,
  subtitleKey: string
): Promise<void> {
  const headers = await getServerHeaders(serverToken);
  const response = await timedFetch(
    `${serverUri}/library/metadata/${ratingKey}/subtitles?key=${encodeURIComponent(subtitleKey)}`,
    { method: "PUT", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to download subtitle: ${response.status}`);
  }
}
