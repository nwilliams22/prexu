// Cross-platform (Windows + Linux native player):
pub mod fullscreen;
pub mod playback;

// Win32-only window-hosting commands (minimize / pop-out / monitor geometry).
// Not registered on Linux — GTK's single-surface compositing has no separate
// host window to reposition (prexu-axj4.3).
#[cfg(target_os = "windows")]
pub mod minimize;
#[cfg(target_os = "windows")]
pub mod popout;
#[cfg(target_os = "windows")]
pub mod win32_monitor;

// Re-export so existing `player::commands::player_xxx` paths
// in lib.rs continue to work without edits to the handler list.
pub use fullscreen::*;
pub use playback::*;
#[cfg(target_os = "windows")]
pub use minimize::*;
#[cfg(target_os = "windows")]
pub use popout::*;
