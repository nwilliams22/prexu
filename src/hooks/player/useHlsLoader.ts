/**
 * HLS.js dynamic loading and instance management.
 * Handles lazy-loading hls.js, creating/destroying instances, and
 * provides a helper to rebuild a transcode session at a given position.
 */

import { useRef, useCallback } from "react";
import type HlsType from "hls.js";
import { buildTranscodeUrl, buildHlsConfig } from "../../services/plex-playback";

export interface HlsLoaderResult {
  hlsRef: React.MutableRefObject<HlsType | null>;
  HlsCtorRef: React.MutableRefObject<typeof HlsType | null>;
  /** Load hls.js dynamically (cached after first load) */
  loadHls: () => Promise<typeof HlsType>;
  /** Destroy the current HLS instance */
  destroyHls: () => void;
  /** Rebuild HLS transcode session at a new position/track selection */
  rebuildHls: (params: RebuildHlsParams) => Promise<void>;
}

export interface RebuildHlsParams {
  serverUri: string;
  serverToken: string;
  ratingKey: string;
  video: HTMLVideoElement;
  startTime: number;
  audioStreamId?: number;
  subtitleStreamId?: number;
  audioCodec?: string;
  quality: string;
  subtitleSize: number;
  audioBoost: number;
  onError: (msg: string) => void;
}

export function useHlsLoader(): HlsLoaderResult {
  const hlsRef = useRef<HlsType | null>(null);
  const HlsCtorRef = useRef<typeof HlsType | null>(null);

  const loadHls = useCallback(async (): Promise<typeof HlsType> => {
    if (HlsCtorRef.current) return HlsCtorRef.current;
    const { default: Hls } = await import("hls.js");
    HlsCtorRef.current = Hls;
    return Hls;
  }, []);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  const rebuildHls = useCallback(
    async (params: RebuildHlsParams) => {
      const Hls = await loadHls();
      destroyHls();

      const url = await buildTranscodeUrl(
        params.serverUri,
        params.serverToken,
        params.ratingKey,
        {
          offset: Math.round(params.startTime * 1000),
          audioStreamId: params.audioStreamId,
          subtitleStreamId: params.subtitleStreamId,
          audioCodec: params.audioCodec,
          quality: params.quality,
          subtitleSize: params.subtitleSize,
          audioBoost: params.audioBoost,
        },
      );

      const hlsConfig = buildHlsConfig(params.serverToken, {
        maxBufferLength: 30,
        startPosition: params.startTime,
      });
      const hls = new Hls(hlsConfig);

      hls.loadSource(url);
      hls.attachMedia(params.video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        params.video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          // Attempt automatic recovery for media errors (fragParsingError, etc.)
          hls.recoverMediaError();
        } else {
          params.onError(
            `Playback error — stream could not be loaded`,
          );
        }
      });

      hlsRef.current = hls;
    },
    [loadHls, destroyHls],
  );

  return { hlsRef, HlsCtorRef, loadHls, destroyHls, rebuildHls };
}
