//! Tauri commands exposing the native player to the React frontend.
//!
//! All commands wired through to libmpv (phase 1 steps 1.3, 1.4, 1.6 done).
//! Event-side reporting (time-pos, eof, …) lands with the event pump in 1.5.

use std::collections::HashMap;

use tauri::{AppHandle, Emitter, Manager, State};

use super::PlayerState;

#[tauri::command]
pub async fn player_load_url(
    url: String,
    headers: HashMap<String, String>,
    start_offset_ms: Option<u64>,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] load_url offset={}ms headers={}", start_offset_ms.unwrap_or(0), headers.len());
    state.ensure_init(&app)?;
    log::debug!("[player:cmd] load_url: ensure_init OK, sending loadfile");

    // mpv's `http-header-fields` takes a comma-separated list of "Name: Value"
    // entries. Plex headers (X-Plex-Token, X-Plex-Client-Identifier, …) don't
    // contain commas so naive joining is safe; if a value ever does contain a
    // comma we'd need to escape it as `\,` per the mpv string-list format.
    let header_str = headers
        .iter()
        .map(|(k, v)| format!("{}: {}", k, v))
        .collect::<Vec<_>>()
        .join(",");

    state.with_mpv(|mpv| {
        if !header_str.is_empty() {
            mpv.set_property("http-header-fields", header_str.as_str())?;
        }
        // 4th arg is comma-separated per-file options. `start=<seconds>` seeks
        // mpv to that offset on load (avoids a separate seek round-trip).
        let start_secs = start_offset_ms.map(|ms| ms as f64 / 1000.0).unwrap_or(0.0);
        let opts = format!("start={}", start_secs);
        mpv.command("loadfile", &[url.as_str(), "replace", "0", opts.as_str()])
    })
}

#[tauri::command]
pub async fn player_play(state: State<'_, PlayerState>) -> Result<(), String> {
    log::debug!("[player:cmd] play");
    state.with_mpv(|mpv| mpv.set_property("pause", false))
}

#[tauri::command]
pub async fn player_pause(state: State<'_, PlayerState>) -> Result<(), String> {
    log::debug!("[player:cmd] pause");
    state.with_mpv(|mpv| mpv.set_property("pause", true))
}

#[tauri::command]
pub async fn player_seek(
    seconds: f64,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] seek to {}s", seconds);
    state.with_mpv(|mpv| {
        let s = seconds.to_string();
        mpv.command("seek", &[s.as_str(), "absolute"])
    })
}

#[tauri::command]
pub async fn player_set_volume(
    vol: u16,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] set_volume {}", vol);
    state.with_mpv(|mpv| mpv.set_property("volume", vol as f64))
}

#[tauri::command]
pub async fn player_set_muted(
    muted: bool,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] set_muted {}", muted);
    state.with_mpv(|mpv| mpv.set_property("mute", muted))
}

#[tauri::command]
pub async fn player_set_audio_track(
    id: Option<i64>,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] set_audio_track {:?}", id);
    // mpv's `aid` accepts integer track ids OR the sentinel string "no".
    // libmpv2's set_property is monomorphic, so we branch at the call site.
    state.with_mpv(|mpv| match id {
        Some(track_id) => mpv.set_property("aid", track_id),
        None => mpv.set_property("aid", "no"),
    })
}

#[tauri::command]
pub async fn player_set_sub_track(
    id: Option<i64>,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] set_sub_track {:?}", id);
    state.with_mpv(|mpv| match id {
        Some(track_id) => mpv.set_property("sid", track_id),
        None => mpv.set_property("sid", "no"),
    })
}

#[tauri::command]
pub async fn player_set_audio_delay_ms(
    ms: i32,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] set_audio_delay {}ms", ms);
    // mpv's audio-delay is in seconds (f64), negatives allowed.
    let seconds = ms as f64 / 1000.0;
    state.with_mpv(|mpv| mpv.set_property("audio-delay", seconds))
}

/// Audio filter-chain preset. Valid values: `"off"`, `"light"`, `"night"`.
#[tauri::command]
pub async fn player_set_af_chain(
    preset: String,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] set_af_chain preset={}", preset);
    let chain = match preset.as_str() {
        "off" => "",
        "light" => "lavfi=[loudnorm=I=-16:TP=-1.5:LRA=11]",
        "night" => "lavfi=[acompressor=threshold=-20dB:ratio=4:attack=5:release=50,loudnorm=I=-18]",
        other => return Err(format!("unknown af preset: {}", other)),
    };
    state.with_mpv(|mpv| mpv.set_property("af", chain))
}

#[tauri::command]
pub async fn player_unload(
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] unload");
    state.destroy(&app)
}

/// Toggle the Tauri main window's fullscreen state.
///
/// 1. Set a transition flag so the on_window_event listener skips
///    sync_geometry during the animated transition (avoids the rapid
///    SetWindowPos storm that crashes mpv's gpu-next vo).
/// 2. Toggle Tauri fullscreen.
/// 3. Wait for the transition to settle.
/// 4. Clear the flag, then dispatch a single explicit sync onto the
///    main thread (Win32 windows are thread-affine; cross-thread
///    SetWindowPos uses SendMessage and can be flaky during transient
///    states like fullscreen entry).
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
