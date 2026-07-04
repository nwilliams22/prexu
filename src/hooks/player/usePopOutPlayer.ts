/**
 * Pop-out player hook for the native (mpv-backed) player path.
 *
 * Wraps `playerEnterPopOut` / `playerExitPopOut` with React state so the
 * Pop-out button in ControlsBottomBar can drive a native floating window
 * (Win32 on Windows, Tauri/GTK on Linux — prexu-axj4.10). The browser
 * Picture-in-Picture API silently no-ops inside the Tauri webview because
 * there is no `<video>` element on the native path.
 *
 * The Rust side owns the geometry: it reads the persisted corner + size
 * from `popout-player.json` on enter (falling back to bottom-right / 480×
 * 270 on first run) and writes the current outer size back on exit. This
 * hook just toggles — it does not need to know the dimensions.
 *
 * Distinct from in-window minimize (`usePlayerSession().minimize()`). Pop-out
 * shrinks the entire Tauri window; minimize keeps the main window full size
 * and renders the player chrome in a small corner region of the WebView.
 */

import { useCallback, useState } from "react";
import { playerEnterPopOut, playerExitPopOut } from "../../services/player";
import { logger } from "../../services/logger";
import { SUPPORTS_PLAYER_POPOUT } from "./engineResolution";

export interface UsePopOutPlayerResult {
  /** True when the player is currently in pop-out mode. */
  isPopOut: boolean;
  /** Whether pop-out mode is supported on this platform. */
  isPopOutSupported: boolean;
  /** Toggle pop-out mode on/off. Logs through the project logger. */
  togglePopOut: () => void;
}

export function usePopOutPlayer(): UsePopOutPlayerResult {
  const [isPopOut, setIsPopOut] = useState(false);

  const togglePopOut = useCallback(() => {
    // Pop-out IPC exists on Windows and Linux native (SUPPORTS_PLAYER_POPOUT,
    // prexu-axj4.10) — no-op elsewhere (HTML5 fallback, unsupported OS) so
    // callers never invoke an unregistered Tauri command. UI affordances
    // should also gate on isPopOutSupported so this branch is a
    // defense-in-depth backstop.
    if (!SUPPORTS_PLAYER_POPOUT) {
      logger.warn("player:popout", "toggle ignored — popout unsupported on this platform");
      return;
    }
    if (isPopOut) {
      logger.info("player:popout", "exiting");
      playerExitPopOut()
        .then(() => setIsPopOut(false))
        .catch((err) =>
          logger.error("player:popout", "exit failed", String(err)),
        );
      return;
    }
    logger.info("player:popout", "entering");
    playerEnterPopOut()
      .then(() => setIsPopOut(true))
      .catch((err) =>
        logger.error("player:popout", "enter failed", String(err)),
      );
  }, [isPopOut]);

  return {
    isPopOut,
    isPopOutSupported: SUPPORTS_PLAYER_POPOUT,
    togglePopOut,
  };
}
