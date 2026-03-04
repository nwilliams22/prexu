use tauri_plugin_log::{Target, TargetKind};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                .max_file_size(5_000_000) // 5 MB per log file
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            // Show the main window after window-state has restored
            // size/position/fullscreen. The window starts hidden
            // (visible: false in tauri.conf.json) to avoid the flash
            // of default size before state restoration.
            if let Some(window) = app.get_webview_window("main") {
                window.show().unwrap_or_default();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
