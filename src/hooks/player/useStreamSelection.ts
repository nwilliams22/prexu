/**
 * Audio and subtitle track selection with HLS transcode session rebuild.
 */

import { useState, useCallback, useMemo } from "react";
import type { PlexStream } from "../../types/library";
import type { HlsLoaderResult } from "./useHlsLoader";

export interface StreamSelectionResult {
  audioTracks: PlexStream[];
  subtitleTracks: PlexStream[];
  selectedAudioId: number | null;
  selectedSubtitleId: number | null;
  setAudioTracks: (tracks: PlexStream[]) => void;
  setSubtitleTracks: (tracks: PlexStream[]) => void;
  setSelectedAudioId: (id: number | null) => void;
  setSelectedSubtitleId: (id: number | null) => void;
  selectAudioTrack: (streamId: number) => Promise<void>;
  selectSubtitleTrack: (streamId: number | null) => Promise<void>;
}

export function useStreamSelection(
  server: { uri: string; accessToken: string } | null,
  ratingKey: string,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  hlsLoader: HlsLoaderResult,
  prefsRef: React.MutableRefObject<{ playback: { quality: string; subtitleSize: number; audioBoost: number } }>,
  setIsBuffering: (v: boolean) => void,
  setPlaybackError: (msg: string | null) => void,
): StreamSelectionResult {
  const [audioTracks, setAudioTracks] = useState<PlexStream[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<PlexStream[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState<number | null>(null);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<number | null>(null);

  const selectAudioTrack = useCallback(
    async (streamId: number) => {
      if (!server || streamId === selectedAudioId) return;
      setSelectedAudioId(streamId);

      if (hlsLoader.hlsRef.current) {
        const savedTime = videoRef.current?.currentTime ?? 0;
        setIsBuffering(true);

        const pb = prefsRef.current.playback;
        const newAudioCodec = audioTracks.find((t) => t.id === streamId)?.codec;
        await hlsLoader.rebuildHls({
          serverUri: server.uri,
          serverToken: server.accessToken,
          ratingKey,
          video: videoRef.current!,
          startTime: savedTime,
          audioStreamId: streamId,
          subtitleStreamId: selectedSubtitleId ?? undefined,
          audioCodec: newAudioCodec,
          quality: pb.quality,
          subtitleSize: pb.subtitleSize,
          audioBoost: pb.audioBoost,
          onError: (msg) => setPlaybackError(msg),
        });
      }
    },
    [server, ratingKey, selectedAudioId, selectedSubtitleId, hlsLoader, videoRef, prefsRef, setIsBuffering, setPlaybackError],
  );

  const selectSubtitleTrack = useCallback(
    async (streamId: number | null) => {
      if (!server || streamId === selectedSubtitleId) return;
      setSelectedSubtitleId(streamId);

      if (hlsLoader.hlsRef.current) {
        const savedTime = videoRef.current?.currentTime ?? 0;
        setIsBuffering(true);

        const pb = prefsRef.current.playback;
        const currentAudioCodec = audioTracks.find((t) => t.id === selectedAudioId)?.codec;
        await hlsLoader.rebuildHls({
          serverUri: server.uri,
          serverToken: server.accessToken,
          ratingKey,
          video: videoRef.current!,
          startTime: savedTime,
          audioStreamId: selectedAudioId ?? undefined,
          subtitleStreamId: streamId ?? undefined,
          audioCodec: currentAudioCodec,
          quality: pb.quality,
          subtitleSize: pb.subtitleSize,
          audioBoost: pb.audioBoost,
          onError: (msg) => setPlaybackError(msg),
        });
      }
    },
    [server, ratingKey, selectedAudioId, selectedSubtitleId, hlsLoader, videoRef, prefsRef, setIsBuffering, setPlaybackError],
  );

  return useMemo(() => ({
    audioTracks,
    subtitleTracks,
    selectedAudioId,
    selectedSubtitleId,
    setAudioTracks,
    setSubtitleTracks,
    setSelectedAudioId,
    setSelectedSubtitleId,
    selectAudioTrack,
    selectSubtitleTrack,
  }), [
    audioTracks,
    subtitleTracks,
    selectedAudioId,
    selectedSubtitleId,
    selectAudioTrack,
    selectSubtitleTrack,
  ]);
}
