//! Native child window that hosts mpv's video output (Windows-first).
//!
//! Architecture: a Win32 CHILD window of the Tauri main HWND (`WS_CHILD`).
//! mpv renders into this HWND via the `wid` property (set before
//! `mpv_initialize`).
//!
//! Why a child (not a sibling top-level): when the host is a child of the
//! Tauri main window, Win32 moves it together with the parent for free —
//! no event-driven sync needed on drag. Previously the host was a
//! `WS_POPUP` top-level repositioned on every `WindowEvent::Moved` via a
//! JS-style throttle (prexu-aqd / prexu-my6). Each throttled
//! `SetWindowPos` dropped frames during fast drags, leaving mpv visibly
//! lagging the chrome.
//!
//! Z-order: the WebView2 host window is also a child of the Tauri main
//! HWND. To make our transparent WebView composite over the mpv video,
//! `set_geometry` and the post-create anchor push our HWND to the bottom
//! of the child z-order with `HWND_BOTTOM` so the WebView renders on top.
//!
//! When the main window becomes always-on-top (pop-out), Win32
//! propagates the topmost flag to child windows automatically, so we no
//! longer need to flip `WS_EX_TOPMOST` on the host.

#![cfg(target_os = "windows")]

use std::sync::Once;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND};
use windows::Win32::Graphics::Gdi::CreateSolidBrush;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetWindow, RegisterClassExW, SetWindowPos,
    ShowWindow, CS_HREDRAW, CS_VREDRAW, GW_CHILD, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_SHOWNA, WNDCLASSEXW, WS_CHILD,
    WS_CLIPCHILDREN, WS_CLIPSIBLINGS,
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
    /// Create the host window as a `WS_CHILD` of the WebView2 container HWND
    /// inside the Tauri main window.
    ///
    /// The caller passes the Tauri main HWND. Empirically (verified on
    /// 2026-05-27), parenting mpv as a SIBLING of WebView2 under the main
    /// HWND leaves mpv invisible — WebView2 owns its compositor rectangle
    /// and does not honour transparency-through-to-sibling-below in the
    /// way DWM does for top-level windows. The visible chrome paints, the
    /// video does not, even though mpv reports first-frame ready and
    /// d3d11va is active.
    ///
    /// The fix: walk one level into the parent's child tree (`GetWindow(GW_CHILD)`),
    /// which on Tauri v2 + wry returns the WebView2 container HWND, and
    /// parent mpv inside that. mpv now lives INSIDE the WebView2 painting
    /// hierarchy, so the standard z-order rules apply and the transparent
    /// CSS area uncovers the video. If `GetWindow` returns null (unexpected),
    /// fall back to the original main HWND parent and log a warning — at
    /// worst we end up in the previous broken state, never in a crash.
    ///
    /// Initial geometry `(0,0,1280,720)` is in PARENT CLIENT-AREA
    /// coordinates — the first `set_geometry` call from `ensure_init`
    /// resizes to the real client rect.
    pub fn create(parent: HWND) -> Result<Self, String> {
        ensure_class_registered();

        // Resolve the actual parent: prefer the WebView2 inner child of
        // the supplied main HWND so the mpv host lives INSIDE the WebView2
        // compositor (see docblock above). Fall back to the main HWND if
        // the walk fails so we never panic on an unexpected window layout.
        let actual_parent = unsafe {
            match GetWindow(parent, GW_CHILD) {
                Ok(child) if !child.0.is_null() => {
                    log::debug!(
                        "[player:host] resolved WebView2 child HWND={:?} from main HWND={:?}",
                        child.0,
                        parent.0
                    );
                    child
                }
                Ok(_) => {
                    log::warn!(
                        "[player:host] GetWindow(GW_CHILD) returned null; falling back to main HWND={:?} (video may be invisible)",
                        parent.0
                    );
                    parent
                }
                Err(e) => {
                    log::warn!(
                        "[player:host] GetWindow(GW_CHILD) failed: {:?} — falling back to main HWND",
                        e
                    );
                    parent
                }
            }
        };

        log::debug!(
            "[player:host] CreateWindowExW WS_CHILD parent={:?} (main={:?}) initial=1280x720",
            actual_parent.0,
            parent.0
        );
        let hwnd = unsafe {
            CreateWindowExW(
                Default::default(),
                CLASS_NAME,
                w!("Prexu MPV Host"),
                // WS_CHILD: clipped to parent's client area, moves with
                // parent for free. NOT WS_VISIBLE — we leave it hidden
                // until `ensure_init` sizes the host to the real client
                // rect, otherwise the initial 1280x720 placeholder would
                // flash against the navy hbrBackground in the corner of
                // the parent before sync_geometry catches up.
                WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                0,
                0,
                1280,
                720,
                Some(actual_parent),
                None,
                None,
                None,
            )
        }
        .map_err(|e| format!("CreateWindowExW failed: {:?}", e))?;

        log::info!(
            "[player:host] HostWindow::create HWND={:?}, parent={:?} (main={:?})",
            hwnd.0,
            actual_parent.0,
            parent.0
        );

        // Push to bottom of child z-order so WebView2 siblings (if any
        // inside the WebView2 container) render on top of the mpv video.
        log::debug!(
            "[player:host] SetWindowPos HWND_BOTTOM HWND={:?}",
            hwnd.0
        );
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_BOTTOM),
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

    /// Move + resize the host within the parent's CLIENT-AREA in physical
    /// pixels. `(x, y)` is relative to the parent's client origin —
    /// `(0, 0)` for the full client area, or the mini-inset offset when
    /// in minimize mode. Skips the Win32 call when width or height is
    /// zero (e.g. minimized Tauri main window).
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

    /// Show or hide the host window without destroying it.
    ///
    /// Uses `SW_SHOWNA` ("Show Without Activation") rather than `SW_SHOW`
    /// to avoid stealing focus from the WebView2 sibling. Called once
    /// from `ensure_init` after the first `set_geometry` so the host
    /// only appears at its real size, never at the 1280x720 creation
    /// placeholder.
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
