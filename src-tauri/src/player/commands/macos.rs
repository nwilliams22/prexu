//! Explicit failures until macOS windowing parity is implemented.
//! The frontend capability flags keep these controls disabled.

#[tauri::command]
pub async fn player_enter_popout() -> Result<(), String> {
    log::info!("[player:cmd] popout rejected: unavailable on macOS");
    Err("Popout is not supported on macOS".into())
}

#[tauri::command]
pub async fn player_exit_popout() -> Result<(), String> {
    log::info!("[player:cmd] popout rejected: unavailable on macOS");
    Err("Popout is not supported on macOS".into())
}
