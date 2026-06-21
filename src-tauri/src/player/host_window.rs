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
use windows::Win32::Foundation::{COLORREF, HWND, RECT};
use windows::Win32::Graphics::Gdi::CreateSolidBrush;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetClientRect, RegisterClassExW, SetWindowPos,
    ShowWindow, CS_HREDRAW, CS_VREDRAW, HWND_NOTOPMOST, HWND_TOP, HWND_TOPMOST, SWP_NOACTIVATE,
    SWP_NOCOPYBITS, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_SHOWNA,
    WNDCLASSEXW, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_EX_NOACTIVATE, WS_POPUP,
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
    /// Path A spike (prexu-ga3x.1): when `Some`, this host is a real Win32
    /// `WS_CHILD` of the main window (true parent), not a z-anchored
    /// `WS_POPUP` sibling. In child mode `set_geometry` fills the parent's
    /// client rect (child coords are parent-relative) and z/anchor/topmost
    /// ops become no-ops. Gated by env `PREXU_MPV_CHILD`; default builds keep
    /// `None` and the shipping popup behaviour is unchanged.
    child_parent: Option<HWND>,
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

        Ok(Self { hwnd, child_parent: None })
    }

    /// Path A spike (prexu-ga3x.1): create the host as a real `WS_CHILD` of
    /// the Tauri main window so its pixels become part of the main window's
    /// DWM-composed surface — the prerequisite for Alt+Tab / WGC capture to
    /// include the video. Gated by env `PREXU_MPV_CHILD`.
    ///
    /// KNOWN TRADE-OFF (Win32 airspace): a child HWND does not alpha-blend
    /// with its sibling (wry's WebView2 container). This host is created
    /// last, so it stacks ABOVE the webview and the React controls are hidden
    /// where it covers them. The spike validates capture inclusion only; it
    /// is NOT a shippable overlay (that requires the Path C single-surface
    /// DComp rewrite). Geometry fills the parent client rect.
    pub fn create_child(parent: HWND) -> Result<Self, String> {
        ensure_class_registered();

        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_NOACTIVATE,
                CLASS_NAME,
                w!("Prexu MPV Host (child)"),
                WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN,
                0,
                0,
                1280,
                720,
                Some(parent),
                None,
                None,
                None,
            )
        }
        .map_err(|e| format!("CreateWindowExW (child) failed: {:?}", e))?;

        log::info!(
            "[player:host] HostWindow::create_child HWND={:?}, WS_CHILD parent={:?}",
            hwnd.0, parent.0
        );

        Ok(Self { hwnd, child_parent: Some(parent) })
    }

    /// True when this host is a `WS_CHILD` of the main window (spike mode).
    pub fn is_child(&self) -> bool {
        self.child_parent.is_some()
    }

    /// Path A spike (prexu-ga3x.1): raise this child ABOVE its siblings
    /// (wry's WebView2 container) so mpv's pixels paint over the webview.
    /// This intentionally hides the React controls — the test isolates the
    /// linchpin question: does a *visible* child HWND appear in the main
    /// window's Alt+Tab / WGC capture? (Overlay is impossible with siblings
    /// regardless — that needs Path C.)
    pub fn raise_to_top(&self) -> Result<(), String> {
        log::debug!("[player:host] raise_to_top(child) HWND={:?}", self.hwnd.0);
        unsafe {
            SetWindowPos(
                self.hwnd,
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
        }
        .map_err(|e| format!("raise_to_top SetWindowPos failed: {:?}", e))
    }

    pub fn hwnd_as_i64(&self) -> i64 {
        (self.hwnd.0 as usize as u32) as i64
    }

    /// Re-anchor z-order so this window sits directly behind `parent`.
    /// Called after `set_visible` to guarantee the host stays below the
    /// Tauri main window even if `ShowWindow` perturbed z-order despite
    /// `WS_EX_NOACTIVATE` / `SW_SHOWNA`.
    pub fn anchor_below(&self, parent: HWND) -> Result<(), String> {
        if self.child_parent.is_some() {
            // Child mode: z-order is managed by the parent's composition;
            // anchoring a child relative to its own parent is invalid.
            return Ok(());
        }
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
    ///
    /// `SWP_NOCOPYBITS` instructs the system to discard the host's prior
    /// client-area pixels on the resize instead of bit-blitting them
    /// stretched into the new rect. Without this flag, width-resize
    /// produces a visible ghost: Win32 stretches the old frame to the
    /// new dimensions, mpv's vo overpaints on its next swap-chain
    /// present (~display refresh), and the gap between the two is the
    /// ghost the user sees (prexu-aqd follow-up 2026-05-27). With the
    /// flag, mpv's present is the first paint at the new size; brief
    /// blank possible but no ghost.
    pub fn set_geometry(&self, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
        // Child mode (spike): coords are parent-relative. Ignore the
        // screen-space geometry the sync engine feeds and instead fill the
        // parent's client rect at (0,0). Keeps the video full-window while
        // the host is embedded; the sync engine still drives WHEN we resize.
        if let Some(parent) = self.child_parent {
            let mut rc = RECT::default();
            unsafe { GetClientRect(parent, &mut rc) }
                .map_err(|e| format!("GetClientRect(parent) failed: {:?}", e))?;
            let (cw, ch) = (rc.right - rc.left, rc.bottom - rc.top);
            if cw <= 0 || ch <= 0 {
                return Ok(());
            }
            log::debug!("[player:host] set_geometry(child) fill parent client {}x{} HWND={:?}", cw, ch, self.hwnd.0);
            return unsafe {
                SetWindowPos(
                    self.hwnd,
                    None,
                    0,
                    0,
                    cw,
                    ch,
                    SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOCOPYBITS,
                )
            }
            .map_err(|e| format!("SetWindowPos (child) failed: {:?}", e));
        }
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
                SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOCOPYBITS,
            )
        }
        .map_err(|e| format!("SetWindowPos failed: {:?}", e))
    }

    /// Move the host without touching its size. Used by the move-only
    /// fast path in `PlayerState::sync_geometry_move` so that pure
    /// WM_MOVE bursts (window drag) don't trigger mpv's D3D11 swapchain
    /// rebuild — only WM_SIZE does (prexu-aqd). `SWP_NOSIZE` makes
    /// SetWindowPos a position-only operation, materially cheaper than
    /// a full set_geometry call and safe to dispatch at 60+ Hz without
    /// starving the Win32 message queue.
    pub fn set_position(&self, x: i32, y: i32) -> Result<(), String> {
        // Child mode: position is fixed at parent client origin; re-fill on
        // any move so a parent resize-during-drag keeps the video covering.
        if self.child_parent.is_some() {
            return self.set_geometry(0, 0, 0, 0);
        }
        log::trace!("[player:host] set_position({},{}) HWND={:?}", x, y, self.hwnd.0);
        unsafe {
            SetWindowPos(
                self.hwnd,
                None,
                x,
                y,
                0,
                0,
                SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER,
            )
        }
        .map_err(|e| format!("SetWindowPos (move-only) failed: {:?}", e))
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
        if self.child_parent.is_some() {
            // Child mode: a child cannot be independently topmost; it follows
            // the parent. Pop-out behaviour is out of scope for the spike.
            return Ok(());
        }
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

/// Conformance impl so the geometry sync engine's [`HostSurface`] interface
/// (exercised against a recording fake in `geometry.rs` tests) is backed by
/// the real window. Delegates to the inherent `SetWindowPos` methods; the
/// hot path in `mod.rs` still calls those inherent methods directly.
/// Test-only: the trait exists purely to keep the tested call sequence
/// honest against the real type.
#[cfg(test)]
impl super::geometry::HostSurface for HostWindow {
    fn set_geometry(&self, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
        HostWindow::set_geometry(self, x, y, width, height)
    }
    fn set_position(&self, x: i32, y: i32) -> Result<(), String> {
        HostWindow::set_position(self, x, y)
    }
}
