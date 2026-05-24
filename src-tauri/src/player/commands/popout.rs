//! Pop-out player commands.
//!
//! Floating mini-window mode: shrinks the whole Tauri main window down to a
//! corner of the user's current display, sets always-on-top, and resyncs the
//! mpv host window. Distinct from the in-window "minimize" mode which keeps
//! the main window full size but renders the player chrome in a small corner
//! region of the WebView.

use tauri::{AppHandle, Manager, State};
#[cfg(target_os = "windows")]
use tauri_plugin_store::StoreExt;

use crate::player::{MinimizeCorner, PlayerState};

/// Path used for the pop-out player store. Kept separate from
/// `secure-store.json` (which holds auth tokens managed via the JS LazyStore)
/// so the Rust-side state and the frontend's secure data don't share a file
/// lock. Existing users without a stored entry fall back to the defaults
/// (bottom-right, 480×270) on first pop-out.
#[cfg(target_os = "windows")]
const POPOUT_STORE_PATH: &str = "popout-player.json";
#[cfg(target_os = "windows")]
const POPOUT_KEY_CORNER: &str = "popout.corner";
#[cfg(target_os = "windows")]
const POPOUT_KEY_SIZE: &str = "popout.size";

#[cfg(target_os = "windows")]
const POPOUT_DEFAULT_CORNER: &str = "bottom-right";
#[cfg(target_os = "windows")]
const POPOUT_DEFAULT_WIDTH: u32 = 480;
#[cfg(target_os = "windows")]
const POPOUT_DEFAULT_HEIGHT: u32 = 270;

/// Query the WORK AREA (desktop rect minus taskbar/docked toolbars) in
/// physical pixels for the monitor the given window currently lives on.
/// Uses `MonitorFromWindow` + `GetMonitorInfoW` so a pop-out triggered
/// from the secondary display lands on that secondary display, not the
/// primary one.
#[cfg(target_os = "windows")]
fn current_work_area(
    main: &tauri::WebviewWindow,
) -> Result<(i32, i32, i32, i32), String> {
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    let hwnd = main
        .hwnd()
        .map_err(|e| format!("get main hwnd failed: {}", e))?;
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info as *mut _).as_bool() {
            return Err("GetMonitorInfoW failed".to_string());
        }
        let r = info.rcWork;
        let x = r.left;
        let y = r.top;
        let w = r.right - r.left;
        let h = r.bottom - r.top;
        log::debug!(
            "[player:popout] current-monitor work area = ({},{},{}x{})",
            x, y, w, h
        );
        Ok((x, y, w, h))
    }
}

/// Load the persisted pop-out corner + size from the store, falling back to
/// the project defaults when no entry exists yet. Returns `(corner, width,
/// height)` ready to feed into `corner_origin`.
///
/// The on-disk format is kebab-case strings (e.g. `"bottom-right"`) which
/// serde deserializes directly into `MinimizeCorner` via `#[serde(rename_all =
/// "kebab-case")]`. Unknown strings (corrupted store, future migration) fall
/// back to `BottomRight` with a warning so the app keeps working.
#[cfg(target_os = "windows")]
fn load_persisted_popout(app: &AppHandle) -> (MinimizeCorner, u32, u32) {
    let mut corner = MinimizeCorner::BottomRight;
    let mut width = POPOUT_DEFAULT_WIDTH;
    let mut height = POPOUT_DEFAULT_HEIGHT;
    if let Ok(store) = app.store(POPOUT_STORE_PATH) {
        if let Some(v) = store.get(POPOUT_KEY_CORNER) {
            match serde_json::from_value::<MinimizeCorner>(v.clone()) {
                Ok(c) => corner = c,
                Err(e) => log::warn!(
                    "[player:popout] persisted corner unrecognised ({:?}), using default: {}",
                    v, e
                ),
            }
        }
        if let Some(v) = store.get(POPOUT_KEY_SIZE) {
            if let (Some(w), Some(h)) = (
                v.get("width").and_then(|x| x.as_u64()),
                v.get("height").and_then(|x| x.as_u64()),
            ) {
                width = w as u32;
                height = h as u32;
            }
        }
    }
    log::debug!(
        "[player:popout] resolved persisted geometry corner={:?} size={}x{}",
        corner, width, height
    );
    (corner, width, height)
}

/// Read the Tauri main window's outer rect via Win32 `GetWindowRect` and
/// return `(x, y, width, height)`. Stashed on `enter_popout` and restored
/// on `exit_popout` so the window snaps back to exactly where it started.
///
/// Bypasses Tauri's `WebviewWindow::outer_position` / `outer_size` because
/// tao on Win11 mixes GetWindowRect output with logical/inner sizing math.
/// Combined with Win11's invisible DWM resize borders (`GetWindowRect`
/// includes them but `set_size` does not), a stash+restore via tao drifts
/// by ~7 px per cycle, growing the window on each enter/exit. Going through
/// pure Win32 removes the asymmetry — `GetWindowRect` and `SetWindowPos`
/// operate on the same outer rect including invisible borders.
#[cfg(target_os = "windows")]
fn read_window_rect(
    main: &tauri::WebviewWindow,
) -> Result<(i32, i32, i32, i32), String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let hwnd = main
        .hwnd()
        .map_err(|e| format!("get main hwnd failed: {}", e))?;
    let mut rect = RECT::default();
    unsafe {
        GetWindowRect(hwnd, &mut rect as *mut _)
            .map_err(|e| format!("GetWindowRect failed: {:?}", e))?;
    }
    Ok((
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top,
    ))
}

/// Apply an outer rect to the Tauri main window via Win32 `SetWindowPos`.
/// Paired with `read_window_rect` to round-trip pre-popout geometry exactly.
#[cfg(target_os = "windows")]
fn write_window_rect(
    main: &tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };
    let hwnd = main
        .hwnd()
        .map_err(|e| format!("get main hwnd failed: {}", e))?;
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER,
        )
        .map_err(|e| format!("SetWindowPos failed: {:?}", e))
    }
}

/// Compute the (x, y) origin for a `(width, height)` window snapped to
/// `corner` of the work area `(wx, wy, ww, wh)`. Width/height are clamped
/// against the work-area dimensions so a too-large request still fits.
#[cfg(target_os = "windows")]
fn corner_origin(
    corner: MinimizeCorner,
    width: u32,
    height: u32,
    wx: i32,
    wy: i32,
    ww: i32,
    wh: i32,
) -> (i32, i32, u32, u32) {
    let w = (width as i32).min(ww).max(1) as u32;
    let h = (height as i32).min(wh).max(1) as u32;
    let (x, y) = match corner {
        MinimizeCorner::TopLeft => (wx, wy),
        MinimizeCorner::TopRight => (wx + ww - w as i32, wy),
        MinimizeCorner::BottomLeft => (wx, wy + wh - h as i32),
        MinimizeCorner::BottomRight => (wx + ww - w as i32, wy + wh - h as i32),
    };
    // Defense-in-depth: on multi-monitor setups with negative work-area
    // origins (monitors arranged above/left of primary), or when a saved
    // size from a larger display gets carried to a smaller one, the final
    // rect could land partly off-screen. Width/height are clamped above,
    // so this just keeps the (x, y) corner placement fully inside the work
    // area. No-op in the common case.
    let x = x.max(wx).min(wx + ww - w as i32);
    let y = y.max(wy).min(wy + wh - h as i32);
    log::debug!(
        "[player:popout] corner_origin corner={:?} requested={}x{} work=({},{},{}x{}) final=({},{},{}x{})",
        corner, width, height, wx, wy, ww, wh, x, y, w, h
    );
    (x, y, w, h)
}

/// Enter pop-out mode: resize+reposition the Tauri main window to a corner
/// of the current display's work area, set always-on-top, and resync the
/// mpv host window. The pre-pop-out outer geometry of the main window is
/// stashed in `PlayerState::pre_popout_geometry` for `player_exit_popout`
/// to restore.
///
/// All args are `Option` so the frontend can pass `undefined` to mean "use
/// the persisted geometry from `popout-player.json`". When the store is
/// empty (first run on this profile), `POPOUT_DEFAULT_*` are used. The hook
/// typically calls this with no args after the first session.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_enter_popout(
    corner: Option<MinimizeCorner>,
    width: Option<u32>,
    height: Option<u32>,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    let (saved_corner, saved_w, saved_h) = load_persisted_popout(&app);
    let corner = corner.unwrap_or(saved_corner);
    let width = width.unwrap_or(saved_w);
    let height = height.unwrap_or(saved_h);
    log::info!(
        "[player:cmd] enter_popout corner={:?} size={}x{}",
        corner,
        width,
        height
    );
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    // Clear any minimize inset BEFORE doing any geometry work. Pop-out and
    // minimize are mutually exclusive; without this, a frontend race between
    // playerExitMinimize and playerEnterPopOut can leave state.minimize=Some
    // while we apply the popout geometry, causing the SetWindowPos resize
    // storm to read the stale inset and shrink the host to the bottom-right
    // corner of the new popout window. Clearing here is authoritative —
    // subsequent Resized events will all see minimize=None.
    if let Ok(mut mz) = state.minimize.lock() {
        if mz.is_some() {
            log::debug!("[player:popout] clearing leftover minimize inset on enter");
        }
        *mz = None;
    }

    let (wx, wy, ww, wh) = current_work_area(&main)?;
    let (x, y, w, h) = corner_origin(corner, width, height, wx, wy, ww, wh);

    // Stash the current OUTER rect via Win32 GetWindowRect. Captured +
    // restored through the same Win32 API so the round-trip is exact —
    // Tauri's outer_size/outer_position go through tao which disagrees with
    // SetWindowPos by ~7 px due to Win11's invisible DWM resize borders,
    // causing the window to grow on each enter/exit cycle.
    match read_window_rect(&main) {
        Ok((rx, ry, rw, rh)) => {
            let stash = (rx, ry, rw as u32, rh as u32);
            if let Ok(mut g) = state.pre_popout_geometry.lock() {
                *g = Some(stash);
                log::debug!(
                    "[player:popout] stashed pre-popout outer geometry ({},{},{}x{}) via GetWindowRect",
                    stash.0, stash.1, stash.2, stash.3
                );
            }
        }
        Err(e) => log::warn!("[player:popout] read_window_rect for stash failed: {}", e),
    }

    // Apply window changes via Win32 SetWindowPos (matches GetWindowRect's
    // coordinate system; see read_window_rect doc). set_always_on_top stays
    // on Tauri because that API call also flips WS_EX_TOPMOST on the
    // WebView's ancestor chain, not just the main HWND. We leave the
    // window resizable (tauri.conf.json `resizable: true`) so the user can
    // grab the top-left corner of the floating window; the new size is
    // persisted in `player_exit_popout` so the next entry restores it.
    main.set_always_on_top(true)
        .map_err(|e| format!("set_always_on_top failed: {}", e))?;
    write_window_rect(&main, x, y, w as i32, h as i32)
        .map_err(|e| format!("popout geometry apply failed: {}", e))?;

    log::debug!(
        "[player:popout] resized main to ({},{},{}x{}); resynced host",
        x, y, w, h
    );

    // Resync the host immediately. The on_window_event listener will also
    // fire from the resize, but it goes through the throttle; an explicit
    // apply guarantees the video window is in place by the time the command
    // returns.
    if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
        state.apply_host_geometry(pos.x, pos.y, size.width as i32, size.height as i32);
    }

    // Mark the mpv host window topmost too. Tauri's set_always_on_top on
    // the main window only flips that flag for the WebView's HWND — the
    // host is a sibling top-level so it stays in the regular z-order,
    // letting other apps render between the always-on-top WebView and
    // the video underneath. Anchor below main inside the topmost group
    // so the WebView still overlays the video region.
    if let Ok(parent) = main.hwnd() {
        state.apply_host_topmost(true, Some(parent));
    } else {
        state.apply_host_topmost(true, None);
    }

    // Persist the chosen corner + size for next session. A failure here is
    // not fatal — the user can re-enter pop-out and we'll save again.
    match app.store(POPOUT_STORE_PATH) {
        Ok(store) => {
            // Serialize the enum back to its kebab-case string to keep the
            // on-disk format stable (old user data remains compatible).
            let corner_str = serde_json::to_value(corner)
                .unwrap_or_else(|_| serde_json::Value::String(POPOUT_DEFAULT_CORNER.to_string()));
            store.set(POPOUT_KEY_CORNER, corner_str);
            store.set(
                POPOUT_KEY_SIZE,
                serde_json::json!({ "width": w, "height": h }),
            );
            if let Err(e) = store.save() {
                log::warn!("[player:popout] store save failed: {:?}", e);
            } else {
                log::debug!(
                    "[player:popout] persisted corner={:?} size={}x{}",
                    corner, w, h
                );
            }
        }
        Err(e) => log::warn!("[player:popout] store open failed: {:?}", e),
    }

    Ok(())
}

/// Exit pop-out mode: clear always-on-top and restore the main window to
/// the outer geometry stashed by `player_enter_popout`. If no stash exists
/// (e.g. exit called without a prior enter), this clears always-on-top and
/// returns Ok without resizing.
///
/// Persistence: BEFORE restoring, we read the main window's current outer
/// size and write it back to the store under `POPOUT_KEY_SIZE`. This is
/// how user-driven resizes (dragging the top-left corner while the pop-out
/// is open) round-trip across sessions — the next `player_enter_popout`
/// with no args reads this saved size via `load_persisted_popout`.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_exit_popout(
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] exit_popout");
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    // Capture the user's current size BEFORE restoring so any post-enter
    // resize is preserved. Read via Win32 GetWindowRect so the stored value
    // matches what SetWindowPos on a subsequent enter will receive.
    match read_window_rect(&main) {
        Ok((_, _, rw, rh)) => match app.store(POPOUT_STORE_PATH) {
            Ok(store) => {
                store.set(
                    POPOUT_KEY_SIZE,
                    serde_json::json!({ "width": rw, "height": rh }),
                );
                if let Err(e) = store.save() {
                    log::warn!("[player:popout] resize-on-exit save failed: {:?}", e);
                } else {
                    log::debug!(
                        "[player:popout] persisted resized size {}x{} on exit",
                        rw, rh
                    );
                }
            }
            Err(e) => log::warn!("[player:popout] resize-on-exit store open failed: {:?}", e),
        },
        Err(e) => log::warn!("[player:popout] resize-on-exit read failed: {}", e),
    }

    main.set_always_on_top(false)
        .map_err(|e| format!("set_always_on_top(false) failed: {}", e))?;

    // Clear topmost on the mpv host window AND re-anchor it below the
    // WebView. Passing Some(parent) here is load-bearing:
    // SetWindowPos(HWND_NOTOPMOST) alone leaves the host above normal-
    // z-order siblings, so after exit the host floats over the WebView
    // and the app becomes uninteractable. Anchoring below puts it back
    // in its correct place underneath the WebView pixels.
    let parent_hwnd = main.hwnd().ok();
    state.apply_host_topmost(false, parent_hwnd);

    let stash = state
        .pre_popout_geometry
        .lock()
        .ok()
        .and_then(|mut g| g.take());

    let Some((x, y, w, h)) = stash else {
        log::debug!("[player:popout] exit_popout: no stash, only cleared always-on-top");
        return Ok(());
    };

    write_window_rect(&main, x, y, w as i32, h as i32)
        .map_err(|e| format!("popout restore apply failed: {}", e))?;

    log::debug!(
        "[player:popout] restored main to ({},{},{}x{}) via SetWindowPos; resynced host",
        x, y, w, h
    );

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
pub async fn player_enter_popout(
    _corner: Option<crate::player::MinimizeCorner>,
    _width: Option<u32>,
    _height: Option<u32>,
) -> Result<(), String> {
    log::warn!("[player:cmd] enter_popout called on non-Windows platform");
    Err("pop-out mode is only supported on Windows in Phase 4".into())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn player_exit_popout() -> Result<(), String> {
    log::warn!("[player:cmd] exit_popout called on non-Windows platform");
    Err("pop-out mode is only supported on Windows in Phase 4".into())
}
