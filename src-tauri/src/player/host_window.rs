//! Native child window that hosts mpv's video output (Windows-first).
//!
//! Phase 2 step 2.1 — scaffold only. Bodies return `Err("not_implemented")`
//! or no-op safely; real Win32 calls land in step 2.2 (CreateWindowExW + mpv
//! `--wid` handoff) and step 2.4 (geometry sync via `SetWindowPos`).
//!
//! Architecture: a sibling top-level window (z-ordered behind the Tauri main
//! window) that owns its own HWND. mpv renders into this HWND via the `wid`
//! property. Window-group sync keeps geometry locked to the Tauri window.

#![cfg(target_os = "windows")]

use windows::Win32::Foundation::HWND;

/// Owns the native HWND that mpv renders into.
///
/// HWND is `*mut c_void` so this struct is `!Send + !Sync` by default. The
/// PlayerState wraps `Mpv` in `Arc` for cross-thread sharing; the HostWindow
/// stays on the main thread (Win32 windows are pinned to their creating
/// thread anyway — see MSDN docs on message queues).
pub struct HostWindow {
    hwnd: HWND,
}

impl HostWindow {
    /// Create the host window. `parent` is the HWND of the Tauri main window
    /// (used for z-order anchoring, not parent-child since we want a sibling
    /// top-level so the webview can overlay click-through regions).
    ///
    /// Step 2.1 stub.
    #[allow(unused_variables, dead_code)] // wired up in step 2.2
    pub fn create(parent: HWND) -> Result<Self, String> {
        Err("HostWindow::create not yet implemented (phase 2 step 2.2)".into())
    }

    /// Returns the raw HWND as an i64 for handing to mpv via
    /// `mpv.set_property("wid", host.hwnd_as_i64())`.
    #[allow(dead_code)] // wired up in step 2.2
    pub fn hwnd_as_i64(&self) -> i64 {
        self.hwnd.0 as i64
    }

    /// Move + resize the host window in screen coordinates.
    ///
    /// Step 2.1 stub.
    #[allow(unused_variables, dead_code)] // wired up in step 2.4
    pub fn set_geometry(&self, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
        Err("HostWindow::set_geometry not yet implemented (phase 2 step 2.4)".into())
    }

    /// Show or hide the host window without destroying it.
    ///
    /// Step 2.1 stub.
    #[allow(unused_variables, dead_code)] // wired up in step 2.7
    pub fn set_visible(&self, visible: bool) -> Result<(), String> {
        Err("HostWindow::set_visible not yet implemented (phase 2 step 2.7)".into())
    }
}

impl Drop for HostWindow {
    fn drop(&mut self) {
        // Real DestroyWindow call lands in step 2.2. Today the struct is
        // never constructed via a real `create()`, so Drop is unreachable.
    }
}
