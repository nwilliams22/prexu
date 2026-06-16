//! Custom DWM iconic bitmaps so the alt-tab tile and taskbar hover preview
//! show the playing video instead of a black rectangle (prexu-2k7p).
//!
//! Why this is needed: mpv renders into a *separate* sibling top-level HWND
//! anchored behind the Tauri main window (see `host_window.rs`); the webview
//! punches a transparent hole so the video shows through on screen. DWM's
//! per-window thumbnail, however, snapshots only the main window's own
//! redirection surface — the transparent hole composites to black. There is
//! no way to make DWM capture the sibling window into the main window's
//! thumbnail without breaking the webview-overlays-video architecture.
//!
//! The fix is the Windows-native escape hatch for exactly this "airspace"
//! problem: tell DWM the window provides its own iconic representation
//! (`DWMWA_HAS_ICONIC_BITMAP`), force it to use that representation even when
//! the window isn't minimised (`DWMWA_FORCE_ICONIC_REPRESENTATION`, toggled on
//! only while mpv is alive), and answer DWM's pull requests:
//!   - `WM_DWMSENDICONICTHUMBNAIL`   → one scaled frame (alt-tab tile).
//!   - `WM_DWMSENDICONICLIVEPREVIEW` → a frame for the taskbar/Aero-Peek hover.
//! A ~10 Hz `DwmInvalidateIconicBitmaps` heartbeat (only while playing) makes
//! the live preview update so the user can watch by hovering, like VLC/Plex.
//! Invalidation is pull-based: DWM only re-requests a bitmap while one is
//! actually on screen, so the heartbeat costs a frame grab only during a peek.
//!
//! Frames come from mpv's `screenshot-raw` (`video`), which returns a BGRA-ish
//! buffer we copy into a top-down DIB. All Win32/GDI work runs on the UI
//! thread inside the window subclass proc.

#![cfg(target_os = "windows")]

use std::cell::Cell;
use std::ffi::{c_void, CStr, CString};
use std::ptr;

use tauri::{AppHandle, Manager, WebviewWindow};
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmInvalidateIconicBitmaps, DwmSetIconicLivePreviewBitmap, DwmSetIconicThumbnail,
    DwmSetWindowAttribute, DWMWA_FORCE_ICONIC_REPRESENTATION, DWMWA_HAS_ICONIC_BITMAP,
};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, SetStretchBltMode,
    StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, HBITMAP, HDC,
    HGDIOBJ, SRCCOPY,
};
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{KillTimer, SetTimer, WM_NCDESTROY, WM_TIMER};

use crate::player::PlayerState;

// DWM iconic pull messages — not exported by the windows crate (winuser.h).
const WM_DWMSENDICONICTHUMBNAIL: u32 = 0x0323;
const WM_DWMSENDICONICLIVEPREVIEW: u32 = 0x0326;

const SUBCLASS_ID: usize = 0x9215_AB01;
const TIMER_ID: usize = 0x9215_AB02;
/// Live-preview refresh cadence (~10 fps). Only triggers a frame grab while a
/// peek is actually on screen (DWM re-requests on invalidation only then).
const TIMER_MS: u32 = 100;
/// Cap the live-preview bitmap's longest side to bound per-frame cost; DWM
/// scales it to the window outline on screen anyway.
const LIVE_MAX_DIM: i32 = 1280;
/// App `--bg-primary` navy (#1a1a2e) as opaque BGRA, used to letterbox the
/// video and as the fallback card when no frame is available.
const NAVY: [u8; 4] = [0x2e, 0x1a, 0x1a, 0xff];

/// A captured mpv frame: tightly packed `w*h*4`, top-down, BGRA, alpha = 0xFF.
pub struct RawFrame {
    pub w: i32,
    pub h: i32,
    pub bgra: Vec<u8>,
}

/// Per-window subclass state, owned via the subclass `dwRefData` pointer and
/// freed on `WM_NCDESTROY`.
struct PreviewState {
    app: AppHandle,
    /// Whether `DWMWA_FORCE_ICONIC_REPRESENTATION` is currently TRUE. Tracked
    /// so the heartbeat only calls `DwmSetWindowAttribute` on transitions.
    forced: Cell<bool>,
}

/// Register the main window for custom DWM iconic bitmaps and install the
/// subclass + heartbeat timer. Idempotent per window. Must be called on the
/// UI thread (it is, from the Tauri `setup` closure).
pub fn enable(window: &WebviewWindow, app: AppHandle) {
    let hwnd = match window.hwnd() {
        Ok(h) => h,
        Err(e) => {
            log::warn!("[player:preview] enable skipped — no HWND: {}", e);
            return;
        }
    };

    let state = Box::into_raw(Box::new(PreviewState {
        app,
        forced: Cell::new(false),
    }));

    unsafe {
        // Advertise that we supply iconic bitmaps. FORCE is toggled on by the
        // heartbeat only while mpv is alive, so idle thumbnails stay the real
        // (non-black) webview snapshot.
        let yes = BOOL(1);
        if let Err(e) = DwmSetWindowAttribute(
            hwnd,
            DWMWA_HAS_ICONIC_BITMAP,
            &yes as *const _ as *const c_void,
            std::mem::size_of::<BOOL>() as u32,
        ) {
            log::warn!("[player:preview] DWMWA_HAS_ICONIC_BITMAP failed: {:?}", e);
        }

        if !SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, state as usize).as_bool() {
            log::error!("[player:preview] SetWindowSubclass failed");
            drop(Box::from_raw(state));
            return;
        }

        // Heartbeat: drives FORCE toggling + live-preview invalidation.
        SetTimer(Some(hwnd), TIMER_ID, TIMER_MS, None);
    }

    log::info!("[player:preview] enabled iconic DWM previews on HWND={:?}", hwnd.0);
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    refdata: usize,
) -> LRESULT {
    let state = refdata as *const PreviewState;

    match msg {
        WM_TIMER if wparam.0 == TIMER_ID => {
            if !state.is_null() {
                heartbeat(hwnd, &*state);
            }
            return LRESULT(0);
        }
        WM_DWMSENDICONICTHUMBNAIL => {
            if !state.is_null() {
                // HIWORD = max width, LOWORD = max height (physical px).
                let max_w = ((lparam.0 >> 16) & 0xFFFF) as i32;
                let max_h = (lparam.0 & 0xFFFF) as i32;
                on_thumbnail(hwnd, &*state, max_w.max(1), max_h.max(1));
            }
            return LRESULT(0);
        }
        WM_DWMSENDICONICLIVEPREVIEW => {
            if !state.is_null() {
                on_live_preview(hwnd, &*state);
            }
            return LRESULT(0);
        }
        WM_NCDESTROY => {
            // Best-effort teardown before the HWND dies.
            let _ = KillTimer(Some(hwnd), TIMER_ID);
            let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
            if !state.is_null() {
                drop(Box::from_raw(refdata as *mut PreviewState));
            }
            return DefSubclassProc(hwnd, msg, wparam, lparam);
        }
        _ => {}
    }

    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// Toggle FORCE_ICONIC to match whether mpv is alive, and invalidate iconic
/// bitmaps so an on-screen live preview refreshes.
unsafe fn heartbeat(hwnd: HWND, state: &PreviewState) {
    let playing = state.app.state::<PlayerState>().is_initialised();
    if playing != state.forced.get() {
        let val = BOOL(playing as i32);
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_FORCE_ICONIC_REPRESENTATION,
            &val as *const _ as *const c_void,
            std::mem::size_of::<BOOL>() as u32,
        );
        state.forced.set(playing);
        log::debug!("[player:preview] force-iconic {}", playing);
    }
    if playing {
        let _ = DwmInvalidateIconicBitmaps(hwnd);
    }
}

unsafe fn on_thumbnail(hwnd: HWND, state: &PreviewState, max_w: i32, max_h: i32) {
    // DIAGNOSTIC (prexu-6iyp): confirm whether Win11 Alt+Tab actually pulls the
    // iconic thumbnail. If these lines never appear when opening Alt+Tab, the
    // switcher is using live window capture and the iconic path can't fix it.
    let frame = state.app.state::<PlayerState>().screenshot_bgra();
    let (bmp, dims) = match frame {
        Some(frame) => {
            let (tw, th) = fit(frame.w, frame.h, max_w, max_h);
            (render_frame(&frame, tw, th), (tw, th))
        }
        None => (solid_dib(max_w, max_h), (max_w, max_h)),
    };
    match bmp {
        Some(bmp) => {
            let res = DwmSetIconicThumbnail(hwnd, bmp, 0);
            log::trace!(
                "[player:preview] thumbnail req max={}x{} bitmap={}x{} set={:?}",
                max_w, max_h, dims.0, dims.1, res
            );
            let _ = DeleteObject(HGDIOBJ(bmp.0));
        }
        None => log::warn!(
            "[player:preview] thumbnail req max={}x{} — bitmap build failed",
            max_w, max_h
        ),
    }
}

unsafe fn on_live_preview(hwnd: HWND, state: &PreviewState) {
    // Size the preview to the *video's* own aspect (capped), not the window
    // outline — the window is often a different shape (e.g. portrait on a
    // vertical monitor), and the user wants a media-style preview like Plex
    // rather than a letterboxed window snapshot (prexu-6iyp).
    let frame = state.app.state::<PlayerState>().screenshot_bgra();
    let bmp = match &frame {
        Some(frame) => {
            let (w, h) = cap(frame.w, frame.h, LIVE_MAX_DIM);
            render_frame(frame, w, h)
        }
        // No decoded frame: a small navy card rather than black.
        None => solid_dib(640, 360),
    };
    if let Some(bmp) = bmp {
        let res = DwmSetIconicLivePreviewBitmap(hwnd, bmp, None, 0);
        log::trace!(
            "[player:preview] live-preview req frame={} set={:?}",
            frame.is_some(),
            res
        );
        let _ = DeleteObject(HGDIOBJ(bmp.0));
    }
}

/// Aspect-fit `(sw, sh)` inside `(mw, mh)`.
fn fit(sw: i32, sh: i32, mw: i32, mh: i32) -> (i32, i32) {
    if sw <= 0 || sh <= 0 {
        return (mw.max(1), mh.max(1));
    }
    let s = (mw as f64 / sw as f64).min(mh as f64 / sh as f64);
    (
        ((sw as f64 * s).round() as i32).max(1),
        ((sh as f64 * s).round() as i32).max(1),
    )
}

/// Shrink `(w, h)` so its longest side is at most `max`, preserving aspect.
fn cap(w: i32, h: i32, max: i32) -> (i32, i32) {
    if w <= max && h <= max {
        (w.max(1), h.max(1))
    } else {
        fit(w, h, max, max)
    }
}

/// Create a top-down 32bpp DIB section. Returns the bitmap and a pointer to
/// its pixel bits (BGRA).
unsafe fn make_dib(w: i32, h: i32) -> Option<(HBITMAP, *mut u8)> {
    if w <= 0 || h <= 0 {
        return None;
    }
    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h, // negative => top-down, matching screenshot-raw rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0 as u32,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits: *mut c_void = ptr::null_mut();
    let hbmp = CreateDIBSection(None, &bmi, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
    if bits.is_null() {
        let _ = DeleteObject(HGDIOBJ(hbmp.0));
        return None;
    }
    Some((hbmp, bits as *mut u8))
}

/// A solid navy DIB — the fallback card when no frame is available (keeps the
/// preview on-brand instead of black during load/idle).
unsafe fn solid_dib(w: i32, h: i32) -> Option<HBITMAP> {
    let (bmp, bits) = make_dib(w, h)?;
    let buf = std::slice::from_raw_parts_mut(bits, (w * h) as usize * 4);
    for p in buf.chunks_exact_mut(4) {
        p.copy_from_slice(&NAVY);
    }
    Some(bmp)
}

/// Render `frame` aspect-fit (navy letterbox) into a `dw x dh` DIB via GDI
/// HALFTONE stretch, alpha forced opaque (DWM treats 0 alpha as transparent).
unsafe fn render_frame(frame: &RawFrame, dw: i32, dh: i32) -> Option<HBITMAP> {
    let (dst_bmp, dst_bits) = make_dib(dw, dh)?;
    let dst_px = (dw * dh) as usize;

    // Navy background (covers letterbox bars).
    {
        let buf = std::slice::from_raw_parts_mut(dst_bits, dst_px * 4);
        for p in buf.chunks_exact_mut(4) {
            p.copy_from_slice(&NAVY);
        }
    }

    let (src_bmp, src_bits) = match make_dib(frame.w, frame.h) {
        Some(v) => v,
        None => {
            let _ = DeleteObject(HGDIOBJ(dst_bmp.0));
            return None;
        }
    };
    ptr::copy_nonoverlapping(frame.bgra.as_ptr(), src_bits, frame.bgra.len());

    let (fw, fh) = fit(frame.w, frame.h, dw, dh);
    let (ox, oy) = ((dw - fw) / 2, (dh - fh) / 2);

    let src_dc = HDC(CreateCompatibleDC(None).0);
    let dst_dc = HDC(CreateCompatibleDC(None).0);
    let old_s = SelectObject(src_dc, HGDIOBJ(src_bmp.0));
    let old_d = SelectObject(dst_dc, HGDIOBJ(dst_bmp.0));
    SetStretchBltMode(dst_dc, HALFTONE);
    let _ = StretchBlt(
        dst_dc, ox, oy, fw, fh, Some(src_dc), 0, 0, frame.w, frame.h, SRCCOPY,
    );
    SelectObject(src_dc, old_s);
    SelectObject(dst_dc, old_d);
    let _ = DeleteDC(src_dc);
    let _ = DeleteDC(dst_dc);
    let _ = DeleteObject(HGDIOBJ(src_bmp.0));

    // HALFTONE stretch can zero the unused/alpha byte; force fully opaque.
    {
        let buf = std::slice::from_raw_parts_mut(dst_bits, dst_px * 4);
        for p in buf.chunks_exact_mut(4) {
            p[3] = 0xff;
        }
    }

    Some(dst_bmp)
}

/// Capture the current mpv video frame via `screenshot-raw`. Returns `None`
/// when mpv has no decoded frame (idle/loading) or on any FFI error.
///
/// # Safety
/// `ctx` must be a live `mpv_handle`. Called only by `PlayerState::screenshot_bgra`
/// while the `inner` lock (which owns the mpv handle) is held.
pub(crate) unsafe fn capture_mpv_frame(ctx: *mut libmpv2_sys::mpv_handle) -> Option<RawFrame> {
    let cmd = CString::new("screenshot-raw").ok()?;
    let arg = CString::new("video").ok()?;
    let mut args: [*const i8; 3] = [cmd.as_ptr(), arg.as_ptr(), ptr::null()];

    let mut result: libmpv2_sys::mpv_node = std::mem::zeroed();
    let rc = libmpv2_sys::mpv_command_ret(ctx, args.as_mut_ptr(), &mut result);
    if rc < 0 {
        return None;
    }
    let frame = parse_screenshot_node(&result);
    libmpv2_sys::mpv_free_node_contents(&mut result);
    frame
}

/// Parse the `MPV_FORMAT_NODE_MAP` returned by `screenshot-raw` into a packed
/// top-down BGRA frame with opaque alpha.
unsafe fn parse_screenshot_node(node: &libmpv2_sys::mpv_node) -> Option<RawFrame> {
    use libmpv2_sys::{
        mpv_format_MPV_FORMAT_BYTE_ARRAY as FMT_BA, mpv_format_MPV_FORMAT_INT64 as FMT_I64,
        mpv_format_MPV_FORMAT_NODE_MAP as FMT_MAP,
    };

    if node.format != FMT_MAP || node.u.list.is_null() {
        return None;
    }
    let list = &*node.u.list;
    if list.num <= 0 || list.keys.is_null() || list.values.is_null() {
        return None;
    }

    let (mut w, mut h, mut stride) = (0i64, 0i64, 0i64);
    let mut data_ptr: *const u8 = ptr::null();
    let mut data_size: usize = 0;

    for i in 0..list.num as isize {
        let key_ptr = *list.keys.offset(i);
        if key_ptr.is_null() {
            continue;
        }
        let key = CStr::from_ptr(key_ptr).to_string_lossy();
        let val = &*list.values.offset(i);
        match key.as_ref() {
            "w" if val.format == FMT_I64 => w = val.u.int64,
            "h" if val.format == FMT_I64 => h = val.u.int64,
            "stride" if val.format == FMT_I64 => stride = val.u.int64,
            "data" if val.format == FMT_BA && !val.u.ba.is_null() => {
                let ba = &*val.u.ba;
                data_ptr = ba.data as *const u8;
                data_size = ba.size;
            }
            _ => {}
        }
    }

    if w <= 0 || h <= 0 || stride <= 0 || data_ptr.is_null() {
        return None;
    }
    let (w, h, stride) = (w as i32, h as i32, stride as usize);
    let row_bytes = w as usize * 4;
    if stride < row_bytes {
        return None;
    }
    // Bounds: last row must fit in the byte array.
    if data_size < stride * (h as usize - 1) + row_bytes {
        log::warn!("[player:preview] screenshot data too small: {} < expected", data_size);
        return None;
    }

    let mut bgra = vec![0u8; row_bytes * h as usize];
    for y in 0..h as usize {
        let src = data_ptr.add(y * stride);
        let dst = bgra.as_mut_ptr().add(y * row_bytes);
        ptr::copy_nonoverlapping(src, dst, row_bytes);
        // screenshot-raw default "bgr0" leaves byte 3 = 0 → DWM would render it
        // fully transparent. Force opaque.
        let row = std::slice::from_raw_parts_mut(dst, row_bytes);
        let mut x = 3;
        while x < row_bytes {
            row[x] = 0xff;
            x += 4;
        }
    }

    Some(RawFrame { w, h, bgra })
}

#[cfg(test)]
mod tests {
    use super::{cap, fit};

    #[test]
    fn fit_preserves_aspect_within_bounds() {
        // 16:9 source into a 4:3 box → width-limited, exact aspect.
        let (w, h) = fit(1920, 1080, 200, 200);
        assert_eq!(w, 200);
        assert_eq!(h, 113); // 200 * 1080/1920 = 112.5 → 113
        assert!(w <= 200 && h <= 200);
    }

    #[test]
    fn fit_height_limited() {
        // Tall source into a wide box → height-limited.
        let (w, h) = fit(1080, 1920, 400, 100);
        assert_eq!(h, 100);
        assert_eq!(w, 56); // 100 * 1080/1920 = 56.25 → 56
    }

    #[test]
    fn fit_degenerate_source_falls_back_to_box() {
        assert_eq!(fit(0, 0, 320, 240), (320, 240));
    }

    #[test]
    fn fit_never_returns_zero() {
        // Extreme downscale must still clamp to at least 1px per side.
        let (w, h) = fit(4000, 1, 10, 10);
        assert!(w >= 1 && h >= 1);
    }

    #[test]
    fn cap_passes_through_when_within_limit() {
        assert_eq!(cap(800, 600, 1280), (800, 600));
    }

    #[test]
    fn cap_shrinks_longest_side_preserving_aspect() {
        let (w, h) = cap(1920, 1080, 1280);
        assert_eq!(w, 1280);
        assert_eq!(h, 720);
    }
}
