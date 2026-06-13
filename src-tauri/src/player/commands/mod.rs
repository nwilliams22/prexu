pub mod fullscreen;
pub mod minimize;
pub mod playback;
pub mod popout;
pub mod win32_monitor;

// Re-export so existing `player::commands::player_xxx` paths
// in lib.rs continue to work without edits to the handler list.
pub use fullscreen::*;
pub use minimize::*;
pub use playback::*;
pub use popout::*;
