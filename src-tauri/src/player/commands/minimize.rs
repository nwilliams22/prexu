//! In-window minimize commands.
//!
//! Keeps the Tauri main window full size and only constrains the mpv host
//! to a small inset of the WebView client area. The rest of the WebView
//! remains interactive so the user can browse the Library, check cast/crew,
//! etc. while the small video region keeps playing in the corner.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::player::{MinimizeCorner, MinimizeState, PlayerState};

#[cfg(target_os = "windows")]
const MINIMIZE_DEFAULT_PADDING: u32 = 16;

/// Pure core: apply the optional-with-default IPC arguments and produce the
/// `MinimizeState` value that `enter_minimize` and `update_mini_geometry`
/// both store. Extracted so the state-transition logic is unit-testable
/// without an `AppHandle` or a Tauri runtime.
///
/// `padding` defaults to `MINIMIZE_DEFAULT_PADDING` (16 logical px).
/// `corner` defaults to `MinimizeCorner::BottomRight`.
#[cfg(target_os = "windows")]
pub(crate) fn compute_minimize_state(
    width: u32,
    height: u32,
    padding: Option<u32>,
    corner: Option<MinimizeCorner>,
) -> MinimizeState {
    MinimizeState {
        width,
        height,
        padding: padding.unwrap_or(MINIMIZE_DEFAULT_PADDING),
        corner: corner.unwrap_or(MinimizeCorner::BottomRight),
    }
}

/// Enter minimize mode: store the (corner, width, height, padding) of the
/// desired inset rect in PlayerState and force a host resync so the mpv
/// window shrinks to the chosen corner of the current WebView client area.
///
/// Omitting `corner` preserves the default bottom-right placement. The
/// host re-snaps to the chosen corner on every Resized event via
/// `apply_minimize_inset`, so the small region tracks the corner regardless
/// of subsequent window resizes.
///
/// Re-entrant: calling this again while already in minimize mode (e.g. the
/// React side dragging the resize handle or moving to a different corner)
/// updates the inset in place. The synchronous resync via
/// `apply_host_geometry` makes the new geometry visible within one frame.
///
/// Mutual exclusion with pop-out is handled at the React button layer so
/// the IPC contract stays simple — this command itself does not touch
/// popout state.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_enter_minimize(
    width: u32,
    height: u32,
    padding: Option<u32>,
    corner: Option<MinimizeCorner>,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    // Drop body.player-transparent for the transition (prexu-7d3). When
    // chained after exit_popout (popout → minimize), the WebView has just
    // restored to full-main size and the underlying route may still be
    // painting. Re-armed after the host inset is applied.
    let _ = app.emit("player://host-window-busy", ());
    let new_state = compute_minimize_state(width, height, padding, corner);
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    // The frontend passes width / height / padding in CSS (logical) pixels
    // so the mini chrome and the AppLayout mask hole are sized consistently
    // across DPI scales. We store the logical px here verbatim and refresh
    // the cached `scale_factor` from the live main window;
    // `apply_minimize_inset` then multiplies by the cached scale on every
    // host placement.
    //
    // This makes cross-monitor DPI changes (WM_DPICHANGED → Tauri's
    // WindowEvent::ScaleFactorChanged) Just Work — the handler updates
    // the cached scale and the very next `sync_geometry` produces the
    // correct host rect for the new monitor's DPI without re-issuing
    // this IPC from React.
    let scale = main.scale_factor().unwrap_or(1.0);
    state.set_scale_factor(scale);
    log::info!(
        "[player:cmd] enter_minimize size={}x{} padding={} corner={:?} scale={:.2} (logical px stored)",
        width, height, new_state.padding, new_state.corner, scale
    );

    if let Ok(mut mz) = state.minimize.lock() {
        *mz = Some(new_state);
    } else {
        return Err("minimize lock poisoned".to_string());
    }

    // Force resync now so the host shrinks immediately rather than waiting
    // for the next window event. apply_host_geometry honors the inset.
    if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
        state.apply_host_geometry(pos.x, pos.y, size.width as i32, size.height as i32);
    }

    // Transition complete — re-arm transparent body (prexu-7d3).
    let _ = app.emit("player://host-window-ready", ());
    Ok(())
}

/// Geometry-only update while already in minimize mode.
///
/// Updates the stored inset (corner, width, height, padding) and forces
/// an immediate host resync — identical geometry work to `enter_minimize`
/// but WITHOUT emitting `player://host-window-busy` / `player://host-window-ready`.
///
/// The busy/ready pair was added (prexu-7d3) for genuine mode transitions
/// (popout ↔ minimize) where the host window is recreated. Per-tick drag
/// and resize updates are NOT transitions — the host is already minimized,
/// only its inset rect is moving. Emitting busy/ready on every 33ms resize
/// tick caused `useTransparentWindow` to drop and re-arm body transparency
/// on each tick, producing the thrashing background visible during drag.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_update_mini_geometry(
    width: u32,
    height: u32,
    padding: Option<u32>,
    corner: Option<MinimizeCorner>,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    let new_state = compute_minimize_state(width, height, padding, corner);
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    let scale = main.scale_factor().unwrap_or(1.0);
    state.set_scale_factor(scale);
    log::debug!(
        "[player:cmd] update_mini_geometry size={}x{} padding={} corner={:?} scale={:.2}",
        width, height, new_state.padding, new_state.corner, scale
    );

    if let Ok(mut mz) = state.minimize.lock() {
        *mz = Some(new_state);
    } else {
        return Err("minimize lock poisoned".to_string());
    }

    if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
        state.apply_host_geometry(pos.x, pos.y, size.width as i32, size.height as i32);
    }

    // Intentionally NO busy/ready emit here — this is a geometry-only
    // update, not a mode transition. Emitting busy/ready on every drag
    // tick causes useTransparentWindow to thrash body transparency.
    Ok(())
}

/// Exit minimize mode: clear the inset and force a host resync so the
/// mpv window expands back to the full WebView client area.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_exit_minimize(
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] exit_minimize");
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    if let Ok(mut mz) = state.minimize.lock() {
        *mz = None;
    } else {
        return Err("minimize lock poisoned".to_string());
    }

    if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
        state.apply_host_geometry(pos.x, pos.y, size.width as i32, size.height as i32);
    }
    Ok(())
}

// Non-Windows stubs so the command names exist for the JS bridge but the
// platform that hasn't been ported yet (macOS / Linux) returns a clear error
// instead of failing at the IPC layer with "command not found". Keeps the
// frontend code path uniform.
#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn player_update_mini_geometry(
    _width: u32,
    _height: u32,
    _padding: Option<u32>,
    _corner: Option<crate::player::MinimizeCorner>,
) -> Result<(), String> {
    log::warn!("[player:cmd] update_mini_geometry called on non-Windows platform");
    Err("minimize mode is only supported on Windows in Phase 4".into())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn player_enter_minimize(
    _width: u32,
    _height: u32,
    _padding: Option<u32>,
    _corner: Option<crate::player::MinimizeCorner>,
) -> Result<(), String> {
    log::warn!("[player:cmd] enter_minimize called on non-Windows platform");
    Err("minimize mode is only supported on Windows in Phase 4".into())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn player_exit_minimize() -> Result<(), String> {
    log::warn!("[player:cmd] exit_minimize called on non-Windows platform");
    Err("minimize mode is only supported on Windows in Phase 4".into())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    use crate::player::{MinimizeCorner, PlayerState};

    // ── compute_minimize_state: default application ──────────────────────
    //
    // Both `player_enter_minimize` and `player_update_mini_geometry` go
    // through this fn, so asserting its output covers the defaulting
    // behaviour of both commands.

    #[test]
    fn compute_minimize_state_explicit_padding_and_corner_stored_verbatim() {
        let s = compute_minimize_state(320, 180, Some(8), Some(MinimizeCorner::TopLeft));
        assert_eq!(s.width, 320);
        assert_eq!(s.height, 180);
        assert_eq!(s.padding, 8);
        assert_eq!(s.corner, MinimizeCorner::TopLeft);
    }

    #[test]
    fn compute_minimize_state_none_padding_applies_default_16() {
        let s = compute_minimize_state(360, 200, None, Some(MinimizeCorner::TopRight));
        assert_eq!(s.padding, MINIMIZE_DEFAULT_PADDING);
    }

    #[test]
    fn compute_minimize_state_none_corner_applies_default_bottom_right() {
        let s = compute_minimize_state(360, 200, Some(12), None);
        assert_eq!(s.corner, MinimizeCorner::BottomRight);
    }

    #[test]
    fn compute_minimize_state_both_none_applies_both_defaults() {
        let s = compute_minimize_state(480, 270, None, None);
        assert_eq!(s.padding, MINIMIZE_DEFAULT_PADDING);
        assert_eq!(s.corner, MinimizeCorner::BottomRight);
    }

    #[test]
    fn compute_minimize_state_all_explicit_no_defaults_applied() {
        let s = compute_minimize_state(240, 135, Some(0), Some(MinimizeCorner::BottomLeft));
        assert_eq!(s.padding, 0);
        assert_eq!(s.corner, MinimizeCorner::BottomLeft);
    }

    // ── minimize state transitions via PlayerState ────────────────────────
    //
    // These mirror the convention used by the existing mod.rs tests for
    // is_in_popout / focus-reassert: we manipulate the Mutex directly so
    // the transition logic is tested without an AppHandle.

    #[test]
    fn minimize_state_starts_none() {
        let state = PlayerState::new();
        assert!(state.minimize.lock().unwrap().is_none());
    }

    #[test]
    fn enter_minimize_core_sets_state_with_explicit_values() {
        // Simulate what player_enter_minimize does after calling
        // compute_minimize_state: write the result into state.minimize.
        let state = PlayerState::new();
        let new_state = compute_minimize_state(320, 180, Some(8), Some(MinimizeCorner::TopLeft));
        *state.minimize.lock().unwrap() = Some(new_state);

        let stored = state.minimize.lock().unwrap().unwrap();
        assert_eq!(stored.width, 320);
        assert_eq!(stored.height, 180);
        assert_eq!(stored.padding, 8);
        assert_eq!(stored.corner, MinimizeCorner::TopLeft);
    }

    #[test]
    fn enter_minimize_core_applies_defaults_when_none() {
        let state = PlayerState::new();
        let new_state = compute_minimize_state(360, 200, None, None);
        *state.minimize.lock().unwrap() = Some(new_state);

        let stored = state.minimize.lock().unwrap().unwrap();
        assert_eq!(stored.padding, MINIMIZE_DEFAULT_PADDING);
        assert_eq!(stored.corner, MinimizeCorner::BottomRight);
    }

    #[test]
    fn update_mini_geometry_core_overwrites_existing_state() {
        // update_mini_geometry calls compute_minimize_state then replaces
        // the mutex value — same write as enter_minimize. Verify that a
        // second write with different args overwrites the first.
        let state = PlayerState::new();
        *state.minimize.lock().unwrap() =
            Some(compute_minimize_state(360, 200, Some(16), Some(MinimizeCorner::BottomRight)));
        // Now simulate an update (e.g. user drags resize handle).
        *state.minimize.lock().unwrap() =
            Some(compute_minimize_state(240, 135, Some(8), Some(MinimizeCorner::TopLeft)));

        let stored = state.minimize.lock().unwrap().unwrap();
        assert_eq!(stored.width, 240);
        assert_eq!(stored.height, 135);
        assert_eq!(stored.padding, 8);
        assert_eq!(stored.corner, MinimizeCorner::TopLeft);
    }

    #[test]
    fn update_mini_geometry_core_applies_defaults_on_none_args() {
        let state = PlayerState::new();
        *state.minimize.lock().unwrap() =
            Some(compute_minimize_state(360, 200, Some(20), Some(MinimizeCorner::TopRight)));
        // Simulate update with None padding/corner.
        *state.minimize.lock().unwrap() =
            Some(compute_minimize_state(480, 270, None, None));

        let stored = state.minimize.lock().unwrap().unwrap();
        assert_eq!(stored.padding, MINIMIZE_DEFAULT_PADDING);
        assert_eq!(stored.corner, MinimizeCorner::BottomRight);
    }

    #[test]
    fn exit_minimize_core_clears_state_to_none() {
        let state = PlayerState::new();
        *state.minimize.lock().unwrap() =
            Some(compute_minimize_state(360, 200, None, None));
        assert!(state.minimize.lock().unwrap().is_some());

        // Simulate what player_exit_minimize does: set minimize to None.
        *state.minimize.lock().unwrap() = None;

        assert!(state.minimize.lock().unwrap().is_none());
    }

    #[test]
    fn exit_minimize_core_is_idempotent_when_already_none() {
        let state = PlayerState::new();
        // Already None — clearing again must not panic.
        *state.minimize.lock().unwrap() = None;
        assert!(state.minimize.lock().unwrap().is_none());
    }

    // ── MINIMIZE_DEFAULT_PADDING constant is the single source of truth ──
    #[test]
    fn default_padding_constant_value_is_16() {
        assert_eq!(MINIMIZE_DEFAULT_PADDING, 16);
    }
}
