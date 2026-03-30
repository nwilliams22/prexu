import type { PlexMediaInfo, PlexStream } from "../types/library";

export interface MediaBadge {
  label: string;
  type: "resolution" | "hdr" | "audio";
}

/**
 * Convert raw Plex videoResolution (e.g. "1080", "2160", "720", "480", "4k")
 * into a display-friendly badge string.
 */
export function getResolutionBadge(resolution: string): string | null {
  if (!resolution) return null;
  const lower = resolution.toLowerCase().replace("p", "");
  switch (lower) {
    case "2160":
    case "4k":
      return "4K";
    case "1080":
      return "1080p";
    case "720":
      return "720p";
    case "480":
    case "576":
      return "SD";
    default:
      return null;
  }
}

/**
 * Detect HDR / Dolby Vision from video stream properties.
 *
 * Plex indicates HDR via several fields:
 * - PlexStream.DOVIPresent for Dolby Vision
 * - PlexStream.colorSpace "bt2020" for HDR10
 * - PlexStream.bitDepth >= 10 combined with bt2020 colorSpace
 * - PlexStream.extendedDisplayTitle often contains "HDR" or "Dolby Vision"
 */
export function getHdrBadge(
  videoStream?: PlexStream | null,
  videoProfile?: string
): string | null {
  if (!videoStream && !videoProfile) return null;

  // Check Dolby Vision first (most specific)
  if (videoStream?.DOVIPresent) return "DV";

  const extTitle = videoStream?.extendedDisplayTitle?.toLowerCase() ?? "";

  if (extTitle.includes("dolby vision") || extTitle.includes("dovi")) return "DV";
  if (extTitle.includes("hdr10+")) return "HDR10+";
  if (extTitle.includes("hdr10")) return "HDR10";
  if (extTitle.includes("hdr") || extTitle.includes("hlg")) return "HDR";

  // Fallback: bt2020 colorspace with 10-bit depth
  if (
    videoStream?.colorSpace === "bt2020" &&
    videoStream?.bitDepth !== undefined &&
    videoStream.bitDepth >= 10
  ) {
    return "HDR";
  }

  return null;
}

/**
 * Detect Dolby Atmos or other premium audio formats.
 *
 * Plex indicates Atmos via audioProfile or extendedDisplayTitle on audio streams.
 */
export function getAudioBadge(
  audioCodec: string,
  audioChannels: number,
  audioProfile?: string,
  audioStream?: PlexStream | null
): string | null {
  const extTitle = audioStream?.extendedDisplayTitle?.toLowerCase() ?? "";

  // Check for Atmos (can be carried over TrueHD, EAC3, or standalone)
  if (extTitle.includes("atmos")) return "Atmos";

  // Check for DTS:X
  if (extTitle.includes("dts:x") || extTitle.includes("dts-x")) return "DTS:X";

  // Check based on codec
  if (!audioCodec) return null;
  const codec = audioCodec.toLowerCase();
  if (codec === "truehd" && audioChannels >= 6) return "TrueHD";
  if ((codec === "dts" || codec === "dca") && audioProfile === "ma") return "DTS-HD MA";
  if ((codec === "dts" || codec === "dca") && audioChannels >= 6) return "DTS";

  return null;
}

/**
 * Build an array of media badges from a PlexMediaInfo object.
 * Optionally accepts the first video/audio stream for deeper inspection.
 */
export function getMediaBadges(
  media: PlexMediaInfo,
  videoStream?: PlexStream | null,
  audioStream?: PlexStream | null
): MediaBadge[] {
  const badges: MediaBadge[] = [];

  // Resolution badge
  if (media.videoResolution) {
    const res = getResolutionBadge(media.videoResolution);
    if (res) badges.push({ label: res, type: "resolution" });
  }

  // HDR badge
  const hdr = getHdrBadge(videoStream, media.videoProfile);
  if (hdr) badges.push({ label: hdr, type: "hdr" });

  // Audio badge
  const audio = getAudioBadge(
    media.audioCodec,
    media.audioChannels,
    media.audioProfile,
    audioStream
  );
  if (audio) badges.push({ label: audio, type: "audio" });

  return badges;
}

/**
 * Format bitrate as a human-readable string (e.g. "20.5 Mbps", "856 Kbps").
 */
export function formatBitrate(bitrate: number): string {
  if (bitrate >= 1000) {
    return `${(bitrate / 1000).toFixed(1)} Mbps`;
  }
  return `${bitrate} Kbps`;
}

/**
 * Extract video and audio streams from a PlexMediaInfo for badge computation.
 */
export function extractStreamsForBadges(media: PlexMediaInfo): {
  videoStream: PlexStream | null;
  audioStream: PlexStream | null;
} {
  const streams = media.Part?.[0]?.Stream ?? [];
  return {
    videoStream: streams.find((s) => s.streamType === 1) ?? null,
    audioStream: streams.find((s) => s.streamType === 2) ?? null,
  };
}
