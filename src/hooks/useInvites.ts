import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { parseInvite, watchSync } from "../services/watch-sync";
import { getPlexUser } from "../services/plex-api";
import { getRelayUrl } from "../services/storage";
import { playNotificationSound } from "../utils/notificationSound";
import { logger } from "../services/logger";
import { inviteTimeLeft } from "../services/watch-invites";
import type { WatchInvite } from "../types/watch-together";

export interface InviteContextValue {
  invites: WatchInvite[];
  isRelayConnected: boolean;
  connectToRelay: () => void;
  dismissInvite: (sessionId: string) => void;
  refreshInvites: () => void;
}

const InviteContext = createContext<InviteContextValue | null>(null);

export const InviteProvider = InviteContext.Provider;

export function useInvites(): InviteContextValue {
  const ctx = useContext(InviteContext);
  if (!ctx) {
    throw new Error("useInvites must be used within InviteProvider");
  }
  return ctx;
}

/**
 * Manages relay connection and invite state at the app level.
 * Returns a value suitable for InviteProvider.
 */
export function useInviteState(
  authToken: string | null,
  serverUri: string | null = null
): InviteContextValue {
  const [invites, setInvites] = useState<WatchInvite[]>([]);
  const [isRelayConnected, setIsRelayConnected] = useState(false);

  const connectToRelay = useCallback(async () => {
    if (!authToken) return;

    try {
      const [user, relayUrl] = await Promise.all([
        getPlexUser(authToken),
        getRelayUrl(serverUri),
      ]);

      watchSync.connect(relayUrl, authToken, user.username, user.thumb);
    } catch {
      void logger.error("watch:invite", "failed to connect to relay");
    }
  }, [authToken, serverUri]);

  const dismissInvite = useCallback((sessionId: string) => {
    setInvites((prev) => prev.filter((inv) => inv.sessionId !== sessionId));
  }, []);

  const refreshInvites = useCallback(() => {
    watchSync.disconnect();
    // Small delay to let the disconnect complete
    setTimeout(() => {
      connectToRelay();
    }, 500);
  }, [connectToRelay]);

  // Expire all pending invites, including ones whose popup is not visible.
  useEffect(() => {
    const timer = setInterval(() => setInvites((previous) => {
      const live = previous.filter((invite) => inviteTimeLeft(invite.sentAt) > 0);
      return live.length === previous.length ? previous : live;
    }), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { setInvites([]); }, [authToken]);

  // Connect to relay on mount when authenticated
  useEffect(() => {
    if (!authToken) return;
    connectToRelay();
    return () => {
      watchSync.disconnect();
    };
  }, [authToken, connectToRelay]);

  // Subscribe to relay events
  useEffect(() => {
    const unsubConnected = watchSync.on("connected", () => {
      setIsRelayConnected(true);
    });

    const unsubDisconnected = watchSync.on("disconnected", () => {
      setIsRelayConnected(false);
    });

    const unsubInviteReceived = watchSync.on(
      "invite_received",
      (data) => {
        const invite = parseInvite(data);
        if (inviteTimeLeft(invite.sentAt) === 0) return;
        setInvites((prev) => {
          // Avoid duplicate invites for same session
          if (prev.some((i) => i.sessionId === invite.sessionId)) return prev;
          playNotificationSound();
          return [...prev, invite];
        });
      }
    );

    const unsubRevoked = watchSync.on("invite_revoked", (data) => {
      setInvites((prev) => prev.filter((invite) => invite.sessionId !== data.session_id));
    });

    const unsubPendingInvites = watchSync.on(
      "pending_invites",
      (data) => {
        const parsed: WatchInvite[] = (data.invites ?? []).map(parseInvite).filter((invite: WatchInvite) => inviteTimeLeft(invite.sentAt) > 0);
        setInvites((prev) => {
          const existingIds = new Set(prev.map((i) => i.sessionId));
          const newInvites = parsed.filter(
            (i) => !existingIds.has(i.sessionId)
          );
          if (newInvites.length > 0) {
            playNotificationSound();
            return [...prev, ...newInvites];
          }
          return prev;
        });
      }
    );

    return () => {
      unsubConnected();
      unsubDisconnected();
      unsubInviteReceived();
      unsubRevoked();
      unsubPendingInvites();
    };
  }, []);

  // Memoize so AppProviders' high-frequency re-renders don't hand a new
  // object to every Invite consumer. Identity changes only when invite state
  // changes (callbacks are stable via useCallback).
  return useMemo(
    () => ({
      invites,
      isRelayConnected,
      connectToRelay,
      dismissInvite,
      refreshInvites,
    }),
    [invites, isRelayConnected, connectToRelay, dismissInvite, refreshInvites],
  );
}
