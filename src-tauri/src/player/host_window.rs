//! Native child window that hosts mpv's video output (Windows-first).
//!
//! Phase 2 step 2.2 — real `CreateWindowExW` + `DestroyWindow`. mpv renders
//! into this HWND via the `wid` property (set before `mpv_initialize`).
//!
//! Architecture: a sibling top-level window with `WS_POPUP` (no chrome) and
//! `WS_EX_NOACTIVATE` (doesn't steal focus from the Tauri main window).
//! Z-order is anchored behind the Tauri main window via `SetWindowPos` so
//! the webview overlays the video region.

#![cfg(target_os = "windows")]

use std::sync::Once;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND};
use windows::Win32::Graphics::Gdi::CreateSolidBrush;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassExW, SetWindowPos, ShowWindow,
    CS_HREDRAW, CS_VREDRAW, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_SHOWNA, WNDCLASSEXW, WS_CLIPCHILDREN,
    WS_CLIPSIBLINGS, WS_EX_NOACTIVATE, WS_POPUP,
};

const CLASS_NAME: PCWSTR = w!("PrexuMpvHost");
static REGISTER_CLASS: Once = Once::new();

/// Bare WndProc — mpv creates its own child inside this HWND when given
/// `wid`, so the parent container only needs the default behaviour.
unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wp: windows::Win32::Foundation::WPARAM,
    lp: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
}

fn ensure_class_registered() {
    REGISTER_CLASS.call_once(|| unsafe {
        let class = WNDCLASSEXW {
            cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wnd_proc),
            lpszClassName: CLASS_NAME,
            // Solid brush matching the app's --bg-primary navy (#1a1a2e, BGR
            // 0x002e1a1a). Using the navy colour avoids a visible rim around
            // the video in mini-mode and blends with the surrounding chrome.
            // Leaks for app lifetime — acceptable for a once-per-process
            // class registration.
            hbrBackground: CreateSolidBrush(COLORREF(0x002e_1a1a)),
            ..Default::default()
        };
        let _ = RegisterClassExW(&class);
    });
}

/// Owns the native HWND that mpv renders into.
///
/// Win32 windows are thread-affine for message processing, but we only ever
/// create / destroy / resize from the main thread. `Send` is sound because
/// the underlying handle is a kernel id — passing it across threads is fine
/// as long as we don't *call* into Win32 from the wrong thread, which the
/// PlayerState design enforces.
pub struct HostWindow {
    hwnd: HWND,
}

unsafe impl Send for HostWindow {}

impl HostWindow {
    /// Create the host window as a sibling top-level. `parent` is the Tauri
    /// main-window HWND used only for z-order anchoring (not Win32 parent).
    pub fn create(parent: HWND) -> Result<Self, String> {
        ensure_class_registered();

        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_NOACTIVATE,
                CLASS_NAME,
                w!("Prexu MPV Host"),
                WS_POPUP | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                0,
                0,
                1280,
                720,
                None,
                None,
                None,
                None,
            )
        }
        .map_err(|e| format!("CreateWindowExW failed: {:?}", e))?;

        log::info!("[player:host] HostWindow::create HWND={:?}, parent={:?}", hwnd.0, parent.0);

        // Place mpv host directly under the Tauri main window in z-order so
        // the webview overlays it.
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                Some(parent),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }

        Ok(Self { hwnd })
    }

    pub fn hwnd_as_i64(&self) -> i64 {
        (self.hwnd.0 as usize as u32) as i64
    }

    /// Re-anchor z-order so this window sits directly behind `parent`.
    /// Called after `set_visible` to guarantee the host stays below the
    /// Tauri main window even if `ShowWindow` perturbed z-order despite
    /// `WS_EX_NOACTIVATE` / `SW_SHOWNA`.
    pub fn anchor_below(&self, parent: HWND) -> Result<(), String> {
        unsafe {
            SetWindowPos(
                self.hwnd,
                Some(parent),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
        }
        .map_err(|e| format!("anchor_below SetWindowPos failed: {:?}", e))
    }

    /// Move + resize the host window in screen pixels (client-area coords).
    /// Skips the Win32 call when width or height is zero (e.g. minimized
    /// Tauri main window) — last good geometry is preserved instead.
    pub fn set_geometry(&self, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
        if width <= 0 || height <= 0 {
            log::trace!("[player:host] set_geometry skipped — zero dim ({}x{})", width, height);
            return Ok(());
        }
        log::debug!("[player:host] set_geometry({},{},{}x{}) HWND={:?}", x, y, width, height, self.hwnd.0);
        unsafe {
            SetWindowPos(
                self.hwnd,
                None,
                x,
                y,
                width,
                height,
                SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER,
            )
        }
        .map_err(|e| format!("SetWindowPos failed: {:?}", e))
    }

    /// Toggle this window's WS_EX_TOPMOST flag via SetWindowPos.
    ///
    /// The host is a sibling top-level window of the Tauri main window, so
    /// `WebviewWindow::set_always_on_top(true)` on main does NOT make the host
    /// topmost — without this, pop-out mode shows the WebView overlay
    /// floating above other apps while the actual video sits underneath them.
    /// After flipping topmost on, callers should re-anchor the host below
    /// the main window in z-order so the WebView still overlays the video
    /// region.
    pub fn set_topmost(&self, topmost: bool) -> Result<(), String> {
        let after = if topmost { HWND_TOPMOST } else { HWND_NOTOPMOST };
        log::debug!(
            "[player:host] set_topmost({}) HWND={:?}",
            topmost, self.hwnd.0
        );
        unsafe {
            SetWindowPos(
                self.hwnd,
                Some(after),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
        }
        .map_err(|e| format!("set_topmost SetWindowPos failed: {:?}", e))
    }

    /// Show or hide the host window without destroying it.
    ///
    /// Uses `SW_SHOWNA` ("Show Without Activation") rather than `SW_SHOW`.
    /// `SW_SHOW` activates the window programmatically, which can bring it
    /// to the top of the z-order and steal input focus even from a window
    /// created with `WS_EX_NOACTIVATE` — that ex-style only blocks *user*
    /// activation (clicks), not programmatic. When this call runs on a
    /// thread that pumps Win32 messages (our main thread after moving host
    /// ownership there), `SW_SHOW` would cover the WebView and capture
    /// keyboard focus, leading to a black screen and unresponsive app.
    #[allow(dead_code)]
    pub fn set_visible(&self, visible: bool) -> Result<(), String> {
        log::debug!("[player:host] set_visible({}) HWND={:?}", visible, self.hwnd.0);
        let cmd = if visible { SW_SHOWNA } else { SW_HIDE };
        unsafe {
            let _ = ShowWindow(self.hwnd, cmd);
        }
        Ok(())
    }
}

impl Drop for HostWindow {
    fn drop(&mut self) {
        log::info!("[player:host] Drop — DestroyWindow HWND={:?}", self.hwnd.0);
        unsafe {
            let _ = DestroyWindow(self.hwnd);
        }
    }
}
