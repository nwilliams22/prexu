//! Fullscreen toggle command for the native player.
//!
//! Toggle the Tauri main window's fullscreen state.
//!
//! 1. Set a transition flag so the on_window_event listener skips
//!    sync_geometry during the animated transition (avoids the rapid
//!    SetWindowPos storm that crashes mpv's gpu-next vo).
//! 2. Toggle Tauri fullscreen.
//! 3. Wait for the transition to settle.
//! 4. Clear the flag, then dispatch a single explicit sync onto the
//!    main thread (Win32 windows are thread-affine; cross-thread
//!    SetWindowPos uses SendMessage and can be flaky during transient
//!    states like fullscreen entry).

use tauri::{AppHandle, Emitter, Manager, State};

use crate::player::PlayerState;

#[tauri::command]
pub async fn player_set_fullscreen(
    fullscreen: bool,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] set_fullscreen {}", fullscreen);
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    // Fast path: no mpv means nothing to sync. Used on Player unmount
    // after player_unload has torn down mpv — we just need the main
    // window out of fullscreen so the dashboard isn't stuck in it.
    // Skips the 350 ms transition wait and the geometry-sync closure
    // (both only exist to prevent mpv's D3D11 vo from crashing during
    // the resize storm; irrelevant when there's no mpv).
    if !state.is_initialised() {
        log::debug!("[player:cmd] set_fullscreen: no mpv, fast path");
        let fs_result = main
            .set_fullscreen(fullscreen)
            .map_err(|e| format!("set_fullscreen failed: {}", e));
        let actual_fs = main.is_fullscreen().unwrap_or(fullscreen);
        let _ = app.emit("player://fullscreen", actual_fs);
        return fs_result;
    }

    // Linux (prexu-axj4.3): video and UI are composited into one GTK surface,
    // so a fullscreen toggle is just a plain Tauri window toggle — GTK's widget
    // allocation resizes the GtkGLArea automatically, with no host geometry to
    // synchronise and no D3D11-swapchain-rebuild storm to suppress.
    #[cfg(target_os = "linux")]
    let fs_result = {
        // prexu-ngsa: bracket the toggle so the frontend chrome-hide
        // (player://host-window-busy listener, prexu-uf4m) covers fullscreen
        // — the same WebKitGTK large-resize relayout lag class as popout
        // exit (see the player-transition-hide-until-correct memory). Linux
        // only: the Windows path below has its own transition machinery
        // (set_fullscreen_transition) and useTransparentWindow reacts to
        // busy on Windows, so bracketing there needs on-Windows visual
        // verification first.
        let _ = app.emit("player://host-window-busy", ());
        let fs_result = main
            .set_fullscreen(fullscreen)
            .map_err(|e| format!("set_fullscreen failed: {}", e));
        let actual_fs = main.is_fullscreen().unwrap_or(fullscreen);
        log::info!("[player:cmd] set_fullscreen: emitting actual_fs={}", actual_fs);
        let _ = app.emit("player://fullscreen", actual_fs);
        let _ = app.emit("player://host-window-ready", ());
        fs_result
    };

    #[cfg(target_os = "windows")]
    let fs_result = {
    state.set_fullscreen_transition(true);
    let fs_result = main
        .set_fullscreen(fullscreen)
        .map_err(|e| format!("set_fullscreen failed: {}", e));

    // Dispatch the host geometry sync IMMEDIATELY on the main thread
    // (before the transition sleep) so the video catches up with the
    // overlay within a frame rather than lagging by the full 350 ms.
    // We use `apply_host_geometry` which bypasses the transition flag —
    // the flag stays set to suppress the Resized storm that fires during
    // Win11's animation (each Resized would otherwise trigger a D3D11
    // swapchain rebuild; 10+ in 300 ms reliably crashed mpv gpu-next,
    // per the comment on GEOMETRY_SYNC_MIN_INTERVAL). Fire-and-forget:
    // the main thread runs this on its next loop iteration.
    #[cfg(target_os = "windows")]
    {
        let app_for_sync = app.clone();
        let win_for_sync = main.clone();
        if let Err(e) = app.run_on_main_thread(move || {
            log::debug!("[player:cmd] set_fullscreen: early sync closure entered");
            let st = app_for_sync.state::<PlayerState>();
            match (win_for_sync.inner_position(), win_for_sync.inner_size()) {
                (Ok(pos), Ok(size)) => {
                    let (x, y, w, h) = (pos.x, pos.y, size.width as i32, size.height as i32);
                    log::info!("[player:cmd] set_fullscreen: early sync geometry ({},{},{}x{})", x, y, w, h);
                    st.apply_host_geometry(x, y, w, h);
                }
                _ => log::warn!("[player:cmd] set_fullscreen: failed to read geometry"),
            }
            let _ = win_for_sync.set_focus();
            log::debug!("[player:cmd] set_fullscreen: early sync closure done");
        }) {
            log::warn!("[player:cmd] set_fullscreen: early sync dispatch failed: {}", e);
        }
    }

    // Emit the authoritative fullscreen state immediately — the frontend
    // no longer needs to wait for the 350 ms settle. The early-sync
    // closure above has already pushed the host geometry to the correct
    // position, so React can update isFullscreen within one IPC round-trip.
    let actual_fs = main.is_fullscreen().unwrap_or(fullscreen);
    log::info!(
        "[player:cmd] set_fullscreen: emitting actual_fs={} immediately (before settle delay)",
        actual_fs
    );
    let _ = app.emit("player://fullscreen", actual_fs);

    // Keep the transition flag set during Win11's animation to suppress
    // the Resized event burst. Clear AFTER the settle delay so normal
    // drag-resize syncs resume. The video and the frontend are already
    // in sync — only the flag clear depends on this wait.
    log::debug!("[player:cmd] set_fullscreen: sleeping 350ms for settle (flag only)");
    tokio::time::sleep(std::time::Duration::from_millis(350)).await;
    state.set_fullscreen_transition(false);
    log::info!("[player:cmd] set_fullscreen: transition flag cleared after settle");

    fs_result
    };

    fs_result
}
