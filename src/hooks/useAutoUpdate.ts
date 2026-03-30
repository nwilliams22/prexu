/**
 * Auto-update hook — checks for app updates on launch using
 * the Tauri updater plugin and exposes update state to the UI.
 */

import { useState, useEffect, useCallback, useRef } from "react";

export interface AutoUpdateState {
  /** Whether a check is in progress */
  checking: boolean;
  /** Whether an update is available and ready to install */
  updateAvailable: boolean;
  /** The version string of the available update, if any */
  updateVersion: string | null;
  /** Download progress (0–100), null when not downloading */
  downloadProgress: number | null;
  /** Whether the update is currently being downloaded/installed */
  installing: boolean;
  /** Install the pending update (downloads + restarts) */
  installUpdate: () => Promise<void>;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useAutoUpdate(): AutoUpdateState {
  const [checking, setChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);

  // Store the update object so we can install it later
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingUpdateRef = useRef<any>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let cancelled = false;

    async function checkForUpdates() {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        setChecking(true);

        const update = await check();
        if (cancelled) return;

        if (update) {
          setUpdateAvailable(true);
          setUpdateVersion(update.version);
          pendingUpdateRef.current = update;
        }
      } catch {
        // Silently ignore update check failures — not critical
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    // Check for updates shortly after launch (non-blocking)
    const timer = setTimeout(checkForUpdates, 3000);

    // Re-check periodically while the app is open (every 15 minutes)
    const interval = setInterval(checkForUpdates, 15 * 60 * 1000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, []);

  const installUpdate = useCallback(async () => {
    const update = pendingUpdateRef.current;
    if (!update) return;

    setInstalling(true);
    setDownloadProgress(0);

    let downloaded = 0;
    let contentLength = 0;

    await update.downloadAndInstall((event: { event: string; data?: Record<string, number> }) => {
      if (event.event === "Started" && event.data?.contentLength) {
        contentLength = event.data.contentLength;
      } else if (event.event === "Progress" && event.data?.chunkLength) {
        downloaded += event.data.chunkLength;
        if (contentLength > 0) {
          const pct = Math.min(100, Math.round((downloaded / contentLength) * 100));
          setDownloadProgress(pct);
        }
      }
    });

    // The app will restart after install — these lines may not execute
    setInstalling(false);
    setDownloadProgress(null);
  }, []);

  return {
    checking,
    updateAvailable,
    updateVersion,
    downloadProgress,
    installing,
    installUpdate,
  };
}
