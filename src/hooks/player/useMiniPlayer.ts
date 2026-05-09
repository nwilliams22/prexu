/**
 * Mini-player hook for the native (mpv-backed) player path.
 *
 * Wraps `playerEnterMini` / `playerExitMini` (the Rust commands shipped in
 * prexu-a6z.1, behind `src/services/player.ts`) with React state so the
 * existing PiP button in ControlsBottomBar can drive a Win32-native
 * mini-player. The browser Picture-in-Picture API silently no-ops inside
 * Tauri's WebView2 because there is no `<video>` element on the native
 * path (mpv renders into a sibling Win32 HostWindow), which is why
 * clicking the PiP button on native used to do nothing.
 *
 * Defaults: bottom-right corner, 480×270 (16:9). The full Phase 4 Step
 * 4.2 will read persisted corner+size from tauri-plugin-store and expose
 * UI to change them; this is the MVP that lets the existing button work.
 */

import { useCallback, useState } from "react";
import { playerEnterMini, playerExitMini } from "../../services/player";
import { logger } from "../../services/logger";

const DEFAULT_CORNER = "bottom-right" as const;
const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 270;

export interface UseMiniPlayerResult {
  /** True when the player is currently in mini mode. */
  isMini: boolean;
  /** Whether mini-player is supported on this platform. */
  isMiniSupported: boolean;
  /** Toggle mini-player on/off. Logs through the project logger. */
  toggleMini: () => void;
}

export function useMiniPlayer(): UseMiniPlayerResult {
  const [isMini, setIsMini] = useState(false);

  const toggleMini = useCallback(() => {
    if (isMini) {
      logger.info("player:mini", "exiting");
      playerExitMini()
        .then(() => setIsMini(false))
        .catch((err) =>
          logger.error("player:mini", "exit failed", String(err)),
        );
      return;
    }
    logger.info("player:mini", "entering", {
      corner: DEFAULT_CORNER,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
    playerEnterMini(DEFAULT_CORNER, DEFAULT_WIDTH, DEFAULT_HEIGHT)
      .then(() => setIsMini(true))
      .catch((err) =>
        logger.error("player:mini", "enter failed", String(err)),
      );
  }, [isMini]);

  return {
    isMini,
    isMiniSupported: true,
    toggleMini,
  };
}
