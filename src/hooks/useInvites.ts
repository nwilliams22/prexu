import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { watchSync } from "../services/watch-sync";
import { getPlexUser } from "../services/plex-api";
import { getRelayUrl } from "../services/storage";
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
export function useInviteState(authToken: string | null): InviteContextValue {
  const [invites, setInvites] = useState<WatchInvite[]>([]);
  const [isRelayConnected, setIsRelayConnected] = useState(false);

  const connectToRelay = useCallback(async () => {
    if (!authToken) return;

    try {
      const [user, relayUrl] = await Promise.all([
        getPlexUser(authToken),
        getRelayUrl(),
      ]);

      watchSync.connect(relayUrl, user.username, user.thumb);
    } catch (err) {
      console.error("[useInvites] Failed to connect to relay:", err);
    }
  }, [authToken]);

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
      (data: Record<string, unknown>) => {
        const invite: WatchInvite = {
          sessionId: data.session_id as string,
          mediaTitle: data.media_title as string,
          mediaRatingKey: data.media_rating_key as string,
          mediaType: data.media_type as string,
          senderUsername: data.sender_username as string,
          senderThumb: data.sender_thumb as string,
          sentAt: data.sent_at as number,
        };
        setInvites((prev) => {
          // Avoid duplicate invites for same session
          if (prev.some((i) => i.sessionId === invite.sessionId)) return prev;
          return [...prev, invite];
        });
      }
    );

    const unsubPendingInvites = watchSync.on(
      "pending_invites",
      (data: { invites: Record<string, unknown>[] }) => {
        const parsed: WatchInvite[] = (data.invites ?? []).map(
          (inv: Record<string, unknown>) => ({
            sessionId: inv.session_id as string,
            mediaTitle: inv.media_title as string,
            mediaRatingKey: inv.media_rating_key as string,
            mediaType: inv.media_type as string,
            senderUsername: inv.sender_username as string,
            senderThumb: inv.sender_thumb as string,
            sentAt: inv.sent_at as number,
          })
        );
        setInvites((prev) => {
          const existingIds = new Set(prev.map((i) => i.sessionId));
          const newInvites = parsed.filter(
            (i) => !existingIds.has(i.sessionId)
          );
          return newInvites.length > 0 ? [...prev, ...newInvites] : prev;
        });
      }
    );

    return () => {
      unsubConnected();
      unsubDisconnected();
      unsubInviteReceived();
      unsubPendingInvites();
    };
  }, []);

  return {
    invites,
    isRelayConnected,
    connectToRelay,
    dismissInvite,
    refreshInvites,
  };
}
