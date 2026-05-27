//! In-window minimize commands.
//!
//! Keeps the Tauri main window full size and only constrains the mpv host
//! to a small inset of the WebView client area. The rest of the WebView
//! remains interactive so the user can browse the Library, check cast/crew,
//! etc. while the small video region keeps playing in the corner.

use tauri::{AppHandle, Manager, State};

use crate::player::{MinimizeCorner, MinimizeState, PlayerState};

#[cfg(target_os = "windows")]
const MINIMIZE_DEFAULT_PADDING: u32 = 16;

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
    let padding = padding.unwrap_or(MINIMIZE_DEFAULT_PADDING);
    let corner_enum = corner.unwrap_or(MinimizeCorner::BottomRight);
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
        width, height, padding, corner_enum, scale
    );

    if let Ok(mut mz) = state.minimize.lock() {
        *mz = Some(MinimizeState {
            width,
            height,
            padding,
            corner: corner_enum,
        });
    } else {
        return Err("minimize lock poisoned".to_string());
    }

    // Force resync now so the host shrinks immediately rather than waiting
    // for the next window event. apply_host_geometry honors the inset.
    // Child-relative origin (prexu-my6): host is a WS_CHILD of main so we
    // pass (0, 0, w, h); the minimize inset is computed against this origin.
    if let Ok(size) = main.inner_size() {
        state.apply_host_geometry(0, 0, size.width as i32, size.height as i32);
    }
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

    // Child-relative origin (prexu-my6): host is a WS_CHILD of main.
    if let Ok(size) = main.inner_size() {
        state.apply_host_geometry(0, 0, size.width as i32, size.height as i32);
    }
    Ok(())
}

// Non-Windows stubs so the command names exist for the JS bridge but the
// platform that hasn't been ported yet (macOS / Linux) returns a clear error
// instead of failing at the IPC layer with "command not found". Keeps the
// frontend code path uniform.
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
