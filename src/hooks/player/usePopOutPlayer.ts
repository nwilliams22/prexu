/**
 * Pop-out player hook for the native (mpv-backed) player path.
 *
 * Wraps `playerEnterPopOut` / `playerExitPopOut` (the Rust commands shipped
 * in prexu-a6z.1, renamed in prexu-7il.1, behind `src/services/player.ts`)
 * with React state so the existing Pop-out button in ControlsBottomBar can
 * drive a Win32-native floating window. The browser Picture-in-Picture API
 * silently no-ops inside Tauri's WebView2 because there is no `<video>`
 * element on the native path (mpv renders into a sibling Win32 HostWindow),
 * which is why clicking the PiP button on native used to do nothing.
 *
 * The Rust side owns the geometry: it reads the persisted corner + size
 * from `popout-player.json` on enter (falling back to bottom-right / 480×
 * 270 on first run) and writes the current outer size back on exit. This
 * hook just toggles — it does not need to know the dimensions.
 *
 * Distinct from the new in-window "minimize" mode that lands in prexu-7il.3
 * (`usePlayerSession().minimize()`). Pop-out shrinks the entire Tauri
 * window; minimize keeps the main window full size and renders the player
 * chrome in a small corner region of the WebView.
 */

import { useCallback, useState } from "react";
import { playerEnterPopOut, playerExitPopOut } from "../../services/player";
import { logger } from "../../services/logger";

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
    isPopOutSupported: true,
    togglePopOut,
  };
}
