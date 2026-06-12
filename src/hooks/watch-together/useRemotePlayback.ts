/**
 * Handles remote play/pause/seek events and broadcasts local playback changes.
 */

import { useEffect, useRef, useCallback } from "react";
import { watchSync } from "../../services/watch-sync";
import type { UsePlayerResult } from "../usePlayer";
import type { SyncStatus } from "./useWatchTogetherSession";

export interface UseRemotePlaybackResult {
  syncTogglePlay: () => void;
  syncSeek: (time: number) => void;
  remoteActionRef: React.MutableRefObject<boolean>;
  lastRemoteSyncRef: React.MutableRefObject<{
    time: number;
    localTimestamp: number;
  } | null>;
}

export function useRemotePlayback(
  player: UsePlayerResult,
  isInSession: boolean,
  setSyncStatus: (status: SyncStatus) => void
): UseRemotePlaybackResult {
  // Echo guard: prevents re-broadcasting events we received from remote
  const remoteActionRef = useRef(false);

  // Track last known remote sync point for drift detection
  const lastRemoteSyncRef = useRef<{
    time: number;
    localTimestamp: number;
  } | null>(null);

  // Broadcast local play/pause changes
  useEffect(() => {
    if (!isInSession) return;

    // Skip if this play/pause was triggered by a remote event
    if (remoteActionRef.current) {
      remoteActionRef.current = false;
      return;
    }

    const now = Date.now();
    if (player.isPlaying) {
      watchSync.send({
        type: "play",
        current_time: player.currentTime,
        timestamp: now,
      });
    } else if (player.duration > 0) {
      // Only broadcast pause if we actually have media loaded
      watchSync.send({
        type: "pause",
        current_time: player.currentTime,
        timestamp: now,
      });
    }
  }, [player.isPlaying, isInSession]);

  // Listen for remote play/pause/seek events.
  //
  // We route through `player.seek` / `player.togglePlay` rather than touching
  // `videoRef.current` directly so this works on both the HTML5 path (videoRef
  // populated) and the native libmpv path (videoRef is always null on Windows).
  // Refs let us read the latest player state inside long-lived listeners
  // without re-binding the watchSync subscriptions on every render.
  const playerRef = useRef(player);
  playerRef.current = player;
  useEffect(() => {
    if (!isInSession) return;

    const unsubPlay = watchSync.on(
      "remote_play",
      (data: {
        current_time: number;
        timestamp: number;
        from_user: string;
      }) => {
        const p = playerRef.current;
        const transitDelay = Math.min(
          (Date.now() - data.timestamp) / 1000,
          2
        );
        const adjustedTime = data.current_time + transitDelay;

        remoteActionRef.current = true;
        p.seek(adjustedTime);
        if (!p.isPlaying) {
          p.togglePlay();
        }

        lastRemoteSyncRef.current = {
          time: adjustedTime,
          localTimestamp: Date.now(),
        };
        setSyncStatus("synced");
      }
    );

    const unsubPause = watchSync.on(
      "remote_pause",
      (data: { current_time: number; timestamp: number }) => {
        const p = playerRef.current;
        remoteActionRef.current = true;
        p.seek(data.current_time);
        if (p.isPlaying) {
          p.togglePlay();
        }

        lastRemoteSyncRef.current = null;
        setSyncStatus("synced");
      }
    );

    const unsubSeek = watchSync.on(
      "remote_seek",
      (data: { current_time: number; timestamp: number }) => {
        const p = playerRef.current;
        const transitDelay = Math.min(
          (Date.now() - data.timestamp) / 1000,
          2
        );
        const adjustedTime = data.current_time + transitDelay;

        remoteActionRef.current = true;
        p.seek(adjustedTime);

        lastRemoteSyncRef.current = {
          time: adjustedTime,
          localTimestamp: Date.now(),
        };
        setSyncStatus("synced");
      }
    );

    return () => {
      unsubPlay();
      unsubPause();
      unsubSeek();
    };
  }, [isInSession, setSyncStatus]);

  // Broadcast buffering state
  useEffect(() => {
    if (!isInSession) return;

    if (player.isBuffering) {
      watchSync.send({
        type: "buffering",
        current_time: player.currentTime,
      });
    } else if (player.isPlaying) {
      watchSync.send({
        type: "ready",
        current_time: player.currentTime,
      });
    }
  }, [player.isBuffering, isInSession]);

  // Sync-aware actions
  const syncTogglePlay = useCallback(() => {
    player.togglePlay();
    // Broadcasting happens via the isPlaying effect above
  }, [player]);

  const syncSeek = useCallback(
    (time: number) => {
      player.seek(time);
      if (isInSession) {
        watchSync.send({
          type: "seek",
          current_time: time,
          timestamp: Date.now(),
        });
        lastRemoteSyncRef.current = {
          time,
          localTimestamp: Date.now(),
        };
      }
    },
    [player, isInSession]
  );

  return {
    syncTogglePlay,
    syncSeek,
    remoteActionRef,
    lastRemoteSyncRef,
  };
}
