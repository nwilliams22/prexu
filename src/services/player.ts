/**
 * Native player IPC wrappers.
 *
 * Most player commands are still invoked directly from `useNativePlayer` and
 * `pages/Player.tsx` (legacy). New commands land here so we have one place
 * where the TS↔Rust contract is documented and logged consistently with
 * the project's logging conventions (see CLAUDE.md / `services/logger.ts`).
 *
 * The pop-out player commands (renamed from "mini-player" in prexu-7il.1)
 * are the first batch — `usePopOutPlayer` consumes these wrappers, not
 * invoke directly.
 */

import { invoke } from "@tauri-apps/api/core";
import { logger } from "./logger";
import { type MiniCorner } from "../utils/mini-rect";

export type { MiniCorner };

/**
 * Enter pop-out mode. The Tauri main window is resized + snapped to a
 * corner of the current display's WORK area (taskbar excluded), set
 * always-on-top, and the mpv host window is resynced.
 *
 * All args are optional — when omitted, the Rust side reads the last-known
 * `corner` and `(width, height)` from `popout-player.json` (falling back
 * to bottom-right / 480×270 on first run). User-driven resizes of the
 * pop-out window round-trip via this path: `playerExitPopOut` saves the
 * window's current outer size before restoring, so the next call here
 * with no args reopens at the same dimensions.
 */
export async function playerEnterPopOut(
  corner?: MiniCorner,
  width?: number,
  height?: number,
): Promise<void> {
  logger.info("player", "player_enter_popout", { corner, width, height });
  await invoke("player_enter_popout", { corner, width, height });
}

/**
 * Exit pop-out mode. Always-on-top is cleared and the main window is
 * restored to whatever outer geometry it had before the most recent
 * `playerEnterPopOut` (the Rust side stashes it in PlayerState). Calling
 * this without a prior enter is a no-op for size/position but still clears
 * always-on-top.
 *
 * Side effect: the current outer size is persisted to the store so any
 * user-driven resize during pop-out is remembered for the next session.
 */
export async function playerExitPopOut(): Promise<void> {
  logger.info("player", "player_exit_popout");
  await invoke("player_exit_popout");
}

/**
 * Enter in-window minimize mode (prexu-7il.2). The Tauri main window
 * stays at its current size; only the mpv host shrinks to a
 * `(width, height)` rect anchored to `corner` of the WebView client area,
 * with `padding` pixels of gutter. The host re-snaps to the corner on
 * every Resized event so it tracks the chosen corner as the user resizes
 * the main window.
 *
 * `corner` was added in prexu-7il.7 (anchor-drag). Omitting it preserves
 * the legacy bottom-right placement so existing call sites + first-time
 * entry paths continue working unchanged.
 *
 * Distinct from pop-out (which shrinks the entire Tauri window into a
 * floating always-on-top mini window). Mutual exclusion is handled at
 * the React button layer (7il.4), not in the Rust commands.
 */
export async function playerEnterMinimize(
  width: number,
  height: number,
  padding?: number,
  corner?: MiniCorner,
): Promise<void> {
  logger.info("player", "player_enter_minimize", { width, height, padding, corner });
  await invoke("player_enter_minimize", { width, height, padding, corner });
}

/**
 * Exit minimize mode. Clears the inset and resyncs the mpv host to the
 * full WebView client area.
 */
export async function playerExitMinimize(): Promise<void> {
  logger.info("player", "player_exit_minimize");
  await invoke("player_exit_minimize");
}
