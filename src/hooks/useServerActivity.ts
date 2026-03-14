/**
 * Server activity context — connects to the Plex server's WebSocket
 * notification endpoint for real-time activity, session, and library
 * updates.  Falls back to REST polling when the WebSocket is unavailable.
 *
 * Real-time (WebSocket):
 *  - Activity started/updated → upsert in activities list, show spinner
 *  - Activity ended → remove from list, increment completionCounter
 *  - Timeline change → debounced completionCounter increment (library updated)
 *  - Playing state change → re-fetch sessions
 *
 * Fallback (polling):
 *  - Every 30 s fetch /activities + /status/sessions
 *
 * Exposes a `completionCounter` that increments whenever an activity
 * finishes or library content changes, so the dashboard auto-refreshes.
 */

import { createContext, useContext, useState, useEffect, useRef } from "react";
import { useAuth } from "./useAuth";
import { logger } from "../services/logger";
import {
  getActivities,
  getActiveSessions,
  getNotificationUrl,
  toArray,
  type PlexActivity,
  type PlexSession,
  type PlexActivityNotification,
  type PlexNotificationContainer,
} from "../services/plex-activity";

// ── Public interface ──

export interface ServerActivityValue {
  /** Current running activities (scans, metadata updates, etc.) */
  activities: PlexActivity[];
  /** Current playback sessions */
  sessions: PlexSession[];
  /** Whether any activity is currently running */
  isActive: boolean;
  /** Increments whenever an activity finishes — use as a refresh trigger */
  completionCounter: number;
}

const defaultValue: ServerActivityValue = {
  activities: [],
  sessions: [],
  isActive: false,
  completionCounter: 0,
};

const ServerActivityContext = createContext<ServerActivityValue>(defaultValue);

export function useServerActivity(): ServerActivityValue {
  return useContext(ServerActivityContext);
}

// ── Provider hook ──

const POLL_FALLBACK_INTERVAL = 30_000; // 30 s — only used when WebSocket is down
const WS_RECONNECT_DELAY = 5_000;
const TIMELINE_DEBOUNCE_MS = 1_000; // debounce rapid timeline notifications

export function useServerActivityState(): ServerActivityValue {
  const { server } = useAuth();
  const [activities, setActivities] = useState<PlexActivity[]>([]);
  const [sessions, setSessions] = useState<PlexSession[]>([]);
  const [completionCounter, setCompletionCounter] = useState(0);

  const mountedRef = useRef(true);

  // ── WebSocket for real-time notifications ──

  useEffect(() => {
    if (!server) return;
    mountedRef.current = true;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let timelineDebounce: ReturnType<typeof setTimeout> | null = null;
    let sessionDebounce: ReturnType<typeof setTimeout> | null = null;
    let intentionalClose = false;

    function connect() {
      if (!mountedRef.current) return;

      const url = getNotificationUrl(server!.uri, server!.accessToken);
      ws = new WebSocket(url);

      ws.onopen = () => {
        logger.info("activity", "WebSocket connected to Plex notifications");
        // Immediately fetch current state on connect
        fetchAll();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string);
          const container = data?.NotificationContainer as
            | PlexNotificationContainer
            | undefined;
          if (!container) return;

          handleNotification(container);
        } catch (err) {
          logger.warn("activity", "WebSocket message parse error", err);
        }
      };

      ws.onclose = () => {
        if (!intentionalClose && mountedRef.current) {
          logger.info("activity", "WebSocket closed — reconnecting in 5 s");
          reconnectTimer = setTimeout(connect, WS_RECONNECT_DELAY);
        }
      };

      ws.onerror = () => {
        // onerror is always followed by onclose, reconnection happens there
      };
    }

    function handleNotification(container: PlexNotificationContainer) {
      if (!mountedRef.current) return;

      switch (container.type) {
        case "activity": {
          const notifications = toArray<PlexActivityNotification>(
            container.ActivityNotification,
          );
          for (const notif of notifications) {
            if (notif.event === "ended") {
              // Remove finished activity and trigger dashboard refresh
              setActivities((prev) =>
                prev.filter((a) => a.uuid !== notif.uuid),
              );
              setCompletionCounter((c) => c + 1);
            } else {
              // started or updated — upsert the activity
              const activity = notif.Activity;

              // Treat 100% as completed — Plex sometimes never sends "ended"
              if (activity.progress >= 100) {
                setActivities((prev) =>
                  prev.filter((a) => a.uuid !== activity.uuid),
                );
                setCompletionCounter((c) => c + 1);
              } else {
                setActivities((prev) => {
                  const idx = prev.findIndex(
                    (a) => a.uuid === activity.uuid,
                  );
                  if (idx >= 0) {
                    const updated = [...prev];
                    updated[idx] = activity;
                    return updated;
                  }
                  return [...prev, activity];
                });
              }
            }
          }
          break;
        }

        case "timeline": {
          // Library content changed (new items added/removed/updated).
          // Debounce because scans emit many timeline events rapidly.
          if (timelineDebounce) clearTimeout(timelineDebounce);
          timelineDebounce = setTimeout(() => {
            if (mountedRef.current) {
              setCompletionCounter((c) => c + 1);
            }
          }, TIMELINE_DEBOUNCE_MS);
          break;
        }

        case "playing": {
          // Playback state changed — debounced session refetch
          if (sessionDebounce) clearTimeout(sessionDebounce);
          sessionDebounce = setTimeout(() => {
            if (mountedRef.current && server) {
              getActiveSessions(server.uri, server.accessToken).then(
                (sess) => {
                  if (mountedRef.current) setSessions(sess);
                },
              );
            }
          }, 500);
          break;
        }
      }
    }

    /** Fetch the full activity + session state (used on connect and as fallback). */
    async function fetchAll() {
      if (!server || !mountedRef.current) return;
      try {
        const [acts, sess] = await Promise.all([
          getActivities(server.uri, server.accessToken),
          getActiveSessions(server.uri, server.accessToken),
        ]);
        if (mountedRef.current) {
          // Filter out activities at 100% — Plex can return stale completed tasks
          setActivities(acts.filter((a) => a.progress < 100));
          setSessions(sess);
        }
      } catch (err) {
        logger.warn("activity", "fetchAll error", err);
      }
    }

    // Start WebSocket connection
    connect();

    // Fallback polling in case WebSocket drops or never connects
    const pollTimer = setInterval(() => {
      if (ws?.readyState !== WebSocket.OPEN) {
        fetchAll();
      }
    }, POLL_FALLBACK_INTERVAL);

    return () => {
      mountedRef.current = false;
      intentionalClose = true;
      clearInterval(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (timelineDebounce) clearTimeout(timelineDebounce);
      if (sessionDebounce) clearTimeout(sessionDebounce);
      if (ws) {
        ws.onclose = null; // prevent reconnection on intentional close
        ws.close();
      }
    };
  }, [server]);

  const isActive = activities.length > 0;

  return { activities, sessions, isActive, completionCounter };
}

// Re-export for provider wrapper
export { ServerActivityContext };
export const ServerActivityProvider = ServerActivityContext.Provider;
