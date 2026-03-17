/**
 * Watch Together orchestration hook.
 * Coordinates between the local player and the relay server.
 * No-op when sessionId is null (solo playback unchanged).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth";
import { watchSync } from "../services/watch-sync";
import { getPlexUser } from "../services/plex-api";
import type { UsePlayerResult } from "./usePlayer";
import type { WatchParticipant } from "../types/watch-together";

export interface UseWatchTogetherResult {
  // Session state
  isInSession: boolean;
  isHost: boolean;
  participants: WatchParticipant[];
  syncStatus: "synced" | "syncing" | "disconnected";
  sessionId: string | null;

  // Episode transition
  showNextEpisodePrompt: boolean;
  nextEpisodeInfo: { ratingKey: string; title: string } | null;

  // Sync-aware actions (use these instead of player.togglePlay/seek when in session)
  syncTogglePlay: () => void;
  syncSeek: (time: number) => void;

  // Session control
  leaveSession: () => void;
  loadNextEpisode: (ratingKey: string, title: string) => void;
  dismissNextEpisodePrompt: () => void;
}

export function useWatchTogether(
  player: UsePlayerResult,
  sessionId: string | null,
  isHost: boolean,
  relayUrl?: string | null
): UseWatchTogetherResult {
  const navigate = useNavigate();
  const location = useLocation();

  const [participants, setParticipants] = useState<WatchParticipant[]>([]);
  const [syncStatus, setSyncStatus] = useState<
    "synced" | "syncing" | "disconnected"
  >("disconnected");
  const [showNextEpisodePrompt, setShowNextEpisodePrompt] = useState(false);
  const [nextEpisodeInfo, setNextEpisodeInfo] = useState<{
    ratingKey: string;
    title: string;
  } | null>(null);

  // Echo guard: prevents re-broadcasting events we received from remote
  const remoteActionRef = useRef(false);

  // Track last known remote sync point for drift detection
  const lastRemoteSyncRef = useRef<{
    time: number;
    localTimestamp: number;
  } | null>(null);

  const { authToken } = useAuth();
  const isInSession = sessionId !== null;

  // ── Join session on mount (connect to relay if needed) ──
  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    const joinSession = async () => {
      // If not connected but we have a relay URL (from invite), connect first
      if (!watchSync.isConnected && relayUrl && authToken) {
        try {
          const user = await getPlexUser(authToken);
          watchSync.connect(relayUrl, authToken, user.username, user.thumb);

          // Wait briefly for connection to establish
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Connection timeout")), 5000);
            const unsub = watchSync.on("connected", () => {
              clearTimeout(timeout);
              unsub();
              resolve();
            });
          });
        } catch (err) {
          console.error("[useWatchTogether] Failed to connect via invite relay URL:", err);
          if (!cancelled) setSyncStatus("disconnected");
          return;
        }
      }

      if (cancelled) return;

      if (!watchSync.isConnected) {
        setSyncStatus("disconnected");
        return;
      }

      // If not host, join the session
      if (!isHost) {
        watchSync.send({ type: "join_session", session_id: sessionId });
      }

      setSyncStatus("synced");
    };

    joinSession();

    return () => {
      cancelled = true;
      // Leave session on unmount (navigating away from player)
      watchSync.send({ type: "leave_session" });
    };
  }, [sessionId, isHost, relayUrl, authToken]);

  // ── Broadcast local play/pause changes ──
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

  // ── Listen for remote events ──
  useEffect(() => {
    if (!isInSession) return;

    const video = player.videoRef.current;

    const unsubPlay = watchSync.on(
      "remote_play",
      (data: { current_time: number; timestamp: number; from_user: string }) => {
        if (!video) return;

        // Latency compensation
        const transitDelay = Math.min((Date.now() - data.timestamp) / 1000, 2);
        const adjustedTime = data.current_time + transitDelay;

        remoteActionRef.current = true;
        video.currentTime = adjustedTime;
        if (video.paused) {
          video.play().catch(() => {});
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
        if (!video) return;

        remoteActionRef.current = true;
        video.currentTime = data.current_time;
        if (!video.paused) {
          video.pause();
        }

        lastRemoteSyncRef.current = null;
        setSyncStatus("synced");
      }
    );

    const unsubSeek = watchSync.on(
      "remote_seek",
      (data: { current_time: number; timestamp: number }) => {
        if (!video) return;

        const transitDelay = Math.min((Date.now() - data.timestamp) / 1000, 2);
        const adjustedTime = data.current_time + transitDelay;

        remoteActionRef.current = true;
        video.currentTime = adjustedTime;

        lastRemoteSyncRef.current = {
          time: adjustedTime,
          localTimestamp: Date.now(),
        };
        setSyncStatus("synced");
      }
    );

    const unsubParticipantJoined = watchSync.on(
      "participant_joined",
      (data: { participant: WatchParticipant }) => {
        setParticipants((prev) => [...prev, data.participant]);
      }
    );

    const unsubParticipantLeft = watchSync.on(
      "participant_left",
      (data: { plex_username: string }) => {
        setParticipants((prev) =>
          prev.filter((p) => p.plexUsername !== data.plex_username)
        );
      }
    );

    const unsubSessionJoined = watchSync.on(
      "session_joined",
      (data: { participants: WatchParticipant[] }) => {
        setParticipants(data.participants);
      }
    );

    const unsubSessionDestroyed = watchSync.on("session_destroyed", () => {
      setSyncStatus("disconnected");
      setParticipants([]);
    });

    const unsubNewMedia = watchSync.on(
      "new_media",
      (data: {
        media_rating_key: string;
        media_title: string;
        from_user: string;
      }) => {
        // Navigate to the new media, keeping session context
        navigate(
          `/play/${data.media_rating_key}?session=${sessionId}&host=${isHost}`,
          { replace: true }
        );
      }
    );

    const unsubBuffering = watchSync.on(
      "remote_buffering",
      (data: { from_user: string }) => {
        setParticipants((prev) =>
          prev.map((p) =>
            p.plexUsername === data.from_user
              ? { ...p, state: "buffering" as const }
              : p
          )
        );
      }
    );

    const unsubReady = watchSync.on(
      "remote_ready",
      (data: { from_user: string }) => {
        setParticipants((prev) =>
          prev.map((p) =>
            p.plexUsername === data.from_user
              ? { ...p, state: "ready" as const }
              : p
          )
        );
      }
    );

    const unsubDisconnected = watchSync.on("disconnected", () => {
      setSyncStatus("disconnected");
    });

    const unsubConnected = watchSync.on("connected", () => {
      if (sessionId) {
        setSyncStatus("syncing");
      }
    });

    return () => {
      unsubPlay();
      unsubPause();
      unsubSeek();
      unsubParticipantJoined();
      unsubParticipantLeft();
      unsubSessionJoined();
      unsubSessionDestroyed();
      unsubNewMedia();
      unsubBuffering();
      unsubReady();
      unsubDisconnected();
      unsubConnected();
    };
  }, [isInSession, sessionId, isHost, navigate, player.videoRef]);

  // ── Drift detection (every 2 seconds) ──
  useEffect(() => {
    if (!isInSession || !player.isPlaying) return;

    const driftCheck = setInterval(() => {
      const sync = lastRemoteSyncRef.current;
      if (!sync) return;

      const expectedTime =
        sync.time + (Date.now() - sync.localTimestamp) / 1000;
      const drift = Math.abs(player.currentTime - expectedTime);

      if (drift > 2) {
        const video = player.videoRef.current;
        if (video) {
          remoteActionRef.current = true;
          video.currentTime = expectedTime;
          setSyncStatus("syncing");
          setTimeout(() => setSyncStatus("synced"), 500);
        }
      }
    }, 2000);

    return () => clearInterval(driftCheck);
  }, [isInSession, player.isPlaying, player.currentTime, player.videoRef]);

  // ── Broadcast buffering state ──
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

  // ── Detect episode end for next-episode prompt (host only) ──
  useEffect(() => {
    if (!isInSession || !isHost) return;
    if (player.duration <= 0) return;

    // Check if we're near the end (within 1 second)
    if (
      player.currentTime > 0 &&
      player.duration - player.currentTime < 1 &&
      !player.isPlaying
    ) {
      setShowNextEpisodePrompt(true);
    }
  }, [
    player.currentTime,
    player.duration,
    player.isPlaying,
    isInSession,
    isHost,
  ]);

  // ── Sync-aware actions ──

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

  const leaveSession = useCallback(() => {
    watchSync.send({ type: "leave_session" });
    setParticipants([]);
    setSyncStatus("disconnected");
    // Navigate back without session param
    const ratingKey = location.pathname.split("/play/")[1];
    if (ratingKey) {
      navigate(`/play/${ratingKey}`, { replace: true });
    }
  }, [navigate, location.pathname]);

  const loadNextEpisode = useCallback(
    (ratingKey: string, title: string) => {
      if (!isInSession) return;

      // Send new_media to all participants
      watchSync.send({
        type: "new_media",
        media_rating_key: ratingKey,
        media_title: title,
        media_type: "episode",
      });

      // Navigate locally
      navigate(
        `/play/${ratingKey}?session=${sessionId}&host=${isHost}`,
        { replace: true }
      );

      setShowNextEpisodePrompt(false);
      setNextEpisodeInfo(null);
    },
    [isInSession, sessionId, isHost, navigate]
  );

  const dismissNextEpisodePrompt = useCallback(() => {
    setShowNextEpisodePrompt(false);
    setNextEpisodeInfo(null);
  }, []);

  return {
    isInSession,
    isHost,
    participants,
    syncStatus,
    sessionId,
    showNextEpisodePrompt,
    nextEpisodeInfo,
    syncTogglePlay,
    syncSeek,
    leaveSession,
    loadNextEpisode,
    dismissNextEpisodePrompt,
  };
}
