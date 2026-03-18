/**
 * Plex playback service — stream URL construction, decision logic,
 * and timeline reporting.
 */

import { getServerHeaders, timedFetch } from "./plex-api";
import { getClientIdentifier } from "./storage";
import { createTauriLoaderClass } from "./tauri-loader";
import type { PlexMediaInfo, PlexMediaPart, PlexStream } from "../types/library";

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

  return containerOk && videoOk && audioOk;
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
 * Fire-and-forget timeline report using sendBeacon (for page unload).
 * Falls back to synchronous approach.
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

  if (navigator.sendBeacon) {
    navigator.sendBeacon(url);
  } else {
    // Fallback
    try {
      const headers = await getServerHeaders(serverToken);
      await timedFetch(url, { headers, keepalive: true });
    } catch {
      // Best effort
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
