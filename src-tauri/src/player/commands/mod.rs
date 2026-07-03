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

// Win32-only window-hosting commands (pop-out / monitor geometry). Pop-out
// (a floating, always-on-top mini window) has no Linux port yet — deferred
// to prexu-axj4.10; GTK's single-surface compositing has no separate host
// window to float/reposition the way `win32_monitor` does.
#[cfg(target_os = "windows")]
pub mod popout;
#[cfg(target_os = "windows")]
pub mod win32_monitor;

// Re-export so existing `player::commands::player_xxx` paths
// in lib.rs continue to work without edits to the handler list.
pub use fullscreen::*;
pub use playback::*;
#[cfg(any(target_os = "windows", target_os = "linux"))]
pub use minimize::*;
#[cfg(target_os = "windows")]
pub use popout::*;
