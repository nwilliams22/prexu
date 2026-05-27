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
            // Child-relative origin (prexu-my6): host is a WS_CHILD of main,
            // so coords are (0, 0, w, h) — the full client area is exactly
            // the parent's inner_size with no screen offset.
            match win_for_sync.inner_size() {
                Ok(size) => {
                    let (w, h) = (size.width as i32, size.height as i32);
                    log::info!("[player:cmd] set_fullscreen: early sync geometry (0,0,{}x{})", w, h);
                    st.apply_host_geometry(0, 0, w, h);
                }
                Err(_) => log::warn!("[player:cmd] set_fullscreen: failed to read geometry"),
            }
            let _ = win_for_sync.set_focus();
            log::debug!("[player:cmd] set_fullscreen: early sync closure done");
        }) {
            log::warn!("[player:cmd] set_fullscreen: early sync dispatch failed: {}", e);
        }
    }

    // Keep the transition flag set during Win11's animation to suppress
    // the Resized event burst. Clear afterwards so normal drag-resize
    // syncs work again. Still 350 ms — our video is no longer waiting on
    // this.
    log::debug!("[player:cmd] set_fullscreen: sleeping 350ms with flag set");
    tokio::time::sleep(std::time::Duration::from_millis(350)).await;
    state.set_fullscreen_transition(false);
    log::info!("[player:cmd] set_fullscreen: transition flag cleared");

    // Emit the authoritative fullscreen state back to the frontend so
    // React's isFullscreen stays in sync even when ESC or other OS gestures
    // exit fullscreen without going through toggleFullscreen().
    let actual_fs = main.is_fullscreen().unwrap_or(fullscreen);
    log::info!("[player:cmd] set_fullscreen: actual_fs={}, emitting", actual_fs);
    let _ = app.emit("player://fullscreen", actual_fs);

    fs_result
}
