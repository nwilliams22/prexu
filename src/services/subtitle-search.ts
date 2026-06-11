/**
 * Subtitle search and download via the Plex server's built-in OpenSubtitles integration.
 * The Plex server proxies searches and downloads through its own subtitle agent.
 */

import { fetchJson } from "./plex-library/base";
import { getServerHeaders, timedFetch } from "./plex-api";
import { logger } from "./logger";
import type { ExternalSubtitle } from "../types/subtitles";

/**
 * Search results come back as SubtitleStream elements (`Stream`, not `Metadata`)
 * in the MediaContainer — matches python-plexapi's media.SubtitleStream (TAG='Stream').
 */
interface PlexSubtitleStream {
  id: number | string;
  key: string;
  codec?: string;
  providerTitle?: string;
  score?: number;
  displayTitle?: string;
  title?: string;
  language?: string;
  languageCode?: string;
  hearingImpaired?: boolean | number;
  forced?: boolean | number;
  sourceKey?: string;
}

interface PlexSubtitleResponse {
  MediaContainer: {
    size: number;
    Stream?: PlexSubtitleStream[];
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
  logger.debug("api", "searchSubtitles", { ratingKey, language });
  const data = await fetchJson<PlexSubtitleResponse>(
    serverUri,
    serverToken,
    `/library/metadata/${ratingKey}/subtitles?language=${encodeURIComponent(language)}`
  );

  const results = data.MediaContainer.Stream ?? [];
  logger.info("api", "searchSubtitles results", { ratingKey, language, count: results.length });

  return results.map((r) => ({
    id: String(r.id),
    key: r.key,
    fileName: r.displayTitle ?? r.title ?? `Subtitle (${r.languageCode ?? language})`,
    language: r.language ?? language,
    format: r.codec ?? "srt",
    hearingImpaired: Boolean(r.hearingImpaired),
    matchConfidence:
      typeof r.score === "number" ? Math.min(r.score / 100, 1) : 0,
    provider: r.providerTitle ?? "unknown",
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
  logger.info("api", "downloadSubtitle", { ratingKey, key: subtitleKey.substring(0, 80) });
  const headers = await getServerHeaders(serverToken);
  const response = await timedFetch(
    `${serverUri}/library/metadata/${ratingKey}/subtitles?key=${encodeURIComponent(subtitleKey)}`,
    { method: "PUT", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to download subtitle: ${response.status}`);
  }
}

/**
 * Set the selected (default) subtitle stream for a media part on the server.
 * Uses PUT /library/parts/{partId}?subtitleStreamID={id}&allParts=1 — id 0 clears
 * the selection (subtitles off). Matches python-plexapi MediaPart.setSelectedSubtitleStream.
 */
export async function setSelectedSubtitleStream(
  serverUri: string,
  serverToken: string,
  partId: number,
  streamId: number | null
): Promise<void> {
  const id = streamId ?? 0;
  logger.info("api", "setSelectedSubtitleStream", { partId, streamId: id });
  const headers = await getServerHeaders(serverToken);
  const response = await timedFetch(
    `${serverUri}/library/parts/${partId}?subtitleStreamID=${id}&allParts=1`,
    { method: "PUT", headers }
  );
  if (!response.ok) {
    throw new Error(`Failed to set subtitle stream: ${response.status}`);
  }
}
