//! Tauri commands exposing the native player to the React frontend.
//!
//! Phase 1 step 1.4: load_url/play/pause/seek wired through to libmpv.
//! Volume, mute, track selection, audio delay/chain still stubbed (step 1.6).

use std::collections::HashMap;

use tauri::State;

use super::PlayerState;

const NOT_IMPLEMENTED: &str = "native player FFI not yet implemented";

#[tauri::command]
pub async fn player_load_url(
    url: String,
    headers: HashMap<String, String>,
    start_offset_ms: Option<u64>,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    state.ensure_init()?;

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
    _vol: u16,
    _state: State<'_, PlayerState>,
) -> Result<(), String> {
    Err(NOT_IMPLEMENTED.into())
}

#[tauri::command]
pub async fn player_set_muted(
    _muted: bool,
    _state: State<'_, PlayerState>,
) -> Result<(), String> {
    Err(NOT_IMPLEMENTED.into())
}

#[tauri::command]
pub async fn player_set_audio_track(
    _id: Option<i64>,
    _state: State<'_, PlayerState>,
) -> Result<(), String> {
    Err(NOT_IMPLEMENTED.into())
}

#[tauri::command]
pub async fn player_set_sub_track(
    _id: Option<i64>,
    _state: State<'_, PlayerState>,
) -> Result<(), String> {
    Err(NOT_IMPLEMENTED.into())
}

#[tauri::command]
pub async fn player_set_audio_delay_ms(
    _ms: i32,
    _state: State<'_, PlayerState>,
) -> Result<(), String> {
    Err(NOT_IMPLEMENTED.into())
}

/// Audio filter-chain preset. Valid values: `"off"`, `"light"`, `"night"`.
#[tauri::command]
pub async fn player_set_af_chain(
    _preset: String,
    _state: State<'_, PlayerState>,
) -> Result<(), String> {
    Err(NOT_IMPLEMENTED.into())
}

#[tauri::command]
pub async fn player_unload(state: State<'_, PlayerState>) -> Result<(), String> {
    state.destroy()
}
