//! Explicit failures until macOS windowing parity is implemented.
//! The frontend capability flags keep these controls disabled.

#[tauri::command]
pub async fn player_enter_popout() -> Result<(), String> {
    Err(crate::player::MACOS_UNAVAILABLE_REASON.into())
}

#[tauri::command]
pub async fn player_exit_popout() -> Result<(), String> {
    Err(crate::player::MACOS_UNAVAILABLE_REASON.into())
}

#[tauri::command]
pub async fn player_enter_minimize() -> Result<(), String> {
    Err(crate::player::MACOS_UNAVAILABLE_REASON.into())
}

#[tauri::command]
pub async fn player_exit_minimize() -> Result<(), String> {
    Err(crate::player::MACOS_UNAVAILABLE_REASON.into())
}

#[tauri::command]
pub async fn player_update_mini_geometry() -> Result<(), String> {
    Err(crate::player::MACOS_UNAVAILABLE_REASON.into())
}
