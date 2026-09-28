/**
 * Manages joining/leaving a Watch Together session and connection lifecycle.
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../useAuth";
import { watchSync } from "../../services/watch-sync";
import { getPlexUser } from "../../services/plex-api";
import { logger } from "../../services/logger";

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

          // A socket open is not usable until the relay accepts auth.
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              clearTimeout(timeout);
              unsubAuth();
              unsubError();
            };
            const timeout = setTimeout(() => {
              cleanup();
              reject(new Error("Authentication timeout"));
            }, 5000);
            const unsubAuth = watchSync.on("auth_ok", () => {
              cleanup();
              resolve();
            });
            const unsubError = watchSync.on("auth_error", (data) => {
              cleanup();
              reject(new Error(data.reason));
            });
            if (watchSync.isConnected) {
              cleanup();
              resolve();
            }
          });
        } catch {
          void logger.error(
            "watch:session",
            "failed to authenticate with invite relay"
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
