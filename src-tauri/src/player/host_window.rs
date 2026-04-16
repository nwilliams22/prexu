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
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH, HBRUSH};
use windows::Win32::Foundation::LPARAM;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetWindow, PostMessageW, RegisterClassExW,
    SetWindowPos, ShowWindow, CS_HREDRAW, CS_VREDRAW, GW_CHILD, SET_WINDOW_POS_FLAGS,
    SIZE_RESTORED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER,
    SW_HIDE, SW_SHOW, WM_SIZE, WNDCLASSEXW, WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
    WS_EX_NOACTIVATE, WS_POPUP,
};

/// SWP_ASYNCWINDOWPOS (0x4000) — if calling thread and owner thread have
/// different input queues, Windows posts the request asynchronously. Avoids
/// blocking the main thread when resizing mpv's child (owned by mpv's thread).
const SWP_ASYNCWINDOWPOS: SET_WINDOW_POS_FLAGS = SET_WINDOW_POS_FLAGS(0x4000);

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
            // BLACK_BRUSH avoids a white flash before mpv attaches its child.
            hbrBackground: HBRUSH(GetStockObject(BLACK_BRUSH).0),
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

    /// Move + resize the host window in screen pixels (client-area coords).
    /// Skips the Win32 call when width or height is zero (e.g. minimized
    /// Tauri main window) — last good geometry is preserved instead.
    pub fn set_geometry(&self, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
        if width <= 0 || height <= 0 {
            return Ok(());
        }
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

    /// Post a WM_SIZE message to the host window. This is fully
    /// non-blocking — the message is queued and processed on the next
    /// message pump cycle. mpv detects the size change through its
    /// window subclass and rebuilds the D3D11 swapchain asynchronously.
    ///
    /// This replaces both the synchronous SetWindowPos approach (which
    /// deadlocked the main thread inside run_on_main_thread closures)
    /// and the resize_children approach (child window may not exist if
    /// mpv renders directly into the host HWND).
    pub fn post_resize(&self, width: i32, height: i32) {
        let lparam = LPARAM(((height as isize) << 16) | (width as isize & 0xFFFF));
        unsafe {
            let _ = PostMessageW(
                Some(self.hwnd),
                WM_SIZE,
                windows::Win32::Foundation::WPARAM(SIZE_RESTORED as usize),
                lparam,
            );
        }
        log::info!(
            "[player] post_resize: posted WM_SIZE {}x{} to host {:?}",
            width, height, self.hwnd.0
        );
    }

    /// Show or hide the host window without destroying it.
    #[allow(dead_code)]
    pub fn set_visible(&self, visible: bool) -> Result<(), String> {
        let cmd = if visible { SW_SHOW } else { SW_HIDE };
        unsafe {
            let _ = ShowWindow(self.hwnd, cmd);
        }
        Ok(())
    }
}

impl Drop for HostWindow {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.hwnd);
        }
    }
}
