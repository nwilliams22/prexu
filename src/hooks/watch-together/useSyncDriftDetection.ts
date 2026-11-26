/**
 * Detects and corrects playback drift between participants.
 */

import { useEffect, useRef, useState } from "react";
import type { UsePlayerResult } from "../usePlayer";
import type { SyncStatus } from "./useWatchTogetherSession";

export function useSyncDriftDetection(
  player: UsePlayerResult,
  isInSession: boolean,
  setSyncStatus: (status: SyncStatus) => void,
  remoteActionRef: React.MutableRefObject<boolean>,
  lastRemoteSyncRef: React.MutableRefObject<{
    time: number;
    localTimestamp: number;
  } | null>,
  isHost = false,
): { resyncing: boolean; struggling: boolean } {
  const [resyncing, setResyncing] = useState(false);
  const [struggling, setStruggling] = useState(false);
  const corrections = useRef<number[]>([]);
  // Use refs so the interval callback always reads the latest values without
  // needing them in the effect dependency array. playerRef also lets us drift-
  // correct via player.seek() which works on both HTML5 (videoRef populated)
  // and native libmpv (videoRef is null on Windows) — touching videoRef.current
  // directly silently failed on native.
  const currentTimeRef = useRef(player.currentTime);
  currentTimeRef.current = player.currentTime;
  const playerRef = useRef(player);
  playerRef.current = player;

  useEffect(() => {
    setResyncing(false);
    setStruggling(false);
    corrections.current = [];
    if (!isInSession || isHost) return;
    let badgeTimer: ReturnType<typeof setTimeout> | undefined;

    const driftCheck = setInterval(() => {
      const p = playerRef.current;
      if (!p.isPlaying || p.isLoading || p.isBuffering) return;
      const sync = lastRemoteSyncRef.current;
      if (!sync) return;

      const expectedTime =
        sync.time + (Date.now() - sync.localTimestamp) / 1000;
      const drift = Math.abs(currentTimeRef.current - expectedTime);

      if (drift > 2) {
        remoteActionRef.current = true;
        playerRef.current.seek(expectedTime);
        const now = Date.now();
        corrections.current = corrections.current.filter((time) => now - time < 30000);
        corrections.current.push(now);
        setStruggling(corrections.current.length >= 3);
        setResyncing(true);
        clearTimeout(badgeTimer);
        badgeTimer = setTimeout(() => setResyncing(false), 1500);
      } else {
        corrections.current = corrections.current.filter((time) => Date.now() - time < 30000);
        setStruggling(corrections.current.length >= 3);
      }
    }, 2000);

    return () => { clearInterval(driftCheck); clearTimeout(badgeTimer); };
  }, [
    isInSession,
    isHost,
    setSyncStatus,
    remoteActionRef,
    lastRemoteSyncRef,
  ]);
  return { resyncing, struggling };
}
