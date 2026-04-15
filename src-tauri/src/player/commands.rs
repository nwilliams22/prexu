//! Tauri commands exposing the native player to the React frontend.
//!
//! Phase 1: every command returns `Err("not_implemented")`. The real bodies
//! land with the libmpv FFI wiring commit. Signatures are finalised here so
//! the frontend can be built against the same invoke contract in parallel.

use std::collections::HashMap;

use tauri::State;

use super::PlayerState;

const NOT_IMPLEMENTED: &str = "native player FFI not yet implemented";

#[tauri::command]
pub async fn player_load_url(
    _url: String,
    _headers: HashMap<String, String>,
    _start_offset_ms: Option<u64>,
    _state: State<'_, PlayerState>,
) -> Result<(), String> {
    Err(NOT_IMPLEMENTED.into())
}

#[tauri::command]
pub async fn player_play(_state: State<'_, PlayerState>) -> Result<(), String> {
    Err(NOT_IMPLEMENTED.into())
}

#[tauri::command]
pub async fn player_pause(_state: State<'_, PlayerState>) -> Result<(), String> {
    Err(NOT_IMPLEMENTED.into())
}

#[tauri::command]
pub async fn player_seek(
    _seconds: f64,
    _state: State<'_, PlayerState>,
) -> Result<(), String> {
    Err(NOT_IMPLEMENTED.into())
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
