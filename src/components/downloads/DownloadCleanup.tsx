import { useEffect, useRef } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useDownloads } from "../../hooks/useDownloads";
import { usePlayerSession } from "../../contexts/PlayerContext";
import { autoDeleteDownloadsEnabled, useAutoDeleteDownloads } from "../../hooks/useAutoDeleteDownloads";
import { getItemMetadata } from "../../services/plex-library";
import { onWatchStateChanged } from "../../services/watch-state-events";
import { isWatchedDownloadEligible } from "../../services/download-cleanup";
import { logger } from "../../services/logger";

// Module lifetime matches a page/app launch, including StrictMode remounts.
const sessionStartedAt = Math.floor(Date.now() / 1000) * 1000;
const CHECK_INTERVAL_MS = 60_000;

/** Run below both providers so cleanup cannot remove a playing download. */
export function DownloadCleanup() {
  const { server } = useAuth();
  const { downloads, deleteDownload } = useDownloads();
  const { session } = usePlayerSession();
  const [enabled] = useAutoDeleteDownloads();
  const latest = useRef({ downloads, session, deleteDownload });
  latest.current = { downloads, session, deleteDownload };
  const protectedKeys = useRef(new Set<string>());
  const startupKeys = useRef(new Set<string>());
  const enabledAtLaunch = useRef(enabled);

  useEffect(() => onWatchStateChanged((key) => {
    // Ambiguous events conservatively protect every current download.
    for (const item of latest.current.downloads) {
      if (!key || key === item.ratingKey) protectedKeys.current.add(item.ratingKey);
    }
  }), []);
  useEffect(() => {
    if (session) protectedKeys.current.add(session.ratingKey);
  }, [session]);

  useEffect(() => {
    if (!enabled || !server || !("__TAURI_INTERNALS__" in window)) return;
    const controller = new AbortController();
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        for (const item of latest.current.downloads) {
          if (controller.signal.aborted || !autoDeleteDownloadsEnabled()) break;
          if (item.status !== "complete" || item.serverUri !== server.uri) continue;
          const key = JSON.stringify([item.serverUri, item.ratingKey]);
          const startup = enabledAtLaunch.current && !startupKeys.current.has(key);
          try {
            const metadata = await getItemMetadata(server.uri, server.accessToken, item.ratingKey, controller.signal);
            if (controller.signal.aborted) break;
            startupKeys.current.add(key);
            const current = latest.current.downloads.find(d => d.ratingKey === item.ratingKey && d.serverUri === item.serverUri);
            if (!current || metadata.ratingKey !== item.ratingKey) continue;
            if (!isWatchedDownloadEligible({
              enabled: autoDeleteDownloadsEnabled(), complete: current.status === "complete",
              watched: (metadata.viewCount ?? 0) > 0,
              watchedAt: metadata.lastViewedAt === undefined ? undefined : metadata.lastViewedAt * 1000,
              sessionStartedAt, startup, now: Date.now(),
              protectedThisSession: protectedKeys.current.has(item.ratingKey) ||
                latest.current.session?.ratingKey === item.ratingKey ||
                (current.completedAt ?? Infinity) >= sessionStartedAt,
            })) continue;
            await latest.current.deleteDownload(item.ratingKey);
          } catch {
            if (!controller.signal.aborted) logger.warn("downloads:cleanup", "Watched status unavailable; keeping download");
          }
        }
      } finally { busy = false; }
    };
    void check();
    const timer = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [enabled, server, downloads.length]);
  return null;
}
