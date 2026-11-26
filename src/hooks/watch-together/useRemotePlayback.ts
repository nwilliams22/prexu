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
  canReportReadiness = true,
  isHost = false,
) {
  const { toast } = useToast();
  const playerRef = useRef(player);
  playerRef.current = player;
  // Relay controls and their authoritative snapshot can arrive before the
  // engine reports the first command. Do not toggle twice against stale state.
  const commandedPlaying = useRef<boolean | null>(null);
  if (commandedPlaying.current === player.isPlaying) commandedPlaying.current = null;
  const ensurePlaying = useCallback((playing: boolean) => {
    const p = playerRef.current;
    if ((commandedPlaying.current ?? p.isPlaying) === playing) return;
    commandedPlaying.current = playing;
    p.togglePlay();
  }, []);
  const remoteActionRef = useRef(false);
  const lastRemoteSyncRef = useRef<{ time: number; localTimestamp: number } | null>(null);
  const pendingSnapshot = useRef<PlaybackSnapshot | null>(null);
  const initialized = useRef(false);
  const hostAway = useRef(false);
  const hostUsername = useRef<string | null>(null);
  const phase = useRef<"lobby" | "playback" | null>(null);
  const [catchingUp, setCatchingUp] = useState(false);

  const applySnapshot = useCallback(() => {
    const snapshot = pendingSnapshot.current;
    const p = playerRef.current;
    if (!snapshot || !p.isPrepared || p.isLoading || p.isBuffering || p.duration <= 0) return;
    const elapsed = snapshot.playing ? Math.max(0, (Date.now() - snapshot.timestamp) / 1000) : 0;
    const time = snapshot.current_time + elapsed;
    p.seek(time);
    ensurePlaying(snapshot.playing);
    lastRemoteSyncRef.current = snapshot.playing ? { time, localTimestamp: Date.now() } : null;
    pendingSnapshot.current = null;
    initialized.current = true;
    setCatchingUp(false);
    setSyncStatus("synced");
  }, [setSyncStatus, ensurePlaying]);

  useEffect(() => {
    initialized.current = false;
    phase.current = null;
    hostAway.current = false;
    hostUsername.current = null;
    pendingSnapshot.current = null;
    lastRemoteSyncRef.current = null;
    setCatchingUp(false);
    if (!isInSession) return;

    const subscriptions = [
      watchSync.on("disconnected", () => {
        ensurePlaying(false);
        initialized.current = false;
        pendingSnapshot.current = null;
        lastRemoteSyncRef.current = null;
        setSyncStatus("disconnected");
      }),
      watchSync.on("session_destroyed", () => {
        lastRemoteSyncRef.current = null;
        pendingSnapshot.current = null;
        ensurePlaying(false);
        toast("Session ended - host left");
      }),
      watchSync.on("session_state", (snapshot) => {
        if (sessionId && snapshot.session_id !== sessionId) return;
        hostUsername.current = snapshot.participants?.find((p) => p.is_host)?.plex_username ?? hostUsername.current;
        const phaseChanged = phase.current !== snapshot.phase;
        const hostChanged = hostAway.current !== snapshot.host_away;
        hostAway.current = snapshot.host_away;
        phase.current = snapshot.phase;
        if (snapshot.host_away) {
          lastRemoteSyncRef.current = null;
          pendingSnapshot.current = null;
          setCatchingUp(false);
          ensurePlaying(false);
          return;
        }
        if (!initialized.current || pendingSnapshot.current || phaseChanged || hostChanged) {
          pendingSnapshot.current = snapshot;
          setCatchingUp(snapshot.phase === "playback");
          applySnapshot();
        }
      }),
      watchSync.on("remote_ready", (data) => {
        if (isHost || hostAway.current || data.from_user !== hostUsername.current || !playerRef.current.isPlaying) return;
        lastRemoteSyncRef.current = { time: data.current_time, localTimestamp: Date.now() };
      }),
      watchSync.on("remote_play", (data) => {
        const p = playerRef.current;
        const time = data.current_time + Math.max(0, Math.min((Date.now() - data.timestamp) / 1000, 2));
        p.seek(time);
        ensurePlaying(true);
        lastRemoteSyncRef.current = { time, localTimestamp: Date.now() };
        toast(`${data.from_user} resumed playback`);
        setSyncStatus("synced");
      }),
      watchSync.on("remote_pause", (data) => {
        const p = playerRef.current;
        p.seek(data.current_time);
        ensurePlaying(false);
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
  }, [isInSession, sessionId, applySnapshot, setSyncStatus, toast, isHost, ensurePlaying]);

  useEffect(() => { applySnapshot(); }, [player.isPrepared, player.isLoading, player.isBuffering, player.duration, applySnapshot]);

  useEffect(() => {
    if (!isInSession || !canReportReadiness || !player.isPrepared || player.isLoading || player.duration <= 0) return;
    watchSync.send({ type: player.isBuffering ? "buffering" : "ready", current_time: player.currentTime });
  }, [isInSession, canReportReadiness, player.isPrepared, player.isLoading, player.isBuffering, player.duration]);

  // Reuse the host's readiness position as a clock sample. A viewer never
  // publishes automatic corrections, and guest samples cannot move this clock.
  useEffect(() => {
    if (!isInSession || !isHost || !canReportReadiness) return;
    const timer = setInterval(() => {
      const p = playerRef.current;
      if (phase.current !== "playback" || hostAway.current || !p.isPlaying || !p.isPrepared || p.isLoading || p.isBuffering) return;
      watchSync.send({ type: "ready", current_time: p.currentTime });
    }, 2000);
    return () => clearInterval(timer);
  }, [isInSession, isHost, canReportReadiness]);

  const { togglePlay, seek } = player;
  const syncTogglePlay = useCallback(() => {
    const p = playerRef.current;
    if (isInSession && (!canReportReadiness || phase.current === "lobby" || hostAway.current || pendingSnapshot.current)) return;
    commandedPlaying.current = null;
    togglePlay();
    if (isInSession) {
      watchSync.send({ type: p.isPlaying ? "pause" : "play", current_time: p.currentTime, timestamp: Date.now() });
      lastRemoteSyncRef.current = p.isPlaying ? null : { time: p.currentTime, localTimestamp: Date.now() };
    }
  }, [togglePlay, isInSession, canReportReadiness]);
  const syncSeek = useCallback((time: number) => {
    if (isInSession && (!canReportReadiness || phase.current === "lobby" || hostAway.current || pendingSnapshot.current)) return;
    seek(time);
    if (isInSession) {
      watchSync.send({ type: "seek", current_time: time, timestamp: Date.now() });
      lastRemoteSyncRef.current = playerRef.current.isPlaying ? { time, localTimestamp: Date.now() } : null;
    }
  }, [seek, isInSession, canReportReadiness]);

  return { syncTogglePlay, syncSeek, remoteActionRef, lastRemoteSyncRef, catchingUp: catchingUp || (isInSession && player.isBuffering) };
}
