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
  // Use a ref so the interval callback always reads the latest currentTime
  // without needing it in the effect dependency array.
  const currentTimeRef = useRef(player.currentTime);
  currentTimeRef.current = player.currentTime;

  useEffect(() => {
    if (!isInSession || !player.isPlaying) return;

    const driftCheck = setInterval(() => {
      const sync = lastRemoteSyncRef.current;
      if (!sync) return;

      const expectedTime =
        sync.time + (Date.now() - sync.localTimestamp) / 1000;
      const drift = Math.abs(currentTimeRef.current - expectedTime);

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
  }, [
    isInSession,
    player.isPlaying,
    player.videoRef,
    setSyncStatus,
    remoteActionRef,
    lastRemoteSyncRef,
  ]);
}
