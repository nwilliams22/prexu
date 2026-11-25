/**
 * Manages joining/leaving a Watch Together session and connection lifecycle.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../useAuth";
import { watchSync } from "../../services/watch-sync";
import { getPlexUser } from "../../services/plex-api";
import type { WatchLobbySnapshot } from "../../types/watch-together";
import { logger } from "../../services/logger";

export type SyncStatus = "synced" | "syncing" | "disconnected";

export interface UseWatchTogetherSessionResult {
  isInSession: boolean;
  lobby: WatchLobbySnapshot | null;
  sessionError: string | null;
  sessionEnded: boolean;
  startNow: () => void;
  resendInvite: (username: string) => void;
  removeParticipant: (username: string) => void;
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

  const [lobby, setLobby] = useState<WatchLobbySnapshot | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const username = useRef<string | null>(null);

  useEffect(() => {
    setLobby(null);
    setSessionError(null);
    setSessionEnded(false);
    if (!sessionId) return;
    let cancelled = false;
    if (authToken) void getPlexUser(authToken).then((user) => {
      if (!cancelled) username.current = user.username;
    }).catch(() => {});
    const unsubscribers = [
      watchSync.on("auth_ok", (data) => {
        username.current = data.plex_username;
        watchSync.send({ type: "join_session", session_id: sessionId });
      }),
      watchSync.on("disconnected", () => setSyncStatus("disconnected")),
      watchSync.on("session_state", (data) => {
        if (data.session_id !== sessionId) return;
        setSyncStatus("synced");
        setSessionError(null);
        setLobby({
          sessionId, phase: data.phase, hostAway: data.host_away,
          mediaTitle: data.media_title ?? "Watch Together",
          mediaRatingKey: data.media_rating_key ?? "",
          mediaType: data.media_type ?? "movie",
          participants: (data.participants ?? []).map((p) => ({
            plexUsername: p.plex_username, plexThumb: p.plex_thumb,
            isHost: p.is_host, state: p.state,
          })),
        });
      }),
      watchSync.on("session_error", (data) => setSessionError(data.reason)),
      watchSync.on("session_destroyed", () => setSessionEnded(true)),
      watchSync.on("participant_removed", (data) => {
        if (data.plex_username === username.current) setSessionEnded(true);
      }),
    ];
    return () => { cancelled = true; unsubscribers.forEach((unsubscribe) => unsubscribe()); };
  }, [sessionId, authToken]);

  const canManage = isHost && watchSync.isConnected && !!lobby && !lobby.hostAway;
  const startNow = () => { if (canManage) watchSync.send({ type: "start_now" }); };
  const resendInvite = (target: string) => {
    if (canManage) watchSync.send({ type: "invite", session_id: sessionId, target_username: target });
  };
  const removeParticipant = (target: string) => {
    if (canManage) watchSync.send({ type: "remove_participant", plex_username: target });
  };

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

      // v2 duplicate joins return the current snapshot for the creator too.
      watchSync.send({ type: "join_session", session_id: sessionId });

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
    lobby, sessionError, sessionEnded, startNow, resendInvite, removeParticipant,
    syncStatus,
    setSyncStatus,
    leaveSession,
  };
}
