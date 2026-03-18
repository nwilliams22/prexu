/**
 * Auto-update hook — checks for app updates on launch using
 * the Tauri updater plugin and exposes update state to the UI.
 */

import { useState, useEffect, useCallback, useRef } from "react";

interface AutoUpdateState {
  /** Whether a check is in progress */
  checking: boolean;
  /** Whether an update is available and ready to install */
  updateAvailable: boolean;
  /** The version string of the available update, if any */
  updateVersion: string | null;
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

  // Store the update object so we can install it later
  const pendingUpdateRef = useRef<{ downloadAndInstall: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let cancelled = false;

    async function checkForUpdates() {
      try {
        // TODO: Requires @tauri-apps/plugin-updater npm package to be installed.
        // Install with: npm install @tauri-apps/plugin-updater
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
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const installUpdate = useCallback(async () => {
    const update = pendingUpdateRef.current;
    if (!update) return;

    await update.downloadAndInstall();
    // The app will restart after install — this line may not execute
  }, []);

  return { checking, updateAvailable, updateVersion, installUpdate };
}
