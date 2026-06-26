//! Centralised Win32 monitor helpers shared by `popout.rs` and any future
//! callers.
//!
//! # Why this module exists
//!
//! `popout.rs` previously contained three copies of the
//! `GetMonitorInfoW` decode pattern:
//!
//! - `current_work_area` — `MONITORINFO` (basic, work area only)
//! - `capture_monitor_record` — `MONITORINFOEXW` (work area + device name)
//! - `find_monitor_by_name` callback — `MONITORINFOEXW` (work area + device name)
//!
//! The Ex variant is strictly richer, so `monitor_info` always fills an
//! `MONITORINFOEXW`. Callers that only need the work area read
//! `result.monitorInfo.rcWork`; callers that also need the device name
//! additionally decode `result.szDevice`.
//!
//! # Safety
//!
//! All calls cross the Win32 FFI boundary. Callers must hold a valid
//! `HMONITOR` obtained from `MonitorFromWindow`, `EnumDisplayMonitors`, or
//! a similar system source. The HMONITOR is passed directly into
//! `GetMonitorInfoW` — invalid handles are caught by the Win32 return value
//! check and converted into a `String` error.

#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, HMONITOR, MONITORINFO, MONITORINFOEXW};

/// Call `GetMonitorInfoW` for `hmonitor` and return the fully populated
/// `MONITORINFOEXW`. The `cbSize` discriminant is set to
/// `sizeof(MONITORINFOEXW)` so Win32 fills `szDevice` in addition to the
/// base `MONITORINFO` fields.
///
/// Returns an error string if `GetMonitorInfoW` returns false (e.g. the
/// HMONITOR is no longer valid).
///
/// # Safety
///
/// `hmonitor` must be a valid monitor handle. Passing an invalid or stale
/// HMONITOR is undefined behaviour in the Win32 API and may cause a crash
/// or silently return garbage.
///
/// # Unit-testability
///
/// This function calls a live Win32 API and therefore cannot be
/// unit-tested without a real monitor context. Cover it via manual
/// integration testing or E2E on a Windows machine.
#[cfg(target_os = "windows")]
pub(crate) unsafe fn monitor_info(hmonitor: HMONITOR) -> Result<MONITORINFOEXW, String> {
    let mut info = MONITORINFOEXW {
        monitorInfo: MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
            ..Default::default()
        },
        ..Default::default()
    };
    if !GetMonitorInfoW(hmonitor, &mut info.monitorInfo as *mut _).as_bool() {
        return Err(format!(
            "GetMonitorInfoW failed for HMONITOR={:?}",
            hmonitor.0
        ));
    }
    Ok(info)
}

/// Decode the null-terminated UTF-16 `szDevice` field from a `MONITORINFOEXW`
/// into an owned `String`. Stops at the first NUL or at the array end,
/// whichever comes first.
///
/// This is a pure function and is fully unit-testable.
#[cfg(target_os = "windows")]
pub(crate) fn decode_device_name(sz_device: &[u16]) -> String {
    let nul = sz_device
        .iter()
        .position(|&c| c == 0)
        .unwrap_or(sz_device.len());
    String::from_utf16_lossy(&sz_device[..nul]).to_string()
}

/// Extract the work area `(left, top, width, height)` from a
/// `MONITORINFOEXW` in virtual-screen physical pixels.
///
/// Pure helper — no Win32 calls, fully unit-testable.
#[cfg(target_os = "windows")]
pub(crate) fn work_area_from_info(info: &MONITORINFOEXW) -> (i32, i32, i32, i32) {
    let r = info.monitorInfo.rcWork;
    (r.left, r.top, r.right - r.left, r.bottom - r.top)
}

/// Resync the mpv host window to the inner client area of `main`.
///
/// This is the shared "resync_host" pattern used by all five call sites
/// across `minimize.rs` and `popout.rs`:
///
/// ```rust,ignore
/// if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
///     state.apply_host_geometry(pos.x, pos.y, size.width as i32, size.height as i32);
/// }
/// ```
///
/// Extracted here so any future callers stay DRY without coupling them
/// to the `player::commands` module structure.
///
/// Does nothing if `inner_position` or `inner_size` returns an error
/// (mirrors the existing silent-drop behaviour at every call site).
#[cfg(target_os = "windows")]
pub(crate) fn resync_host(
    main: &tauri::WebviewWindow,
    _state: &crate::player::PlayerState,
) {
    let Ok(pos) = main.inner_position() else { return };
    let Ok(size) = main.inner_size() else { return };
    let (x, y, w, h) = (pos.x, pos.y, size.width as i32, size.height as i32);

    // Composition hosting applies a DComp visual offset, which MUST run on the
    // UI thread (the device is apartment-threaded). This command runs on a
    // tokio worker, so dispatch the apply to the main thread.
    use tauri::Manager;
    let app = main.app_handle().clone();
    let app_for_closure = app.clone();
    if let Err(e) = app.run_on_main_thread(move || {
        app_for_closure
            .state::<crate::player::PlayerState>()
            .apply_host_geometry(x, y, w, h);
    }) {
        log::warn!("[player:cmd] resync_host main-thread dispatch failed: {:?}", e);
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    // ── decode_device_name ──────────────────────────────────────────────────

    #[test]
    fn decode_device_name_typical_display_string() {
        // Win32 device names look like "\\.\DISPLAY1" encoded in UTF-16.
        let name = r"\\.\DISPLAY1";
        let utf16: Vec<u16> = name.encode_utf16().collect();
        // Provide the NUL terminator that szDevice would normally have.
        let mut buf = utf16.clone();
        buf.push(0);
        assert_eq!(decode_device_name(&buf), name);
    }

    #[test]
    fn decode_device_name_stops_at_first_nul() {
        // szDevice is a fixed-length array; trailing zeros after the NUL must
        // not be included in the decoded string.
        let name = r"\\.\DISPLAY2";
        let mut buf: Vec<u16> = name.encode_utf16().collect();
        buf.push(0);   // NUL terminator
        buf.push(65);  // 'A' — must not appear in output
        buf.push(0);
        assert_eq!(decode_device_name(&buf), name);
    }

    #[test]
    fn decode_device_name_empty_array_returns_empty_string() {
        assert_eq!(decode_device_name(&[]), "");
    }

    #[test]
    fn decode_device_name_all_nul_returns_empty_string() {
        assert_eq!(decode_device_name(&[0u16, 0, 0]), "");
    }

    #[test]
    fn decode_device_name_no_nul_uses_full_slice() {
        // If there is no NUL terminator in the slice, the whole slice is decoded.
        let chars: Vec<u16> = "ABC".encode_utf16().collect();
        assert_eq!(decode_device_name(&chars), "ABC");
    }

    // ── work_area_from_info ─────────────────────────────────────────────────

    #[test]
    fn work_area_from_info_standard_1080p_with_taskbar() {
        // 1920x1040 work area (40-px taskbar at bottom).
        let mut info = MONITORINFOEXW {
            monitorInfo: MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        info.monitorInfo.rcWork = windows::Win32::Foundation::RECT {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040,
        };
        assert_eq!(work_area_from_info(&info), (0, 0, 1920, 1040));
    }

    #[test]
    fn work_area_from_info_secondary_monitor_right_of_primary() {
        let mut info = MONITORINFOEXW {
            monitorInfo: MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        // Secondary monitor at virtual-screen offset (1920, 0), 2560x1440.
        info.monitorInfo.rcWork = windows::Win32::Foundation::RECT {
            left: 1920,
            top: 0,
            right: 1920 + 2560,
            bottom: 1440,
        };
        assert_eq!(work_area_from_info(&info), (1920, 0, 2560, 1440));
    }

    #[test]
    fn work_area_from_info_monitor_above_primary_negative_y() {
        let mut info = MONITORINFOEXW {
            monitorInfo: MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        // Monitor above primary: top = -2160, bottom = 0.
        info.monitorInfo.rcWork = windows::Win32::Foundation::RECT {
            left: 0,
            top: -2160,
            right: 3840,
            bottom: 0,
        };
        assert_eq!(work_area_from_info(&info), (0, -2160, 3840, 2160));
    }

    // ── monitor_info: Win32 live API — not unit-testable ───────────────────
    //
    // `monitor_info` calls `GetMonitorInfoW` which requires a valid HMONITOR
    // from the OS. Valid HMONITORs can only be obtained from
    // `MonitorFromWindow` / `MonitorFromPoint` / `EnumDisplayMonitors` which
    // themselves require a running Win32 message loop or a real HWND.
    //
    // Test coverage: manual integration test on a Windows machine using the
    // prexu development workflow (`npm run tauri dev`).

    // ── resync_host: Tauri runtime dependency — not unit-testable ──────────
    //
    // `resync_host` calls `WebviewWindow::inner_position` and
    // `WebviewWindow::inner_size`, which require an initialised Tauri runtime
    // and a live HWND. Neither can be constructed in a unit-test environment.
    //
    // Test coverage: exercised indirectly through all call sites in
    // `player_enter_minimize`, `player_update_mini_geometry`,
    // `player_exit_minimize`, `player_enter_popout`, and `player_exit_popout`
    // during manual E2E testing.
}
