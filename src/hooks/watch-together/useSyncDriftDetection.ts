/**
 * Detects and corrects playback drift between participants.
 */

import { useEffect, useRef } from "react";
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
  } | null>
): void {
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
    if (!isInSession || !player.isPlaying) return;

    const driftCheck = setInterval(() => {
      const sync = lastRemoteSyncRef.current;
      if (!sync) return;

      const expectedTime =
        sync.time + (Date.now() - sync.localTimestamp) / 1000;
      const drift = Math.abs(currentTimeRef.current - expectedTime);

      if (drift > 2) {
        remoteActionRef.current = true;
        playerRef.current.seek(expectedTime);
        setSyncStatus("syncing");
        setTimeout(() => setSyncStatus("synced"), 500);
      }
    }, 2000);

    return () => clearInterval(driftCheck);
  }, [
    isInSession,
    player.isPlaying,
    setSyncStatus,
    remoteActionRef,
    lastRemoteSyncRef,
  ]);
}
