/**
 * Plex playback service — stream URL construction, decision logic,
 * and timeline reporting.
 */

import { getServerHeaders } from "./plex-api";
import { getClientIdentifier } from "./storage";
import type { PlexMediaInfo, PlexMediaPart, PlexStream } from "../types/library";

/**
 * Build an hls.js config object that includes Plex authentication headers.
 * hls.js uses XHR for manifest/segment fetches — without these headers
 * the Plex server may reject requests.
 */
export async function buildHlsConfig(
  serverToken: string,
  extraConfig?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const headers = await getServerHeaders(serverToken);
  return {
    ...extraConfig,
    xhrSetup(xhr: XMLHttpRequest) {
      for (const [key, value] of Object.entries(headers)) {
        // Don't override Accept for m3u8/ts fetches
        if (key.toLowerCase() !== "accept") {
          xhr.setRequestHeader(key, value);
        }
      }
    },
  };
}

// ── Direct Play Detection ──

/** Browser-playable codec/container combos (WebView2/Chromium) */
const DIRECT_PLAY_CONTAINERS = ["mp4", "m4v", "mov"];
const DIRECT_PLAY_VIDEO_CODECS = ["h264", "avc1"];
const DIRECT_PLAY_AUDIO_CODECS = ["aac", "mp3", "flac", "opus", "ac3", "eac3"];

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
  }
): Promise<string> {
  const clientId = await getClientIdentifier();
  const sessionId = crypto.randomUUID();

  const preset =
    QUALITY_PRESETS[options?.quality ?? "1080p"] ?? QUALITY_PRESETS["1080p"];

  const params = new URLSearchParams({
    path: `/library/metadata/${ratingKey}`,
    mediaIndex: "0",
    partIndex: "0",
    protocol: "hls",
    fastSeek: "1",
    directPlay: "0",
    directStream: "1",
    directStreamAudio: "1",
    videoQuality: "100",
    videoResolution: preset.resolution,
    maxVideoBitrate: String(preset.bitrate),
    subtitleSize: String(options?.subtitleSize ?? 100),
    audioBoost: String(options?.audioBoost ?? 100),
    "X-Plex-Session-Identifier": sessionId,
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Product": "Prexu",
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
  } else {
    params.set("subtitles", "");
  }

  // Client profile: tell Plex we accept H264+AAC in HLS/MPEGTS
  params.set(
    "X-Plex-Client-Profile-Extra",
    "add-transcode-target(type=videoProfile&context=streaming&protocol=hls&container=mpegts&videoCodec=h264&audioCodec=aac,mp3)"
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
    await fetch(`${serverUri}/:/timeline?${params.toString()}`, {
      method: "GET",
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
      await fetch(url, { method: "GET", headers, keepalive: true });
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
      if (!isNaN(vol) && vol >= 0 && vol <= 1) return vol;
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
