/**
 * Manages joining/leaving a Watch Together session and connection lifecycle.
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../useAuth";
import { watchSync } from "../../services/watch-sync";
import { getPlexUser } from "../../services/plex-api";

export type SyncStatus = "synced" | "syncing" | "disconnected";

export interface UseWatchTogetherSessionResult {
  isInSession: boolean;
  syncStatus: SyncStatus;
  setSyncStatus: (status: SyncStatus) => void;
  leaveSession: () => void;
}

export function useWatchTogetherSession(
  sessionId: string | null,
  isHost: boolean,
  relayUrl?: string | null
): UseWatchTogetherSessionResult {
  const navigate = useNavigate();
  const location = useLocation();
  const { authToken } = useAuth();

  const [syncStatus, setSyncStatus] = useState<SyncStatus>("disconnected");

  const isInSession = sessionId !== null;

  // Join session on mount (connect to relay if needed)
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
            const timeout = setTimeout(
              () => reject(new Error("Connection timeout")),
              5000
            );
            const unsub = watchSync.on("connected", () => {
              clearTimeout(timeout);
              unsub();
              resolve();
            });
          });
        } catch (err) {
          console.error(
            "[useWatchTogetherSession] Failed to connect via invite relay URL:",
            err
          );
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

  const leaveSession = useCallback(() => {
    watchSync.send({ type: "leave_session" });
    setSyncStatus("disconnected");
    // Navigate back without session param
    const ratingKey = location.pathname.split("/play/")[1];
    if (ratingKey) {
      navigate(`/play/${ratingKey}`, { replace: true });
    }
  }, [navigate, location.pathname]);

  return {
    isInSession,
    syncStatus,
    setSyncStatus,
    leaveSession,
  };
}
