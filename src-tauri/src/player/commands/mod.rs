// Cross-platform (Windows + Linux native player):
pub mod fullscreen;
pub mod playback;

// In-window minimize (prexu-axj4.5): Windows repositions a separate Win32
// host window; Linux has no separate host window (GTK composites video and
// WebView on one surface) so it insets mpv's own video area via the
// `video-margin-ratio-*` properties instead — see `player::linux_compositor`.
// Both platforms share the pure `compute_minimize_state` defaulting logic.
#[cfg(any(target_os = "windows", target_os = "linux"))]
pub mod minimize;

// Pop-out (a floating, always-on-top mini window). Cross-platform since
// prexu-axj4.10: Windows drives Win32 geometry + monitor persistence via
// `win32_monitor`; Linux morphs the main window through Tauri/GTK ops (the
// GLArea render target follows the allocation, no host resync needed).
#[cfg(any(target_os = "windows", target_os = "linux"))]
pub mod popout;
#[cfg(target_os = "windows")]
pub mod win32_monitor;

// Re-export so existing `player::commands::player_xxx` paths
// in lib.rs continue to work without edits to the handler list.
pub use fullscreen::*;
pub use playback::*;
#[cfg(any(target_os = "windows", target_os = "linux"))]
pub use minimize::*;
#[cfg(any(target_os = "windows", target_os = "linux"))]
pub use popout::*;
