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
    state.ensure_init(&app)?;

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
    state.with_mpv(|mpv| mpv.set_property("pause", false))
}

#[tauri::command]
pub async fn player_pause(state: State<'_, PlayerState>) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("pause", true))
}

#[tauri::command]
pub async fn player_seek(
    seconds: f64,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
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
    state.with_mpv(|mpv| mpv.set_property("volume", vol as f64))
}

#[tauri::command]
pub async fn player_set_muted(
    muted: bool,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    state.with_mpv(|mpv| mpv.set_property("mute", muted))
}

#[tauri::command]
pub async fn player_set_audio_track(
    id: Option<i64>,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
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
    let chain = match preset.as_str() {
        "off" => "",
        "light" => "lavfi=[loudnorm=I=-16:TP=-1.5:LRA=11]",
        "night" => "lavfi=[acompressor=threshold=-20dB:ratio=4:attack=5:release=50,loudnorm=I=-18]",
        other => return Err(format!("unknown af preset: {}", other)),
    };
    state.with_mpv(|mpv| mpv.set_property("af", chain))
}

#[tauri::command]
pub async fn player_unload(state: State<'_, PlayerState>) -> Result<(), String> {
    state.destroy()
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
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    state.set_fullscreen_transition(true);
    let fs_result = main
        .set_fullscreen(fullscreen)
        .map_err(|e| format!("set_fullscreen failed: {}", e));

    // 350 ms covers Win11's animated fullscreen transition plus the
    // Resized burst that follows. Bumped from 300 after empirical hang.
    tokio::time::sleep(std::time::Duration::from_millis(350)).await;

    // Clear the transition flag. Once cleared, the next Resized event
    // from the window event handler (lib.rs) will call sync_geometry
    // which applies the correct fullscreen dimensions via SetWindowPos.
    // This is the same codepath as drag resize — proven to work.
    //
    // Previously we tried calling force_sync_geometry inside
    // run_on_main_thread, but SetWindowPos sends WM_SIZE synchronously
    // which deadlocked the main thread.
    state.set_fullscreen_transition(false);
    log::info!("[player] fullscreen transition flag cleared — next Resized event will sync geometry");

    // Bring the Tauri main window back to front after the transition.
    let _ = main.set_focus();

    // Emit the authoritative fullscreen state back to the frontend so
    // React's isFullscreen stays in sync even when ESC or other OS gestures
    // exit fullscreen without going through toggleFullscreen().
    let actual_fs = main.is_fullscreen().unwrap_or(fullscreen);
    let _ = app.emit("player://fullscreen", actual_fs);

    fs_result
}
