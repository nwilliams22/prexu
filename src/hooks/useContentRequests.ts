/**
 * Context-based hook for content request state management.
 * Mirrors the useInvites pattern — provides a context + state hook.
 *
 * Admin users receive requests via the relay and manage them.
 * Non-admin users submit requests via the relay and track their own.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { watchSync } from "../services/watch-sync";
import {
  getContentRequests,
  saveContentRequests,
  getRequestsLastRead,
  saveRequestsLastRead,
} from "../services/storage";
import { playNotificationSound } from "../utils/notificationSound";
import type { ActiveUser } from "../types/home-user";
import type {
  ContentRequest,
  RequestMediaType,
  ContentRequestMessage,
  ContentRequestResponseMessage,
} from "../types/content-request";

// ── Context ──

export interface ContentRequestContextValue {
  /** All requests visible to the current user */
  requests: ContentRequest[];
  /** Number of unread requests (admin only) */
  unreadCount: number;
  /** Whether the relay is connected (needed for sending requests) */
  isRelayConnected: boolean;

  /** Submit a new content request (non-admin → admin via relay) */
  submitRequest: (params: {
    tmdbId: number;
    imdbId?: string;
    mediaType: RequestMediaType;
    title: string;
    year: string;
    posterPath: string | null;
    overview: string;
    targetServerName?: string;
    targetServerId?: string;
  }) => void;

  /** Respond to a pending request (admin only) */
  respondToRequest: (
    requestId: string,
    status: "approved" | "declined",
    note?: string,
  ) => void;

  /** Remove a request from the list */
  dismissRequest: (requestId: string) => void;

  /** Mark all requests as read (resets unread badge) */
  markAllRead: () => void;
}

const ContentRequestContext = createContext<ContentRequestContextValue | null>(
  null,
);

export const ContentRequestProvider = ContentRequestContext.Provider;

export function useContentRequests(): ContentRequestContextValue {
  const ctx = useContext(ContentRequestContext);
  if (!ctx) {
    throw new Error(
      "useContentRequests must be used within ContentRequestProvider",
    );
  }
  return ctx;
}

// ── State hook ──

export function useContentRequestState(
  _authToken: string | null,
  activeUser: ActiveUser | null,
): ContentRequestContextValue {
  const [requests, setRequests] = useState<ContentRequest[]>([]);
  const [lastRead, setLastRead] = useState(0);
  const [isRelayConnected, setIsRelayConnected] = useState(false);
  const initializedRef = useRef(false);

  const isAdmin = activeUser?.isAdmin ?? false;

  // Load persisted requests on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    (async () => {
      const stored = await getContentRequests();
      if (stored.length > 0) setRequests(stored);
      const ts = await getRequestsLastRead();
      setLastRead(ts);
    })();
  }, []);

  // Persist requests whenever they change
  useEffect(() => {
    if (!initializedRef.current) return;
    saveContentRequests(requests);
  }, [requests]);

  // Compute unread count (admin only — requests after lastRead timestamp)
  const unreadCount = isAdmin
    ? requests.filter(
        (r) => r.status === "pending" && r.requestedAt > lastRead,
      ).length
    : 0;

  // ── Actions ──

  const submitRequest = useCallback(
    (params: {
      tmdbId: number;
      imdbId?: string;
      mediaType: RequestMediaType;
      title: string;
      year: string;
      posterPath: string | null;
      overview: string;
      targetServerName?: string;
      targetServerId?: string;
    }) => {
      if (!activeUser) return;

      const requestId = crypto.randomUUID();
      const now = Date.now();

      // Send via relay
      const message: ContentRequestMessage = {
        type: "content_request",
        request_id: requestId,
        tmdb_id: params.tmdbId,
        imdb_id: params.imdbId,
        media_type: params.mediaType,
        title: params.title,
        year: params.year,
        poster_path: params.posterPath,
        overview: params.overview,
        requester_username: activeUser.title || activeUser.username,
        requester_thumb: activeUser.thumb,
        requested_at: now,
        target_server_name: params.targetServerName,
        target_server_id: params.targetServerId,
      };
      watchSync.send(message as unknown as Record<string, unknown>);

      // Also store locally so the requester can see their own request
      const localRequest: ContentRequest = {
        requestId,
        tmdbId: params.tmdbId,
        imdbId: params.imdbId,
        mediaType: params.mediaType,
        title: params.title,
        year: params.year,
        posterPath: params.posterPath,
        overview: params.overview,
        requesterUsername: activeUser.title || activeUser.username,
        requesterThumb: activeUser.thumb,
        status: "pending",
        requestedAt: now,
        targetServerName: params.targetServerName,
        targetServerId: params.targetServerId,
      };

      setRequests((prev) => [localRequest, ...prev]);
    },
    [activeUser],
  );

  const respondToRequest = useCallback(
    (requestId: string, status: "approved" | "declined", note?: string) => {
      // Update local state
      setRequests((prev) =>
        prev.map((r) =>
          r.requestId === requestId
            ? { ...r, status, respondedAt: Date.now(), adminNote: note }
            : r,
        ),
      );

      // Send response via relay so the requester gets notified
      const message: ContentRequestResponseMessage = {
        type: "content_request_response",
        request_id: requestId,
        status,
        admin_note: note,
      };
      watchSync.send(message as unknown as Record<string, unknown>);
    },
    [],
  );

  const dismissRequest = useCallback((requestId: string) => {
    setRequests((prev) => prev.filter((r) => r.requestId !== requestId));
  }, []);

  const markAllRead = useCallback(() => {
    const now = Date.now();
    setLastRead(now);
    saveRequestsLastRead(now);
  }, []);

  // ── Relay event subscriptions ──

  useEffect(() => {
    // Track relay connection state
    const unsubConnected = watchSync.on("connected", () => {
      setIsRelayConnected(true);
    });
    const unsubDisconnected = watchSync.on("disconnected", () => {
      setIsRelayConnected(false);
    });

    // Admin: receive incoming content requests
    const unsubRequestReceived = watchSync.on(
      "content_request_received",
      (data: Record<string, unknown>) => {
        const request: ContentRequest = {
          requestId: data.request_id as string,
          tmdbId: data.tmdb_id as number,
          imdbId: data.imdb_id as string | undefined,
          mediaType: data.media_type as RequestMediaType,
          title: data.title as string,
          year: data.year as string,
          posterPath: data.poster_path as string | null,
          overview: data.overview as string,
          requesterUsername: data.requester_username as string,
          requesterThumb: data.requester_thumb as string,
          status: "pending",
          requestedAt: data.requested_at as number,
        };

        setRequests((prev) => {
          // Avoid duplicates
          if (prev.some((r) => r.requestId === request.requestId)) return prev;
          playNotificationSound();
          return [request, ...prev];
        });
      },
    );

    // Admin: receive buffered pending requests on connect
    const unsubPendingRequests = watchSync.on(
      "pending_content_requests",
      (data: { requests: Record<string, unknown>[] }) => {
        const parsed: ContentRequest[] = (data.requests ?? []).map(
          (req: Record<string, unknown>) => ({
            requestId: req.request_id as string,
            tmdbId: req.tmdb_id as number,
            imdbId: req.imdb_id as string | undefined,
            mediaType: req.media_type as RequestMediaType,
            title: req.title as string,
            year: req.year as string,
            posterPath: req.poster_path as string | null,
            overview: req.overview as string,
            requesterUsername: req.requester_username as string,
            requesterThumb: req.requester_thumb as string,
            status: "pending" as const,
            requestedAt: req.requested_at as number,
          }),
        );

        setRequests((prev) => {
          const existingIds = new Set(prev.map((r) => r.requestId));
          const newRequests = parsed.filter(
            (r) => !existingIds.has(r.requestId),
          );
          if (newRequests.length > 0) {
            playNotificationSound();
            return [...newRequests, ...prev];
          }
          return prev;
        });
      },
    );

    // Non-admin: receive response to their request
    const unsubResponse = watchSync.on(
      "content_request_response",
      (data: Record<string, unknown>) => {
        const requestId = data.request_id as string;
        const status = data.status as "approved" | "declined";
        const adminNote = data.admin_note as string | undefined;

        setRequests((prev) =>
          prev.map((r) =>
            r.requestId === requestId
              ? { ...r, status, respondedAt: Date.now(), adminNote }
              : r,
          ),
        );
      },
    );

    return () => {
      unsubConnected();
      unsubDisconnected();
      unsubRequestReceived();
      unsubPendingRequests();
      unsubResponse();
    };
  }, []);

  return {
    requests,
    unreadCount,
    isRelayConnected,
    submitRequest,
    respondToRequest,
    dismissRequest,
    markAllRead,
  };
}
