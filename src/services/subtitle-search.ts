/**
 * Subtitle search and download via the Plex server's built-in OpenSubtitles integration.
 * The Plex server proxies searches and downloads through its own subtitle agent.
 */

import { fetchJson } from "./plex-library/base";
import { getItemMetadata } from "./plex-library";
import { getServerHeaders, timedFetch } from "./plex-api";
import { logger } from "./logger";
import type { ExternalSubtitle } from "../types/subtitles";
import type { PlexMediaItem, PlexMovie, PlexStream } from "../types/library";

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
 * The Plex subtitle agent only accepts ISO 639-1 two-letter codes; the
 * three-letter 639-2 codes used elsewhere in the app (embedded stream
 * languageCode) make it return HTTP 500.
 *
 * Covers both ISO 639-2/T (terminological) and ISO 639-2/B (bibliographic)
 * codes. Plex commonly sends the /B variants for several languages (e.g.
 * "fre" instead of "fra", "ger" instead of "deu") which would otherwise
 * fall through the map and reproduce the 500 this lookup is meant to prevent.
 */
const ISO_639_2_TO_1: Record<string, string> = {
  // ISO 639-2/T (terminological) codes
  eng: "en", spa: "es", fra: "fr", deu: "de", ita: "it",
  por: "pt", rus: "ru", jpn: "ja", kor: "ko", zho: "zh",
  ara: "ar", hin: "hi", nld: "nl", pol: "pl", swe: "sv",
  nor: "no", dan: "da", fin: "fi", tur: "tr",
  // ISO 639-2/B (bibliographic) aliases — same 639-1 target as their /T counterparts
  fre: "fr", // French    (fra)
  ger: "de", // German    (deu)
  chi: "zh", // Chinese   (zho)
  dut: "nl", // Dutch     (nld)
  cze: "cs", // Czech     (ces)
  gre: "el", // Greek     (ell)
  ice: "is", // Icelandic (isl)
  mac: "mk", // Macedonian (mkd)
  may: "ms", // Malay     (msa)
  bur: "my", // Burmese   (mya)
  per: "fa", // Persian   (fas)
  rum: "ro", // Romanian  (ron)
  slo: "sk", // Slovak    (slk)
  tib: "bo", // Tibetan   (bod)
  wel: "cy", // Welsh     (cym)
  arm: "hy", // Armenian  (hye)
  geo: "ka", // Georgian  (kat)
  baq: "eu", // Basque    (eus)
  alb: "sq", // Albanian  (sqi)
};

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
  const lang = ISO_639_2_TO_1[language] ?? language;
  logger.debug("api", "searchSubtitles", { ratingKey, language: lang });
  const data = await fetchJson<PlexSubtitleResponse>(
    serverUri,
    serverToken,
    `/library/metadata/${ratingKey}/subtitles?language=${encodeURIComponent(lang)}`
  );

  const results = data.MediaContainer.Stream ?? [];
  logger.info("api", "searchSubtitles results", { ratingKey, language, count: results.length });

  return results.map((r) => ({
    id: String(r.id),
    key: r.key,
    // `title` carries the provider's source file name (what the official
    // Plex app shows); displayTitle is just the language label.
    fileName: r.title ?? r.displayTitle ?? `Subtitle (${r.languageCode ?? language})`,
    language: r.language ?? language,
    format: r.codec ?? "srt",
    hearingImpaired: Boolean(r.hearingImpaired),
    matchConfidence:
      typeof r.score === "number" ? Math.min(r.score / 100, 1) : null,
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

export interface DownloadedSubtitleResult {
  /** All subtitle streams of the part after the download landed. */
  tracks: PlexStream[];
  /** The newly added stream. */
  added: PlexStream;
}

/**
 * Poll item metadata until a newly downloaded subtitle stream appears.
 * The download PUT returns before the server has fetched the file from the
 * provider, so the new stream shows up in the part's metadata asynchronously.
 * Returns null if it never appears within the attempt budget.
 */
export async function waitForDownloadedSubtitle(
  serverUri: string,
  serverToken: string,
  ratingKey: string,
  partId: number | undefined,
  prevTrackIds: number[],
  attempts = 6,
  delayMs = 1000,
): Promise<DownloadedSubtitleResult | null> {
  const prevIds = new Set(prevTrackIds);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const fresh = await getItemMetadata<PlexMediaItem>(serverUri, serverToken, ratingKey);
      const media = (fresh as PlexMovie).Media?.[0];
      const part = media?.Part?.find((p) => p.id === partId) ?? media?.Part?.[0];
      const tracks = part?.Stream?.filter((s) => s.streamType === 3) ?? [];
      const added = tracks.find((t) => !prevIds.has(t.id));
      if (added) {
        logger.info("api", "downloaded subtitle appeared in metadata", {
          ratingKey,
          streamId: added.id,
          attempt,
        });
        return { tracks, added };
      }
      logger.debug("api", "downloaded subtitle not in metadata yet", { attempt });
    } catch (err) {
      logger.warn("api", "subtitle metadata poll failed", {
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (attempt < attempts) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  logger.warn("api", "downloaded subtitle never appeared in metadata", { ratingKey, partId });
  return null;
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
