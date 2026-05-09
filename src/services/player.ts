/**
 * Native player IPC wrappers.
 *
 * Most player commands are still invoked directly from `useNativePlayer` and
 * `pages/Player.tsx` (legacy). New commands land here so we have one place
 * where the TS↔Rust contract is documented and logged consistently with
 * the project's logging conventions (see CLAUDE.md / `services/logger.ts`).
 *
 * The mini-player commands (Phase 4 / prexu-a6z.1) are the first batch —
 * `useMiniPlayer` (prexu-a6z.2) will consume these wrappers, not invoke
 * directly.
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger";

/** Corner of the work area to snap the mini-player window to. */
export type MiniPlayerCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/**
 * Enter mini-player mode. The Tauri main window is resized to
 * (width, height) and snapped to `corner` of the primary monitor's WORK
 * area (taskbar excluded), set always-on-top, and the mpv host window is
 * resynced. The chosen corner + size are persisted via tauri-plugin-store
 * for the next session.
 *
 * Sizes are physical pixels. The Rust side clamps oversized requests against
 * the work area so e.g. 9999x9999 is safe.
 */
export async function playerEnterMini(
  corner: MiniPlayerCorner,
  width: number,
  height: number,
): Promise<void> {
  logger.info("player", "player_enter_mini", { corner, width, height });
  await invoke("player_enter_mini", { corner, width, height });
}

/**
 * Exit mini-player mode. Always-on-top is cleared and the main window is
 * restored to whatever outer geometry it had before the most recent
 * `playerEnterMini` (the Rust side stashes it in PlayerState). Calling
 * this without a prior enter is a no-op for size/position but still clears
 * always-on-top.
 */
export async function playerExitMini(): Promise<void> {
  logger.info("player", "player_exit_mini");
  await invoke("player_exit_mini");
}
