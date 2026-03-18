/**
 * Watch Together orchestrator hook.
 * Composes focused sub-hooks and exposes a single public API.
 */

import { useWatchTogetherSession } from "./useWatchTogetherSession";
import { useRemotePlayback } from "./useRemotePlayback";
import { useWatchParticipants } from "./useWatchParticipants";
import { useSyncDriftDetection } from "./useSyncDriftDetection";
import { useRemoteMediaSwitch } from "./useRemoteMediaSwitch";
import type { UsePlayerResult } from "../usePlayer";
import type { UseWatchTogetherResult } from "../useWatchTogether";

export function useWatchTogether(
  player: UsePlayerResult,
  sessionId: string | null,
  isHost: boolean,
  relayUrl?: string | null
): UseWatchTogetherResult {
  const session = useWatchTogetherSession(sessionId, isHost, relayUrl);

  const playback = useRemotePlayback(
    player,
    session.isInSession,
    session.setSyncStatus
  );

  const { participants, setParticipants } = useWatchParticipants(
    session.isInSession,
    sessionId,
    session.setSyncStatus
  );

  useSyncDriftDetection(
    player,
    session.isInSession,
    session.setSyncStatus,
    playback.remoteActionRef,
    playback.lastRemoteSyncRef
  );

  const mediaSwitch = useRemoteMediaSwitch(
    player,
    session.isInSession,
    isHost,
    sessionId
  );

  // Wire leaveSession to also clear participants
  const leaveSession = () => {
    setParticipants([]);
    session.leaveSession();
  };

  return {
    isInSession: session.isInSession,
    isHost,
    participants,
    syncStatus: session.syncStatus,
    sessionId,
    showNextEpisodePrompt: mediaSwitch.showNextEpisodePrompt,
    nextEpisodeInfo: mediaSwitch.nextEpisodeInfo,
    syncTogglePlay: playback.syncTogglePlay,
    syncSeek: playback.syncSeek,
    leaveSession,
    loadNextEpisode: mediaSwitch.loadNextEpisode,
    dismissNextEpisodePrompt: mediaSwitch.dismissNextEpisodePrompt,
  };
}
