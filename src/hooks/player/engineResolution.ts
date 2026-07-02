/**
 * Player engine selection — decides native (libmpv) vs HTML5 (<video> +
 * hls.js) playback for a given Player mount.
 *
 * Native playback requires running under Tauri on a platform with a
 * libmpv backend (Windows or Linux — see IS_NATIVE_PLAYER_PLATFORM; both
 * vendor/bundle libmpv, see docs/adr-native-player-render-api.md). Even
 * when the platform supports it, the *effective* engine for a given
 * playback session also depends on:
 *   - the user's `playerEngine` preference (auto | native | html5)
 *   - whether a runtime fallback has already been triggered this app
 *     session (`player://engine-failed`, or player_engine_status
 *     reporting unavailable) — see the session-fallback flag below.
 *
 * "auto" and "native" both resolve to native when the platform supports
 * it — they differ only in stated intent (auto = automatic best choice,
 * native = explicit opt-in), kept identical here for simplicity. "html5"
 * always forces the HTML5 backend.
 *
 * IMPORTANT — rules of hooks: usePlayer() dispatches to one of two
 * different hooks (useNativePlayer vs useHtml5Player) based on this
 * resolution. React requires the SAME hook to be called on every render
 * of a given component instance, so the resolved engine must be computed
 * ONCE per Player mount (via a lazy useState initializer in usePlayer)
 * and never recomputed mid-session. If a runtime fallback needs to
 * change the engine, the Player component must fully unmount and
 * remount — PlayerOverlay does this by bumping a `key` when
 * `subscribeToEngineFallback` fires.
 */

import type { PlayerEnginePreference } from "../../types/preferences";

export type { PlayerEnginePreference };
export type ResolvedEngine = "native" | "html5";

/**
 * Platform capability: native playback is *possible* when running inside
 * Tauri AND the OS is Windows or Linux. This is a coarser check than the
 * *effective* per-session engine — see resolveEngineChoice. Kept as a
 * module-level constant (evaluated once at import time) exactly like the
 * original IS_NATIVE_PLAYER did, since the platform itself never changes
 * at runtime.
 */
export const IS_NATIVE_PLAYER_PLATFORM =
  typeof window !== "undefined" &&
  "__TAURI_INTERNALS__" in window &&
  typeof navigator !== "undefined" &&
  (navigator.userAgent.includes("Windows") || navigator.userAgent.includes("Linux"));

/** True when the current OS is Windows specifically (real UA string, not
 *  jsdom's default). Used only to derive SUPPORTS_PLAYER_WINDOWING. */
const IS_WINDOWS_PLATFORM =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");

/**
 * Windows-only window management (minimize / pop-out). Native playback
 * requires an actual mpv host window; the player_enter_minimize /
 * player_exit_minimize / player_enter_popout / player_exit_popout /
 * player_update_mini_geometry commands only exist in the Rust backend on
 * Windows today — Linux native mini-player parity is tracked separately
 * (axj4.5). Gate every minimize/pop-out affordance AND IPC call on this
 * constant so Linux native never invokes an unregistered command.
 *
 * On Windows this is identical to the platform capability check, which is
 * exactly the old (pre-Linux) IS_NATIVE_PLAYER — Windows behavior is
 * therefore unchanged by construction.
 */
export const SUPPORTS_PLAYER_WINDOWING = IS_NATIVE_PLAYER_PLATFORM && IS_WINDOWS_PLATFORM;

export interface EngineResolutionInput {
  /** Whether native playback is possible on this platform at all. */
  platformCapable: boolean;
  /** The user's playerEngine preference, read once at Player mount. */
  playerEngine: PlayerEnginePreference;
  /** Whether a runtime fallback has already forced HTML5 this session. */
  sessionFallback: boolean;
}

/**
 * Pure resolution matrix — table-driven tested in engineResolution.test.ts.
 * No React, no I/O: safe to call from a lazy useState initializer.
 */
export function resolveEngineChoice({
  platformCapable,
  playerEngine,
  sessionFallback,
}: EngineResolutionInput): ResolvedEngine {
  if (!platformCapable) return "html5";
  if (sessionFallback) return "html5";
  if (playerEngine === "html5") return "html5";
  // "auto" and "native" both resolve to native when the platform supports it.
  return "native";
}

// ── Session fallback flag ───────────────────────────────────────────────
// Module-level (not React state) because it must survive across Player
// mounts within the same app process and be readable synchronously by the
// lazy useState initializer in usePlayer(). Once set, it forces HTML5 for
// the remainder of the app session (cleared only by app restart).
let sessionFallbackActive = false;
const fallbackListeners = new Set<() => void>();

/** Current value of the session-level fallback flag. */
export function isSessionFallbackActive(): boolean {
  return sessionFallbackActive;
}

/**
 * Flip the session-level fallback flag. Only the false→true edge notifies
 * subscribers (PlayerOverlay, which forces a full Player remount so the
 * locked-in engine choice re-resolves to HTML5). Re-setting true is a
 * harmless no-op notification-wise.
 */
export function setSessionFallbackActive(active: boolean): void {
  const changed = sessionFallbackActive !== active;
  sessionFallbackActive = active;
  if (changed && active) {
    for (const listener of fallbackListeners) {
      try {
        listener();
      } catch {
        // Never let one listener's error stop the others from running.
      }
    }
  }
}

/**
 * Subscribe to the fallback flag flipping true. Returns an unsubscribe
 * function. PlayerOverlay uses this to force a full Player remount into
 * HTML5 when native playback fails at runtime.
 */
export function subscribeToEngineFallback(listener: () => void): () => void {
  fallbackListeners.add(listener);
  return () => {
    fallbackListeners.delete(listener);
  };
}

/** Test-only reset — clears the fallback flag and listeners between tests. */
export function __resetEngineFallbackForTests(): void {
  sessionFallbackActive = false;
  fallbackListeners.clear();
  pendingResumeOffsetMs = null;
}

// ── Pending resume offset (best-effort, prexu-axj4.4) ─────────────────────
// When a runtime fallback interrupts native playback mid-session,
// useNativePlayer stashes its last known position here (milliseconds,
// matching Plex's viewOffset convention) alongside setSessionFallbackActive.
// PlayerOverlay reads + clears it when building the remounted <Player>'s
// offset prop so the HTML5 backend resumes close to where native left off,
// instead of restarting from the session's original offset. Module-level
// for the same reason as the fallback flag: it must survive the Player
// unmount/remount that the fallback itself triggers.
let pendingResumeOffsetMs: number | null = null;

/** Record the last known playback position (ms) ahead of a fallback. */
export function setPendingResumeOffsetMs(ms: number | null): void {
  pendingResumeOffsetMs = ms;
}

/** Read and clear the pending resume offset — one-shot, consumed by the
 *  next Player remount. */
export function consumePendingResumeOffsetMs(): number | null {
  const ms = pendingResumeOffsetMs;
  pendingResumeOffsetMs = null;
  return ms;
}
