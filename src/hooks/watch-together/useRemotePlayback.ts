/** Shared controls broadcast user intent, never loading/buffering transitions. */
import { useCallback, useEffect, useRef, useState } from "react";
import { watchSync, type PlaybackSnapshot } from "../../services/watch-sync";
import { useToast } from "../useToast";
import type { UsePlayerResult } from "../usePlayer";
import type { SyncStatus } from "./useWatchTogetherSession";

export function useRemotePlayback(
  player: UsePlayerResult,
  isInSession: boolean,
  setSyncStatus: (status: SyncStatus) => void,
  sessionId?: string | null,
) {
  const { toast } = useToast();
  const playerRef = useRef(player);
  playerRef.current = player;
  const remoteActionRef = useRef(false);
  const lastRemoteSyncRef = useRef<{ time: number; localTimestamp: number } | null>(null);
  const pendingSnapshot = useRef<PlaybackSnapshot | null>(null);
  const initialized = useRef(false);
  const phase = useRef<"lobby" | "playback" | null>(null);
  const [catchingUp, setCatchingUp] = useState(false);

  const applySnapshot = useCallback(() => {
    const snapshot = pendingSnapshot.current;
    const p = playerRef.current;
    if (!snapshot || p.isLoading || p.isBuffering || p.duration <= 0) return;
    const elapsed = snapshot.playing ? Math.max(0, (Date.now() - snapshot.timestamp) / 1000) : 0;
    const time = snapshot.current_time + elapsed;
    p.seek(time);
    if (p.isPlaying !== snapshot.playing) p.togglePlay();
    lastRemoteSyncRef.current = snapshot.playing ? { time, localTimestamp: Date.now() } : null;
    pendingSnapshot.current = null;
    initialized.current = true;
    setCatchingUp(false);
    setSyncStatus("synced");
  }, [setSyncStatus]);

  useEffect(() => {
    initialized.current = false;
    phase.current = null;
    pendingSnapshot.current = null;
    lastRemoteSyncRef.current = null;
    setCatchingUp(false);
    if (!isInSession) return;

    const subscriptions = [
      watchSync.on("session_state", (snapshot) => {
        if (sessionId && snapshot.session_id !== sessionId) return;
        const phaseChanged = phase.current !== snapshot.phase;
        phase.current = snapshot.phase;
        if (!initialized.current || pendingSnapshot.current || phaseChanged) {
          pendingSnapshot.current = snapshot;
          setCatchingUp(snapshot.phase === "playback");
          applySnapshot();
        }
      }),
      watchSync.on("remote_play", (data) => {
        const p = playerRef.current;
        const time = data.current_time + Math.max(0, Math.min((Date.now() - data.timestamp) / 1000, 2));
        p.seek(time);
        if (!p.isPlaying) p.togglePlay();
        lastRemoteSyncRef.current = { time, localTimestamp: Date.now() };
        toast(`${data.from_user} resumed playback`);
        setSyncStatus("synced");
      }),
      watchSync.on("remote_pause", (data) => {
        const p = playerRef.current;
        p.seek(data.current_time);
        if (p.isPlaying) p.togglePlay();
        lastRemoteSyncRef.current = null;
        toast(`${data.from_user} paused`);
        setSyncStatus("synced");
      }),
      watchSync.on("remote_seek", (data) => {
        const p = playerRef.current;
        const delay = p.isPlaying ? Math.max(0, Math.min((Date.now() - data.timestamp) / 1000, 2)) : 0;
        const time = data.current_time + delay;
        p.seek(time);
        lastRemoteSyncRef.current = p.isPlaying ? { time, localTimestamp: Date.now() } : null;
        toast(`${data.from_user} sought to ${Math.floor(data.current_time / 60)}:${Math.floor(data.current_time % 60).toString().padStart(2, "0")}`);
        setSyncStatus("synced");
      }),
    ];
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [isInSession, sessionId, applySnapshot, setSyncStatus, toast]);

  useEffect(() => { applySnapshot(); }, [player.isLoading, player.isBuffering, player.duration, applySnapshot]);

  useEffect(() => {
    if (!isInSession || player.isLoading || player.duration <= 0) return;
    watchSync.send({ type: player.isBuffering ? "buffering" : "ready", current_time: player.currentTime });
  }, [isInSession, player.isLoading, player.isBuffering, player.duration]);

  const { togglePlay, seek } = player;
  const syncTogglePlay = useCallback(() => {
    const p = playerRef.current;
    if (isInSession && (phase.current === "lobby" || pendingSnapshot.current)) return;
    togglePlay();
    if (isInSession) {
      watchSync.send({ type: p.isPlaying ? "pause" : "play", current_time: p.currentTime, timestamp: Date.now() });
      lastRemoteSyncRef.current = p.isPlaying ? null : { time: p.currentTime, localTimestamp: Date.now() };
    }
  }, [togglePlay, isInSession]);
  const syncSeek = useCallback((time: number) => {
    if (isInSession && (phase.current === "lobby" || pendingSnapshot.current)) return;
    seek(time);
    if (isInSession) {
      watchSync.send({ type: "seek", current_time: time, timestamp: Date.now() });
      lastRemoteSyncRef.current = playerRef.current.isPlaying ? { time, localTimestamp: Date.now() } : null;
    }
  }, [seek, isInSession]);

  return { syncTogglePlay, syncSeek, remoteActionRef, lastRemoteSyncRef, catchingUp: catchingUp || (isInSession && player.isBuffering) };
}
