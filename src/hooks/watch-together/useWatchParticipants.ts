/**
 * Manages the participant list for a Watch Together session.
 */

import { useState, useEffect } from "react";
import { watchSync } from "../../services/watch-sync";
import type { WatchParticipant } from "../../types/watch-together";
import type { SyncStatus } from "./useWatchTogetherSession";

export interface UseWatchParticipantsResult {
  participants: WatchParticipant[];
  setParticipants: React.Dispatch<React.SetStateAction<WatchParticipant[]>>;
}

export function useWatchParticipants(
  isInSession: boolean,
  sessionId: string | null,
  setSyncStatus: (status: SyncStatus) => void
): UseWatchParticipantsResult {
  const [participants, setParticipants] = useState<WatchParticipant[]>([]);

  useEffect(() => {
    if (!isInSession) return;

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
      unsubParticipantJoined();
      unsubParticipantLeft();
      unsubSessionJoined();
      unsubSessionDestroyed();
      unsubBuffering();
      unsubReady();
      unsubDisconnected();
      unsubConnected();
    };
  }, [isInSession, sessionId, setSyncStatus]);

  return {
    participants,
    setParticipants,
  };
}
