/**
 * Plex playback service — stream URL construction, decision logic,
 * and timeline reporting.
 */

import { getServerHeaders, timedFetch } from "./plex-api";
import { getClientIdentifier } from "./storage";
import { createTauriLoaderClass } from "./tauri-loader";
import { getItemMetadata } from "./plex-library";
import { getLocalFilePath } from "./downloads";
import type {
  PlexMediaItem,
  PlexMovie,
  PlexEpisode,
  PlexMediaInfo,
  PlexMediaPart,
  PlexStream,
} from "../types/library";
import type { PlaybackPreferences } from "../types/preferences";
import { logger } from "./logger";

/**
 * Build hls.js config with a custom fetch-based loader.
 * The loader uses window.fetch (intercepted by Tauri's HTTP plugin)
 * which routes through Rust reqwest, bypassing CORS.
 */
export function buildHlsConfig(
  serverToken: string,
  extraConfig?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    loader: createTauriLoaderClass(serverToken),
    // Buffer tuning for smoother playback
    maxBufferLength: 60,           // buffer up to 60s ahead
    maxMaxBufferLength: 120,       // allow up to 120s in good conditions
    maxBufferSize: 60 * 1000000,   // 60MB buffer cap
    maxBufferHole: 0.5,            // tolerate 0.5s gaps
    lowLatencyMode: false,         // not live streaming, prioritize smoothness
    ...extraConfig,
  };
}

// ── Direct Play Detection ──

/** Browser-playable codec/container combos for raw file direct play (WebView2/Chromium) */
const DIRECT_PLAY_CONTAINERS = ["mp4", "m4v", "mov"];
const DIRECT_PLAY_VIDEO_CODECS = ["h264", "avc1"];
const DIRECT_PLAY_AUDIO_CODECS = ["aac", "mp3", "flac", "opus"];

/**
 * Audio codecs that can be passed through (direct-streamed) in HLS/MPEGTS.
 * This is broader than direct play because HLS containers handle more codecs.
 */
const HLS_DIRECT_AUDIO_CODECS = ["aac", "mp3", "flac", "opus", "ac3", "eac3"];

/** Check if an audio codec can be direct-streamed in HLS (no transcoding needed) */
export function canDirectStreamAudio(audioCodec: string | undefined): boolean {
  if (!audioCodec) return false;
  return HLS_DIRECT_AUDIO_CODECS.includes(audioCodec.toLowerCase());
}

export function canDirectPlay(media: PlexMediaInfo): boolean {
  const part = media.Part?.[0];
  if (!part) return false;

  const containerOk = DIRECT_PLAY_CONTAINERS.includes(
    part.container.toLowerCase()
  );
  const videoOk = DIRECT_PLAY_VIDEO_CODECS.includes(
    media.videoCodec.toLowerCase()
  );
  const audioOk = DIRECT_PLAY_AUDIO_CODECS.includes(
    media.audioCodec.toLowerCase()
  );

  const result = containerOk && videoOk && audioOk;
  logger.debug("playback", "canDirectPlay", { result });
  return result;
}

// ── URL Construction ──

export function buildDirectPlayUrl(
  serverUri: string,
  serverToken: string,
  partKey: string
): string {
  const params = new URLSearchParams({ "X-Plex-Token": serverToken });
  return `${serverUri}${partKey}?${params.toString()}`;
}

/** Quality preset -> transcode parameters */
export const QUALITY_PRESETS: Record<
  string,
  { resolution: string; bitrate: number }
> = {
  "1080p": { resolution: "1920x1080", bitrate: 20000 },
  "720p": { resolution: "1280x720", bitrate: 4000 },
  "480p": { resolution: "720x480", bitrate: 2000 },
};

export async function buildTranscodeUrl(
  serverUri: string,
  serverToken: string,
  ratingKey: string,
  options?: {
    offset?: number;
    audioStreamId?: number;
    subtitleStreamId?: number;
    quality?: string;
    subtitleSize?: number;
    audioBoost?: number;
    /** Audio codec of the selected stream — used to decide if audio can be direct-streamed */
    audioCodec?: string;
  }
): Promise<string> {
  logger.info("playback", "buildTranscodeUrl");
  const clientId = await getClientIdentifier();
  const sessionId = crypto.randomUUID();

  const preset =
    QUALITY_PRESETS[options?.quality ?? "1080p"] ?? QUALITY_PRESETS["1080p"];

  // Only direct-stream audio if the codec is browser-compatible (e.g., AAC, MP3, AC3)
  // DTS, TrueHD, and other exotic codecs must be transcoded to AAC
  const allowDirectAudio = canDirectStreamAudio(options?.audioCodec) ? "1" : "0";

  const params = new URLSearchParams({
    hasMDE: "1",
    path: `/library/metadata/${ratingKey}`,
    mediaIndex: "0",
    partIndex: "0",
    protocol: "hls",
    fastSeek: "1",
    directPlay: "0",
    directStream: "1",
    directStreamAudio: allowDirectAudio,
    videoQuality: "100",
    videoResolution: preset.resolution,
    maxVideoBitrate: String(preset.bitrate),
    subtitleSize: String(options?.subtitleSize ?? 100),
    audioBoost: String(options?.audioBoost ?? 100),
    location: "lan",
    autoAdjustQuality: "0",
    directPlayAllowed: "1",
    "X-Plex-Session-Identifier": sessionId,
    session: sessionId,
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Product": "Prexu",
    "X-Plex-Platform": "Web",
    "X-Plex-Token": serverToken,
  });

  if (options?.offset !== undefined && options.offset > 0) {
    params.set("offset", String(Math.floor(options.offset)));
  }

  if (options?.audioStreamId !== undefined) {
    params.set("audioStreamID", String(options.audioStreamId));
  }

  if (options?.subtitleStreamId !== undefined) {
    params.set("subtitleStreamID", String(options.subtitleStreamId));
    params.set("subtitles", "burn");
  }

  // Client profile: tell Plex what we accept in HLS/MPEGTS
  // H264 + HEVC video, AAC/MP3 audio
  params.set(
    "X-Plex-Client-Profile-Extra",
    [
      "add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=h264,hevc&audioCodec=aac,mp3,ac3,eac3)",
      "add-limitation(scope=videoCodec&scopeName=hevc&type=upperBound&name=video.bitDepth&value=10)",
    ].join("+")
  );

  return `${serverUri}/video/:/transcode/universal/start.m3u8?${params.toString()}`;
}

// ── Stream Categorization ──

export interface CategorizedStreams {
  video: PlexStream | null;
  audio: PlexStream[];
  subtitles: PlexStream[];
}

export function categorizeStreams(part: PlexMediaPart): CategorizedStreams {
  const streams = part.Stream ?? [];
  return {
    video: streams.find((s) => s.streamType === 1) ?? null,
    audio: streams.filter((s) => s.streamType === 2),
    subtitles: streams.filter((s) => s.streamType === 3),
  };
}

// ── Timeline Reporting ──

/**
 * Reports playback position to the Plex server.
 * This updates "Now Playing", watch history, and resume position.
 */
export async function reportTimeline(
  serverUri: string,
  serverToken: string,
  ratingKey: string,
  state: "playing" | "paused" | "stopped" | "buffering",
  timeMs: number,
  durationMs: number
): Promise<void> {
  logger.trace("playback", "reportTimeline", { state, timeMs: Math.round(timeMs) });
  const headers = await getServerHeaders(serverToken);
  const clientId = await getClientIdentifier();

  const params = new URLSearchParams({
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    state,
    time: String(Math.round(timeMs)),
    duration: String(Math.round(durationMs)),
    "X-Plex-Client-Identifier": clientId,
  });

  try {
    await timedFetch(`${serverUri}/:/timeline?${params.toString()}`, {
      headers,
    });
  } catch {
    // Timeline reporting is best-effort; don't break playback on failure
  }
}

/**
 * Final "stopped" timeline report on player exit.
 *
 * This report is what clears a stale resume point: the server only drops an
 * in-progress marker when it receives `state=stopped` with time < 60s. It
 * must go through the same GET/timedFetch path as the periodic reports —
 * sendBeacon issues a POST that `/:/timeline` does not accept, so the old
 * beacon-first implementation silently dropped every exit report and the
 * dashboard kept the previous resume offset. Player exit is an SPA route
 * change (the webview survives), so an awaited fetch is reliable here;
 * sendBeacon remains only as a long-shot fallback when fetch itself throws
 * (genuine page teardown).
 */
export async function reportTimelineBeacon(
  serverUri: string,
  serverToken: string,
  ratingKey: string,
  timeMs: number,
  durationMs: number
): Promise<void> {
  const clientId = await getClientIdentifier();

  const params = new URLSearchParams({
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    state: "stopped",
    time: String(Math.round(timeMs)),
    duration: String(Math.round(durationMs)),
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Token": serverToken,
  });

  const url = `${serverUri}/:/timeline?${params.toString()}`;
  logger.info("playback", "reportTimelineBeacon stopped", {
    ratingKey,
    timeMs: Math.round(timeMs),
  });

  try {
    const headers = await getServerHeaders(serverToken);
    await timedFetch(url, { headers, keepalive: true });
  } catch (err) {
    logger.warn("playback", "stopped report fetch failed, trying sendBeacon", {
      error: err instanceof Error ? err.message : String(err),
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url);
    }
  }
}

// ── Volume Persistence ──

const VOLUME_KEY = "prexu_volume";

export function getSavedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (raw !== null) {
      const vol = parseFloat(raw);
      if (!isNaN(vol) && vol >= 0 && vol <= 2) return vol;
    }
  } catch {
    // Ignore
  }
  return 1;
}

export function saveVolume(volume: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // Ignore
  }
}

// ── Shared source preparation ──

export type SourceKind = "local" | "direct" | "transcode";

export interface PreparedSource {
  /** Resolved URL/path passed to the backend. Local URLs are raw file paths;
   *  callers that need an asset-protocol URL (HTML5) must wrap with convertFileSrc. */
  url: string;
  /** Final metadata item as returned by getItemMetadata. */
  item: PlexMediaItem;
  /** Cast to movie | episode — non-null for those types. */
  playable: PlexMovie | PlexEpisode;
  /** First Media entry. */
  media: PlexMediaInfo;
  /** First Part of first Media. */
  part: PlexMediaPart;
  /** Resume position in milliseconds (override-aware). */
  viewOffset: number;
  /** Categorized audio + subtitle streams from the part. */
  categorized: ReturnType<typeof categorizeStreams>;
  /** Default audio stream selected by preference rules. */
  defaultAudio: PlexStream | undefined;
  /** Default subtitle stream selected by preference rules, or undefined when off. */
  defaultSub: PlexStream | undefined;
  /** Which source was chosen. */
  sourceKind: SourceKind;
  /** True when the URL is a raw local file path from getLocalFilePath. */
  isLocal: boolean;
}

export interface PrepareSourceArgs {
  server: { uri: string; accessToken: string };
  ratingKey: string;
  preferences: PlaybackPreferences;
  offsetOverride?: number | null;
  /** True when the previous direct-play attempt failed — forces transcode. */
  directPlayFailed?: boolean;
  /** True when the backend handles every codec natively (e.g. mpv) and the
   *  HTML5 canDirectPlay() codec whitelist should be bypassed. */
  skipCodecCheck?: boolean;
}

/**
 * Shared source-preparation helper used by both useNativePlayer and
 * useHtml5Player. Fetches metadata, picks streams, resolves the playback URL,
 * and returns a PreparedSource struct. The only backend-specific steps are:
 *  - useHtml5Player wraps the local url with convertFileSrc before use.
 *  - useNativePlayer passes skipCodecCheck: true so mpv isn't forced to
 *    transcode files it can decode natively.
 */
export async function prepareSource(args: PrepareSourceArgs): Promise<PreparedSource> {
  const { server, ratingKey, preferences: pb, offsetOverride, directPlayFailed = false, skipCodecCheck = false } = args;

  logger.debug("player", "prepareSource", { ratingKey, directPlayFailed, skipCodecCheck });

  // Run the metadata fetch (network RTT) and local-file lookup (Tauri IPC)
  // concurrently — they are independent. A metadata rejection still throws to
  // the caller (the local-path result is discarded, matching the old
  // waterfall where it never ran); a local-path failure is still swallowed.
  const [item, localPath] = await Promise.all([
    getItemMetadata<PlexMediaItem>(server.uri, server.accessToken, ratingKey),
    getLocalFilePath(ratingKey).catch(() => null),
  ]);

  const playable = item as PlexMovie | PlexEpisode;
  const media = playable.Media?.[0];
  if (!media || !media.Part || media.Part.length === 0) {
    throw new Error("No playable media found");
  }
  const part = media.Part[0];

  const categorized = categorizeStreams(part);

  let defaultAudio = pb.preferredAudioLanguage
    ? categorized.audio.find((s) => s.languageCode === pb.preferredAudioLanguage)
    : undefined;
  if (!defaultAudio) defaultAudio = categorized.audio.find((s) => s.selected);

  let defaultSub: PlexStream | undefined;
  if (pb.defaultSubtitles === "off") {
    defaultSub = undefined;
  } else if (pb.defaultSubtitles === "always" && pb.preferredSubtitleLanguage) {
    defaultSub =
      categorized.subtitles.find((s) => s.languageCode === pb.preferredSubtitleLanguage) ??
      categorized.subtitles[0];
  } else {
    defaultSub = categorized.subtitles.find((s) => s.selected);
  }

  const viewOffset = offsetOverride != null ? offsetOverride : (playable.viewOffset ?? 0);

  // Check for a locally downloaded file first.
  if (localPath) {
    logger.debug("player", "URL chosen: local file", { ratingKey });
    return {
      url: localPath,
      item,
      playable,
      media,
      part,
      viewOffset,
      categorized,
      defaultAudio,
      defaultSub,
      sourceKind: "local",
      isLocal: true,
    };
  }

  // `skipCodecCheck` is the only thing that lets the HTML5 codec gate be
  // skipped. Without it, BOTH "always" and "auto" require canDirectPlay()
  // to be true — otherwise the browser <video> element errors on the
  // incompatible file, the error handler flips directPlayFailedRef, and
  // the user sees a brief failure flash before the transcode retry. The
  // pre-extraction HTML5 logic enforced the same `&& canDirectPlay(media)`
  // guard outside the `shouldDirectPlay` boolean; preserve that here so
  // "always" remains a silent fall-through to transcode for incompatible
  // codecs on HTML5.
  const codecOk = skipCodecCheck || pb.quality === "original" || canDirectPlay(media);
  const directPlayPossible =
    !directPlayFailed &&
    (
      (pb.directPlayPreference === "always" && codecOk) ||
      (pb.directPlayPreference === "auto" && codecOk)
    );

  if (directPlayPossible) {
    const url = buildDirectPlayUrl(server.uri, server.accessToken, part.key);
    logger.debug("player", "URL chosen: direct play", {
      container: part.container,
      videoCodec: media.videoCodec,
      audioCodec: media.audioCodec,
    });
    return {
      url,
      item,
      playable,
      media,
      part,
      viewOffset,
      categorized,
      defaultAudio,
      defaultSub,
      sourceKind: "direct",
      isLocal: false,
    };
  }

  const url = await buildTranscodeUrl(server.uri, server.accessToken, ratingKey, {
    audioStreamId: defaultAudio?.id,
    subtitleStreamId: defaultSub?.id,
    quality: pb.quality,
    subtitleSize: pb.subtitleSize,
    audioBoost: pb.audioBoost,
    audioCodec: defaultAudio?.codec ?? media.audioCodec,
  });
  logger.debug("player", "URL chosen: transcode", {
    reason: directPlayFailed ? "previous direct-play failure" : "user preference=never",
    quality: pb.quality,
  });
  return {
    url,
    item,
    playable,
    media,
    part,
    viewOffset,
    categorized,
    defaultAudio,
    defaultSub,
    sourceKind: "transcode",
    isLocal: false,
  };
}

/**
 * Derive the display title/subtitle pair from a PlexMediaItem.
 * Episodes → { title: showName, subtitle: "S01E02 — Episode Title" }
 * Movies → { title: movieTitle, subtitle: "Year" }
 * Others → { title: item.title, subtitle: "" }
 */
export function deriveDisplayTitles(item: PlexMediaItem): { title: string; subtitle: string } {
  if (item.type === "episode") {
    const ep = item as PlexEpisode;
    return {
      title: ep.grandparentTitle,
      subtitle: `S${String(ep.parentIndex).padStart(2, "0")}E${String(ep.index).padStart(2, "0")} — ${ep.title}`,
    };
  }
  if (item.type === "movie") {
    const movie = item as PlexMovie;
    return {
      title: movie.title,
      subtitle: movie.year ? String(movie.year) : "",
    };
  }
  return { title: item.title, subtitle: "" };
}
