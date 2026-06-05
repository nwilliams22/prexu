//! Pop-out player commands.
//!
//! Floating mini-window mode: shrinks the whole Tauri main window down to a
//! corner of the user's current display, sets always-on-top, and resyncs the
//! mpv host window. Distinct from the in-window "minimize" mode which keeps
//! the main window full size but renders the player chrome in a small corner
//! region of the WebView.

use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(target_os = "windows")]
use tauri_plugin_store::StoreExt;

use crate::player::{MinimizeCorner, PlayerState};

/// Path used for the pop-out player store. Kept separate from
/// `secure-store.json` (which holds auth tokens managed via the JS LazyStore)
/// so the Rust-side state and the frontend's secure data don't share a file
/// lock. Existing users without a stored entry fall back to the defaults
/// (bottom-right, 480×270) on first pop-out.
#[cfg(target_os = "windows")]
const POPOUT_STORE_PATH: &str = "popout-player.json";
#[cfg(target_os = "windows")]
const POPOUT_KEY_CORNER: &str = "popout.corner";
#[cfg(target_os = "windows")]
const POPOUT_KEY_SIZE: &str = "popout.size";
/// Persists the monitor the user last had the popout on.
/// Schema: `{ "device_name": "\\\\.\\DISPLAY1", "work_area": [x, y, w, h] }`
///
/// Stored on `player_exit_popout` using the monitor the popout window is
/// actually on at exit time (via `MonitorFromWindow` before restoring main).
/// Loaded on `player_enter_popout` to find the same monitor via
/// `EnumDisplayMonitors` + device-name match; falls back to
/// `MonitorFromWindow(main)` when not found (first run, disconnected monitor).
#[cfg(target_os = "windows")]
const POPOUT_KEY_MONITOR: &str = "popout.monitor";

#[cfg(target_os = "windows")]
const POPOUT_DEFAULT_CORNER: &str = "bottom-right";
#[cfg(target_os = "windows")]
const POPOUT_DEFAULT_WIDTH: u32 = 480;
#[cfg(target_os = "windows")]
const POPOUT_DEFAULT_HEIGHT: u32 = 270;

/// A monitor's device name and work area captured at pop-out exit time.
/// Used to find the same monitor on re-entry via `EnumDisplayMonitors`.
#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
pub(crate) struct MonitorRecord {
    /// Win32 `MONITORINFOEXW::szDevice` decoded as a UTF-16 string.
    /// Example: `"\\\\.\\DISPLAY1"`. Stable across reboots for the same
    /// physical monitor in the same port; may change if ports are swapped.
    pub device_name: String,
    /// Work area in virtual-screen physical pixels: (left, top, width, height).
    pub work_area: (i32, i32, i32, i32),
}

/// Query the WORK AREA (desktop rect minus taskbar/docked toolbars) in
/// physical pixels for the monitor the given window currently lives on.
/// Uses `MonitorFromWindow` + `GetMonitorInfoW` so a pop-out triggered
/// from the secondary display lands on that secondary display, not the
/// primary one.
#[cfg(target_os = "windows")]
fn current_work_area(
    main: &tauri::WebviewWindow,
) -> Result<(i32, i32, i32, i32), String> {
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    let hwnd = main
        .hwnd()
        .map_err(|e| format!("get main hwnd failed: {}", e))?;
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        log::debug!(
            "[player:popout] MonitorFromWindow HWND={:?} -> HMONITOR={:?}",
            hwnd.0,
            monitor.0
        );
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info as *mut _).as_bool() {
            return Err("GetMonitorInfoW failed".to_string());
        }
        let r = info.rcWork;
        let x = r.left;
        let y = r.top;
        let w = r.right - r.left;
        let h = r.bottom - r.top;
        log::debug!(
            "[player:popout] current-monitor work area = ({},{},{}x{})",
            x, y, w, h
        );
        Ok((x, y, w, h))
    }
}

/// Capture the monitor record (device name + work area) for the monitor the
/// given window currently lives on. Uses `MONITORINFOEXW` so we get the
/// device name, which is stable enough to identify the same physical monitor
/// across sessions (unlike HMONITOR which changes on reboot/reconnect).
///
/// Called from `player_exit_popout` BEFORE restoring the main window to its
/// pre-popout geometry, so `MonitorFromWindow` correctly identifies the
/// monitor the pop-out was dragged to rather than the monitor main will
/// return to after restore.
///
/// # DPI note
/// `MONITORINFOEXW::rcWork` is in virtual-screen physical pixels — the same
/// coordinate space as `GetWindowRect` and `SetWindowPos`. No DPI conversion
/// is needed here. The device_name + work_area tuple is safe to persist and
/// re-use across DPI changes because `find_monitor_by_name` re-reads the
/// LIVE `rcWork` from `EnumDisplayMonitors` at enter time, so taskbar moves
/// and resolution changes are automatically reflected.
#[cfg(target_os = "windows")]
fn capture_monitor_record(
    main: &tauri::WebviewWindow,
) -> Result<MonitorRecord, String> {
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFOEXW, MONITOR_DEFAULTTONEAREST,
    };
    let hwnd = main
        .hwnd()
        .map_err(|e| format!("get main hwnd failed: {}", e))?;
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        log::debug!(
            "[player:popout] capture_monitor_record MonitorFromWindow HWND={:?} -> HMONITOR={:?}",
            hwnd.0,
            monitor.0
        );
        // Initialise with cbSize = sizeof(MONITORINFOEXW). The Win32 contract
        // for GetMonitorInfoW is: if cbSize equals sizeof(MONITORINFOEXW),
        // the function fills szDevice in addition to the MONITORINFO fields.
        // This is the standard "Ex" variant pattern — no separate
        // GetMonitorInfoExW function exists; the size discriminates the call.
        let mut info = MONITORINFOEXW {
            monitorInfo: windows::Win32::Graphics::Gdi::MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        if !GetMonitorInfoW(
            monitor,
            &mut info.monitorInfo as *mut _,
        )
        .as_bool()
        {
            return Err("GetMonitorInfoW (MONITORINFOEXW) failed".to_string());
        }
        let r = info.monitorInfo.rcWork;
        let work_area = (r.left, r.top, r.right - r.left, r.bottom - r.top);

        // Decode szDevice (null-terminated UTF-16 array).
        let nul = info
            .szDevice
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(info.szDevice.len());
        let device_name =
            String::from_utf16_lossy(&info.szDevice[..nul]).to_string();

        log::info!(
            "[player:popout] captured monitor device_name={:?} work_area=({},{},{}x{})",
            device_name,
            work_area.0,
            work_area.1,
            work_area.2,
            work_area.3
        );
        Ok(MonitorRecord {
            device_name,
            work_area,
        })
    }
}

/// Enumerate all connected monitors and return the work area of the one
/// whose device name matches `target_name`. Returns `None` if no match is
/// found (e.g. the monitor was disconnected since the last session).
///
/// Always returns the LIVE work area from `EnumDisplayMonitors`, so taskbar
/// moves and resolution changes since the last session are handled
/// transparently — we only use the stored work_area as a fallback hint, not
/// the returned value here.
///
/// # DPI note
/// `rcWork` from `GetMonitorInfoW` inside the callback is in virtual-screen
/// physical pixels, consistent with `GetWindowRect` / `SetWindowPos`.
/// No conversion is needed.
#[cfg(target_os = "windows")]
pub(crate) fn find_monitor_by_name(target_name: &str) -> Option<(i32, i32, i32, i32)> {
    use windows::Win32::Foundation::LPARAM;
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, MONITORINFOEXW,
    };

    /// State passed through the EnumDisplayMonitors callback via LPARAM.
    struct SearchState<'a> {
        target: &'a str,
        found: Option<(i32, i32, i32, i32)>,
    }

    unsafe extern "system" fn enum_callback(
        hmonitor: windows::Win32::Graphics::Gdi::HMONITOR,
        _hdc: windows::Win32::Graphics::Gdi::HDC,
        _lprect: *mut windows::Win32::Foundation::RECT,
        lparam: LPARAM,
    ) -> windows::core::BOOL {
        // SAFETY: lparam is a `*mut SearchState` set in find_monitor_by_name;
        // it lives on the stack for the duration of EnumDisplayMonitors.
        let state = &mut *(lparam.0 as *mut SearchState);

        let mut info = MONITORINFOEXW {
            monitorInfo: windows::Win32::Graphics::Gdi::MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFOEXW>() as u32,
                ..Default::default()
            },
            ..Default::default()
        };
        if !GetMonitorInfoW(hmonitor, &mut info.monitorInfo as *mut _).as_bool() {
            // Continue enumeration even if one monitor fails.
            return windows::core::BOOL(1);
        }

        let nul = info
            .szDevice
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(info.szDevice.len());
        let name = String::from_utf16_lossy(&info.szDevice[..nul]);

        log::debug!(
            "[player:popout] EnumDisplayMonitors: device={:?} HMONITOR={:?}",
            name.as_str(),
            hmonitor.0
        );

        if name == state.target {
            let r = info.monitorInfo.rcWork;
            state.found = Some((r.left, r.top, r.right - r.left, r.bottom - r.top));
            // Stop enumeration — found what we needed.
            return windows::core::BOOL(0);
        }
        windows::core::BOOL(1) // continue
    }

    let mut search = SearchState {
        target: target_name,
        found: None,
    };

    unsafe {
        // hdc = None  -> enumerate all monitors on virtual screen
        // lprcclip = None  -> no clipping rectangle
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(enum_callback),
            LPARAM(&mut search as *mut SearchState as isize),
        );
    }

    if let Some(wa) = search.found {
        log::info!(
            "[player:popout] find_monitor_by_name matched {:?} work_area=({},{},{}x{})",
            target_name,
            wa.0,
            wa.1,
            wa.2,
            wa.3
        );
    } else {
        log::warn!(
            "[player:popout] find_monitor_by_name: no monitor named {:?} found (disconnected?), will fall back",
            target_name
        );
    }

    search.found
}

/// Load the persisted pop-out corner + size from the store, falling back to
/// the project defaults when no entry exists yet. Returns `(corner, width,
/// height)` ready to feed into `corner_origin`.
///
/// The on-disk format is kebab-case strings (e.g. `"bottom-right"`) which
/// serde deserializes directly into `MinimizeCorner` via `#[serde(rename_all =
/// "kebab-case")]`. Unknown strings (corrupted store, future migration) fall
/// back to `BottomRight` with a warning so the app keeps working.
#[cfg(target_os = "windows")]
fn load_persisted_popout(app: &AppHandle) -> (MinimizeCorner, u32, u32) {
    let mut corner = MinimizeCorner::BottomRight;
    let mut width = POPOUT_DEFAULT_WIDTH;
    let mut height = POPOUT_DEFAULT_HEIGHT;
    if let Ok(store) = app.store(POPOUT_STORE_PATH) {
        if let Some(v) = store.get(POPOUT_KEY_CORNER) {
            match serde_json::from_value::<MinimizeCorner>(v.clone()) {
                Ok(c) => corner = c,
                Err(e) => log::warn!(
                    "[player:popout] persisted corner unrecognised ({:?}), using default: {}",
                    v, e
                ),
            }
        }
        if let Some(v) = store.get(POPOUT_KEY_SIZE) {
            if let (Some(w), Some(h)) = (
                v.get("width").and_then(|x| x.as_u64()),
                v.get("height").and_then(|x| x.as_u64()),
            ) {
                width = w as u32;
                height = h as u32;
            }
        }
    }
    log::debug!(
        "[player:popout] resolved persisted geometry corner={:?} size={}x{}",
        corner, width, height
    );
    (corner, width, height)
}

/// Load the persisted monitor record from the store.
/// Returns `None` when no entry exists (first run) or the entry is malformed.
#[cfg(target_os = "windows")]
fn load_persisted_monitor(app: &AppHandle) -> Option<(String, (i32, i32, i32, i32))> {
    let store = app.store(POPOUT_STORE_PATH).ok()?;
    let v = store.get(POPOUT_KEY_MONITOR)?;
    let device_name = v.get("device_name")?.as_str()?.to_string();
    let wa = v.get("work_area")?;
    let arr = wa.as_array()?;
    if arr.len() != 4 {
        return None;
    }
    let coords: Option<Vec<i64>> = arr.iter().map(|x| x.as_i64()).collect();
    let coords = coords?;
    let work_area = (
        coords[0] as i32,
        coords[1] as i32,
        coords[2] as i32,
        coords[3] as i32,
    );
    log::debug!(
        "[player:popout] loaded persisted monitor device_name={:?} work_area=({},{},{}x{})",
        device_name,
        work_area.0,
        work_area.1,
        work_area.2,
        work_area.3
    );
    Some((device_name, work_area))
}

/// Read the Tauri main window's outer rect via Win32 `GetWindowRect` and
/// return `(x, y, width, height)`. Stashed on `enter_popout` and restored
/// on `exit_popout` so the window snaps back to exactly where it started.
///
/// Bypasses Tauri's `WebviewWindow::outer_position` / `outer_size` because
/// tao on Win11 mixes GetWindowRect output with logical/inner sizing math.
/// Combined with Win11's invisible DWM resize borders (`GetWindowRect`
/// includes them but `set_size` does not), a stash+restore via tao drifts
/// by ~7 px per cycle, growing the window on each enter/exit. Going through
/// pure Win32 removes the asymmetry — `GetWindowRect` and `SetWindowPos`
/// operate on the same outer rect including invisible borders.
#[cfg(target_os = "windows")]
fn read_window_rect(
    main: &tauri::WebviewWindow,
) -> Result<(i32, i32, i32, i32), String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let hwnd = main
        .hwnd()
        .map_err(|e| format!("get main hwnd failed: {}", e))?;
    let mut rect = RECT::default();
    unsafe {
        GetWindowRect(hwnd, &mut rect as *mut _)
            .map_err(|e| format!("GetWindowRect failed: {:?}", e))?;
    }
    let (x, y, w, h) = (
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top,
    );
    log::debug!(
        "[player:popout] GetWindowRect HWND={:?} -> ({},{},{}x{})",
        hwnd.0,
        x, y, w, h
    );
    Ok((x, y, w, h))
}

/// Apply an outer rect to the Tauri main window via Win32 `SetWindowPos`.
/// Paired with `read_window_rect` to round-trip pre-popout geometry exactly.
#[cfg(target_os = "windows")]
fn write_window_rect(
    main: &tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };
    let hwnd = main
        .hwnd()
        .map_err(|e| format!("get main hwnd failed: {}", e))?;
    log::debug!(
        "[player:popout] SetWindowPos HWND={:?} -> ({},{},{}x{})",
        hwnd.0,
        x, y, width, height
    );
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER,
        )
        .map_err(|e| format!("SetWindowPos failed: {:?}", e))
    }
}

/// Determine which work-area corner a window at `(x, y, w, h)` is nearest
/// to, by summing the L1 distance between matching corners. Used on
/// exit_popout to capture a user-dragged position back into the
/// `MinimizeCorner` enum so the next entry reopens there.
///
/// We compare BOTH endpoints of the window's rect against the matching
/// endpoints of each work-area corner (not just the top-left) so a window
/// dragged near the bottom-right work-area corner picks BottomRight even
/// if its own top-left happens to be closer to TopRight in absolute
/// distance. This matches what a user means by "I dragged it to that
/// corner."
#[cfg(target_os = "windows")]
fn nearest_corner(
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    wx: i32,
    wy: i32,
    ww: i32,
    wh: i32,
) -> MinimizeCorner {
    let right = x + w;
    let bottom = y + h;
    let work_right = wx + ww;
    let work_bottom = wy + wh;

    let candidates = [
        (
            MinimizeCorner::TopLeft,
            (x - wx).abs() + (y - wy).abs(),
        ),
        (
            MinimizeCorner::TopRight,
            (right - work_right).abs() + (y - wy).abs(),
        ),
        (
            MinimizeCorner::BottomLeft,
            (x - wx).abs() + (bottom - work_bottom).abs(),
        ),
        (
            MinimizeCorner::BottomRight,
            (right - work_right).abs() + (bottom - work_bottom).abs(),
        ),
    ];

    candidates
        .iter()
        .min_by_key(|(_, d)| *d)
        .map(|(c, _)| *c)
        .unwrap_or(MinimizeCorner::BottomRight)
}

/// Compute the (x, y) origin for a `(width, height)` window snapped to
/// `corner` of the work area `(wx, wy, ww, wh)`. Width/height are clamped
/// against the work-area dimensions so a too-large request still fits.
#[cfg(target_os = "windows")]
fn corner_origin(
    corner: MinimizeCorner,
    width: u32,
    height: u32,
    wx: i32,
    wy: i32,
    ww: i32,
    wh: i32,
) -> (i32, i32, u32, u32) {
    let w = (width as i32).min(ww).max(1) as u32;
    let h = (height as i32).min(wh).max(1) as u32;
    let (x, y) = match corner {
        MinimizeCorner::TopLeft => (wx, wy),
        MinimizeCorner::TopRight => (wx + ww - w as i32, wy),
        MinimizeCorner::BottomLeft => (wx, wy + wh - h as i32),
        MinimizeCorner::BottomRight => (wx + ww - w as i32, wy + wh - h as i32),
    };
    // Defense-in-depth: on multi-monitor setups with negative work-area
    // origins (monitors arranged above/left of primary), or when a saved
    // size from a larger display gets carried to a smaller one, the final
    // rect could land partly off-screen. Width/height are clamped above,
    // so this just keeps the (x, y) corner placement fully inside the work
    // area. No-op in the common case.
    let x = x.max(wx).min(wx + ww - w as i32);
    let y = y.max(wy).min(wy + wh - h as i32);
    log::debug!(
        "[player:popout] corner_origin corner={:?} requested={}x{} work=({},{},{}x{}) final=({},{},{}x{})",
        corner, width, height, wx, wy, ww, wh, x, y, w, h
    );
    (x, y, w, h)
}

/// Resolve the work area to use for a new pop-out entry. (prexu-ajn fix)
///
/// Strategy:
/// 1. Load the persisted monitor device name from the store.
/// 2. Call `find_monitor_by_name` (EnumDisplayMonitors) to find that monitor
///    by its current device name and get ITS LIVE work area.
/// 3. If found, use that work area -- this is the monitor the user last
///    dragged the popout to, regardless of where main currently is.
/// 4. If not found (first run, disconnected monitor), fall back to
///    `MonitorFromWindow(main)` -- the original behaviour.
///
/// This decouples the popout target monitor from the main window's current
/// monitor. Before this fix, `exit_popout` restores main to its pre-popout
/// position (monitor 1), so on re-entry `MonitorFromWindow(main)` returned
/// monitor 1 even though the user had dragged the popout to monitor 2.
///
/// # DPI note
/// The returned work area is in virtual-screen physical pixels from
/// `GetMonitorInfoW::rcWork`. `corner_origin` and `SetWindowPos` downstream
/// also work in physical pixels -- the coordinate space is uniform throughout.
/// Heterogeneous DPI is therefore handled transparently: each monitor's
/// work area uses that monitor's own physical pixel scale, and the popout
/// window is placed in those same physical coordinates. Windows DWM handles
/// any per-monitor DPI scaling of the window contents.
#[cfg(target_os = "windows")]
fn resolve_enter_work_area(
    main: &tauri::WebviewWindow,
    app: &AppHandle,
) -> Result<(i32, i32, i32, i32), String> {
    if let Some((device_name, _stored_wa)) = load_persisted_monitor(app) {
        // Attempt live lookup: even if the stored work_area is stale (taskbar
        // moved, resolution changed), EnumDisplayMonitors returns the current
        // work area for the live monitor, which is what we want.
        if let Some(live_wa) = find_monitor_by_name(&device_name) {
            log::info!(
                "[player:popout] enter: using persisted monitor {:?} live work_area=({},{},{}x{})",
                device_name,
                live_wa.0,
                live_wa.1,
                live_wa.2,
                live_wa.3
            );
            return Ok(live_wa);
        }
        // Monitor not found -- disconnected since last session.
        log::warn!(
            "[player:popout] enter: persisted monitor {:?} not found, falling back to MonitorFromWindow(main)",
            device_name
        );
    } else {
        log::debug!("[player:popout] enter: no persisted monitor, using MonitorFromWindow(main)");
    }
    // Fallback: first run or disconnected monitor -- original behaviour.
    current_work_area(main)
}

/// Enter pop-out mode: resize+reposition the Tauri main window to a corner
/// of the current display's work area, set always-on-top, and resync the
/// mpv host window. The pre-pop-out outer geometry of the main window is
/// stashed in `PlayerState::pre_popout_geometry` for `player_exit_popout`
/// to restore.
///
/// All args are `Option` so the frontend can pass `undefined` to mean "use
/// the persisted geometry from `popout-player.json`". When the store is
/// empty (first run on this profile), `POPOUT_DEFAULT_*` are used. The hook
/// typically calls this with no args after the first session.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_enter_popout(
    corner: Option<MinimizeCorner>,
    width: Option<u32>,
    height: Option<u32>,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    let (saved_corner, saved_w, saved_h) = load_persisted_popout(&app);
    let corner = corner.unwrap_or(saved_corner);
    let width = width.unwrap_or(saved_w);
    let height = height.unwrap_or(saved_h);
    log::info!(
        "[player:cmd] enter_popout corner={:?} size={}x{}",
        corner,
        width,
        height
    );
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    // Clear any minimize inset BEFORE doing any geometry work. Pop-out and
    // minimize are mutually exclusive; without this, a frontend race between
    // playerExitMinimize and playerEnterPopOut can leave state.minimize=Some
    // while we apply the popout geometry, causing the SetWindowPos resize
    // storm to read the stale inset and shrink the host to the bottom-right
    // corner of the new popout window. Clearing here is authoritative —
    // subsequent Resized events will all see minimize=None.
    if let Ok(mut mz) = state.minimize.lock() {
        if mz.is_some() {
            log::debug!("[player:popout] clearing leftover minimize inset on enter");
        }
        *mz = None;
    }

    // prexu-ajn: resolve the target work area from the persisted monitor
    // (if any) rather than always using MonitorFromWindow(main). After
    // exit_popout restores main to its original monitor, the main window
    // is back on monitor 1 -- but the user may have dragged the popout to
    // monitor 2 before exiting. We now persist the monitor at exit and look
    // it up by device name here, so re-entry opens on monitor 2.
    let (wx, wy, ww, wh) = resolve_enter_work_area(&main, &app)?;
    let (x, y, w, h) = corner_origin(corner, width, height, wx, wy, ww, wh);

    // Stash the current OUTER rect via Win32 GetWindowRect. Captured +
    // restored through the same Win32 API so the round-trip is exact —
    // Tauri's outer_size/outer_position go through tao which disagrees with
    // SetWindowPos by ~7 px due to Win11's invisible DWM resize borders,
    // causing the window to grow on each enter/exit cycle.
    match read_window_rect(&main) {
        Ok((rx, ry, rw, rh)) => {
            let stash = (rx, ry, rw as u32, rh as u32);
            if let Ok(mut g) = state.pre_popout_geometry.lock() {
                *g = Some(stash);
                log::debug!(
                    "[player:popout] stashed pre-popout outer geometry ({},{},{}x{}) via GetWindowRect",
                    stash.0, stash.1, stash.2, stash.3
                );
            }
        }
        Err(e) => log::warn!("[player:popout] read_window_rect for stash failed: {}", e),
    }

    // Apply window changes via Win32 SetWindowPos (matches GetWindowRect's
    // coordinate system; see read_window_rect doc). set_always_on_top stays
    // on Tauri because that API call also flips WS_EX_TOPMOST on the
    // WebView's ancestor chain, not just the main HWND. We leave the
    // window resizable (tauri.conf.json `resizable: true`) so the user can
    // grab the top-left corner of the floating window; the new size is
    // persisted in `player_exit_popout` so the next entry restores it.
    main.set_always_on_top(true)
        .map_err(|e| format!("set_always_on_top failed: {}", e))?;
    write_window_rect(&main, x, y, w as i32, h as i32)
        .map_err(|e| format!("popout geometry apply failed: {}", e))?;

    log::debug!(
        "[player:popout] resized main to ({},{},{}x{}); resynced host",
        x, y, w, h
    );

    // Resync the host immediately. The on_window_event listener will also
    // fire from the resize, but it goes through the throttle; an explicit
    // apply guarantees the video window is in place by the time the command
    // returns.
    if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
        state.apply_host_geometry(pos.x, pos.y, size.width as i32, size.height as i32);
    }

    // Mark the mpv host window topmost too. Tauri's set_always_on_top on
    // the main window only flips that flag for the WebView's HWND — the
    // host is a sibling top-level so it stays in the regular z-order,
    // letting other apps render between the always-on-top WebView and
    // the video underneath. Anchor below main inside the topmost group
    // so the WebView still overlays the video region.
    if let Ok(parent) = main.hwnd() {
        state.apply_host_topmost(true, Some(parent));
    } else {
        state.apply_host_topmost(true, None);
    }

    // Persist the chosen corner + size for next session. A failure here is
    // not fatal — the user can re-enter pop-out and we'll save again.
    match app.store(POPOUT_STORE_PATH) {
        Ok(store) => {
            // Serialize the enum back to its kebab-case string to keep the
            // on-disk format stable (old user data remains compatible).
            let corner_str = serde_json::to_value(corner)
                .unwrap_or_else(|_| serde_json::Value::String(POPOUT_DEFAULT_CORNER.to_string()));
            store.set(POPOUT_KEY_CORNER, corner_str);
            store.set(
                POPOUT_KEY_SIZE,
                serde_json::json!({ "width": w, "height": h }),
            );
            if let Err(e) = store.save() {
                log::warn!("[player:popout] store save failed: {:?}", e);
            } else {
                log::debug!(
                    "[player:popout] persisted corner={:?} size={}x{}",
                    corner, w, h
                );
            }
        }
        Err(e) => log::warn!("[player:popout] store open failed: {:?}", e),
    }

    Ok(())
}

/// Exit pop-out mode: clear always-on-top and restore the main window to
/// the outer geometry stashed by `player_enter_popout`. If no stash exists
/// (e.g. exit called without a prior enter), this clears always-on-top and
/// returns Ok without resizing.
///
/// Persistence: BEFORE restoring, we read the main window's current outer
/// size and write it back to the store under `POPOUT_KEY_SIZE`. This is
/// how user-driven resizes (dragging the top-left corner while the pop-out
/// is open) round-trip across sessions — the next `player_enter_popout`
/// with no args reads this saved size via `load_persisted_popout`.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_exit_popout(
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] exit_popout");
    // Tell useTransparentWindow to drop body.player-transparent for the
    // duration of the transition (prexu-7d3). Without this, the WebView
    // returns to full-main size while the underlying dashboard route has
    // not yet painted, so the transparent body lets the desktop show
    // through until React + WebView2 catch up. Re-applied at the end
    // after the host geometry has settled.
    let _ = app.emit("player://host-window-busy", ());
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    // Capture the user's current size AND position BEFORE restoring so any
    // post-enter resize and drag is preserved. Read via Win32 GetWindowRect
    // so the stored value matches what SetWindowPos on a subsequent enter
    // will receive.
    //
    // Position is derived back into a corner via nearest_corner so it round-
    // trips through the existing `MinimizeCorner` enum the rest of the
    // system speaks. The user's drag may have landed mid-screen rather than
    // at a true corner — snapping to the nearest is the standard UX for
    // corner-anchored pop-out windows and matches what Plex Web does.
    match read_window_rect(&main) {
        Ok((rx, ry, rw, rh)) => {
            // Determine which work area the popout is CURRENTLY on, BEFORE
            // restoring main. Both current_work_area and capture_monitor_record
            // call MonitorFromWindow on the main HWND which, at this point,
            // is still at the popout position -- so they return the monitor
            // the user last dragged it to. After write_window_rect restores
            // main to its original position, MonitorFromWindow would return
            // the original monitor instead (too late for our purposes).
            let current_wa = current_work_area(&main);
            let detected_corner = match &current_wa {
                Ok((wx, wy, ww, wh)) => {
                    Some(nearest_corner(rx, ry, rw, rh, *wx, *wy, *ww, *wh))
                }
                Err(e) => {
                    log::warn!(
                        "[player:popout] current_work_area failed on exit, corner persistence skipped: {}",
                        e
                    );
                    None
                }
            };

            // prexu-ajn: capture the monitor record BEFORE restoring main.
            let monitor_record = match capture_monitor_record(&main) {
                Ok(r) => Some(r),
                Err(e) => {
                    log::warn!(
                        "[player:popout] capture_monitor_record failed, monitor persistence skipped: {}",
                        e
                    );
                    None
                }
            };

            match app.store(POPOUT_STORE_PATH) {
                Ok(store) => {
                    if let Some(corner) = detected_corner {
                        let corner_str = serde_json::to_value(corner).unwrap_or_else(|_| {
                            serde_json::Value::String(POPOUT_DEFAULT_CORNER.to_string())
                        });
                        store.set(POPOUT_KEY_CORNER, corner_str);
                    }
                    store.set(
                        POPOUT_KEY_SIZE,
                        serde_json::json!({ "width": rw, "height": rh }),
                    );
                    // prexu-ajn: persist the monitor record so re-entry can
                    // target the correct monitor even after main has been
                    // restored to a different one.
                    if let Some(ref rec) = monitor_record {
                        let wa = &rec.work_area;
                        store.set(
                            POPOUT_KEY_MONITOR,
                            serde_json::json!({
                                "device_name": rec.device_name,
                                "work_area": [wa.0, wa.1, wa.2, wa.3]
                            }),
                        );
                    }
                    if let Err(e) = store.save() {
                        log::warn!("[player:popout] resize-on-exit save failed: {:?}", e);
                    } else {
                        log::info!(
                            "[player:popout] persisted exit geometry corner={:?} size={}x{} monitor={:?}",
                            detected_corner,
                            rw,
                            rh,
                            monitor_record.as_ref().map(|r| r.device_name.as_str())
                        );
                    }
                }
                Err(e) => log::warn!("[player:popout] resize-on-exit store open failed: {:?}", e),
            }
        }
        Err(e) => log::warn!("[player:popout] resize-on-exit read failed: {}", e),
    }

    main.set_always_on_top(false)
        .map_err(|e| format!("set_always_on_top(false) failed: {}", e))?;

    // Clear topmost on the mpv host window AND re-anchor it below the
    // WebView. Passing Some(parent) here is load-bearing:
    // SetWindowPos(HWND_NOTOPMOST) alone leaves the host above normal-
    // z-order siblings, so after exit the host floats over the WebView
    // and the app becomes uninteractable. Anchoring below puts it back
    // in its correct place underneath the WebView pixels.
    let parent_hwnd = main.hwnd().ok();
    state.apply_host_topmost(false, parent_hwnd);

    let stash = state
        .pre_popout_geometry
        .lock()
        .ok()
        .and_then(|mut g| g.take());

    let Some((x, y, w, h)) = stash else {
        log::debug!("[player:popout] exit_popout: no stash, only cleared always-on-top");
        return Ok(());
    };

    write_window_rect(&main, x, y, w as i32, h as i32)
        .map_err(|e| format!("popout restore apply failed: {}", e))?;

    log::debug!(
        "[player:popout] restored main to ({},{},{}x{}) via SetWindowPos; resynced host",
        x, y, w, h
    );

    if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
        state.apply_host_geometry(pos.x, pos.y, size.width as i32, size.height as i32);
    }

    // Transition complete — re-arm the transparent body class. The TS hook
    // defers the re-add by a rAF + sync layout read so WebView2 commits the
    // dashboard paint before transparency comes back (prexu-7d3, same paint-
    // commit trick as the prexu-uzk dashboard reflow fix).
    let _ = app.emit("player://host-window-ready", ());

    Ok(())
}

// Non-Windows stubs so the command names exist for the JS bridge but the
// platform that hasn't been ported yet (macOS / Linux) returns a clear error
// instead of failing at the IPC layer with "command not found". Keeps the
// frontend code path uniform.
#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn player_enter_popout(
    _corner: Option<crate::player::MinimizeCorner>,
    _width: Option<u32>,
    _height: Option<u32>,
) -> Result<(), String> {
    log::warn!("[player:cmd] enter_popout called on non-Windows platform");
    Err("pop-out mode is only supported on Windows in Phase 4".into())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn player_exit_popout() -> Result<(), String> {
    log::warn!("[player:cmd] exit_popout called on non-Windows platform");
    Err("pop-out mode is only supported on Windows in Phase 4".into())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    // Reference work area used by most cases — a typical 1920x1080 primary
    // monitor with a 40-px taskbar at the bottom, origin at (0, 0).
    const WX: i32 = 0;
    const WY: i32 = 0;
    const WW: i32 = 1920;
    const WH: i32 = 1040;

    #[test]
    fn nearest_corner_top_left() {
        // Window snug against (0, 0)
        let c = nearest_corner(0, 0, 480, 270, WX, WY, WW, WH);
        assert_eq!(c, MinimizeCorner::TopLeft);
    }

    #[test]
    fn nearest_corner_top_right() {
        // Window right edge at work-area right edge, top at 0
        let c = nearest_corner(WW - 480, 0, 480, 270, WX, WY, WW, WH);
        assert_eq!(c, MinimizeCorner::TopRight);
    }

    #[test]
    fn nearest_corner_bottom_left() {
        let c = nearest_corner(0, WH - 270, 480, 270, WX, WY, WW, WH);
        assert_eq!(c, MinimizeCorner::BottomLeft);
    }

    #[test]
    fn nearest_corner_bottom_right() {
        let c = nearest_corner(WW - 480, WH - 270, 480, 270, WX, WY, WW, WH);
        assert_eq!(c, MinimizeCorner::BottomRight);
    }

    #[test]
    fn nearest_corner_drag_mid_screen_upper_left_quadrant_picks_top_left() {
        // User dragged the popout into the upper-left quadrant but not
        // pinned to the corner — UX expectation is snap to TopLeft on exit.
        let c = nearest_corner(200, 150, 480, 270, WX, WY, WW, WH);
        assert_eq!(c, MinimizeCorner::TopLeft);
    }

    #[test]
    fn nearest_corner_drag_into_upper_right_quadrant_picks_top_right() {
        // Halfway to the right edge in x, near top in y
        let c = nearest_corner(1100, 100, 480, 270, WX, WY, WW, WH);
        assert_eq!(c, MinimizeCorner::TopRight);
    }

    #[test]
    fn nearest_corner_negative_work_area_origin() {
        // Multi-monitor: secondary monitor positioned above the primary so
        // its work area has a negative `wy`. Window in its bottom-right
        // should still report BottomRight.
        let (wx, wy, ww, wh) = (1602, -2160, 3840, 2160);
        let c = nearest_corner(wx + ww - 800, wy + wh - 600, 800, 600, wx, wy, ww, wh);
        assert_eq!(c, MinimizeCorner::BottomRight);
    }

    #[test]
    fn nearest_corner_regression_logged_drag_picks_bottom_left() {
        // From the bug logs (prexu-dhg, 2026-05-24): popout dragged to
        // (1936, -884), size 800x600, work area (1602, -2160, 3840x2160).
        // The work area covers a secondary monitor positioned above + right
        // of primary, so y is negative. Work-area y-midpoint is -1080;
        // window top -884 is below that (Win32 y grows downward), so the
        // window is in the LOWER-LEFT quadrant. Pre-fix this still
        // persisted as BottomRight (the enter-time corner). Post-fix it
        // correctly snaps to BottomLeft, matching where the window actually
        // sits on screen.
        let c = nearest_corner(1936, -884, 800, 600, 1602, -2160, 3840, 2160);
        assert_eq!(c, MinimizeCorner::BottomLeft);
    }

    // ---- prexu-ajn: monitor record JSON schema --------------------------
    //
    // The pure serialisation/deserialisation logic for POPOUT_KEY_MONITOR
    // is testable without Win32. find_monitor_by_name and
    // capture_monitor_record exercise live Win32 APIs (EnumDisplayMonitors,
    // MonitorFromWindow, GetMonitorInfoW) and are covered by manual repro
    // per the prexu-ajn test plan.

    #[test]
    fn monitor_record_json_schema_round_trips() {
        // The store schema is:
        //   { "device_name": "\\\\.\\DISPLAY1", "work_area": [x, y, w, h] }
        // Verify that the JSON written in player_exit_popout can be parsed
        // back by load_persisted_monitor's parsing logic.
        let device_name = r"\\.\DISPLAY2".to_string();
        let work_area = (1920_i32, 0_i32, 1920_i32, 1080_i32);

        // Mimic the serialisation in player_exit_popout.
        let written = serde_json::json!({
            "device_name": device_name,
            "work_area": [work_area.0, work_area.1, work_area.2, work_area.3]
        });

        // Mimic the parsing in load_persisted_monitor.
        let parsed_name = written["device_name"].as_str().unwrap().to_string();
        let wa = &written["work_area"];
        let arr = wa.as_array().unwrap();
        assert_eq!(arr.len(), 4);
        let parsed_wa = (
            arr[0].as_i64().unwrap() as i32,
            arr[1].as_i64().unwrap() as i32,
            arr[2].as_i64().unwrap() as i32,
            arr[3].as_i64().unwrap() as i32,
        );

        assert_eq!(parsed_name, device_name);
        assert_eq!(parsed_wa, work_area);
    }

    #[test]
    fn monitor_record_json_schema_handles_negative_coords() {
        // Monitors above/left of primary have negative virtual-screen coords.
        // The schema uses i64 JSON numbers which round-trip negative i32s cleanly.
        let work_area = (-3840_i32, -2160_i32, 3840_i32, 2160_i32);
        let written = serde_json::json!({
            "device_name": r"\\.\DISPLAY1",
            "work_area": [work_area.0, work_area.1, work_area.2, work_area.3]
        });
        let wa = &written["work_area"];
        let arr = wa.as_array().unwrap();
        let parsed = (
            arr[0].as_i64().unwrap() as i32,
            arr[1].as_i64().unwrap() as i32,
            arr[2].as_i64().unwrap() as i32,
            arr[3].as_i64().unwrap() as i32,
        );
        assert_eq!(parsed, work_area);
    }

    #[test]
    fn monitor_record_json_schema_rejects_wrong_array_length() {
        // load_persisted_monitor requires exactly 4 elements in work_area.
        let bad = serde_json::json!({
            "device_name": r"\\.\DISPLAY1",
            "work_area": [0, 0, 1920]  // only 3 elements
        });
        let wa = &bad["work_area"];
        let arr = wa.as_array().unwrap();
        // Simulates the arr.len() != 4 guard in load_persisted_monitor.
        assert_ne!(arr.len(), 4);
    }

    #[test]
    fn monitor_record_json_schema_rejects_missing_device_name() {
        let bad = serde_json::json!({
            "work_area": [0, 0, 1920, 1080]
            // no "device_name" field
        });
        // Simulates the v.get("device_name")? guard in load_persisted_monitor.
        assert!(bad.get("device_name").is_none());
    }

    // ---- corner_origin on secondary / above-primary monitor coords ------

    #[test]
    fn corner_origin_on_secondary_monitor_to_the_right() {
        // Secondary monitor to the right: work area (1920, 0, 1920, 1080).
        // BottomRight snap of a 480x270 window:
        //   x = 1920 + 1920 - 480 = 3360
        //   y = 0    + 1080 - 270 =  810
        let (x, y, w, h) = corner_origin(
            MinimizeCorner::BottomRight,
            480,
            270,
            1920, 0, 1920, 1080,
        );
        assert_eq!((x, y, w, h), (3360, 810, 480, 270));
    }

    #[test]
    fn corner_origin_on_monitor_above_primary_negative_y() {
        // Monitor positioned above primary: work area (0, -1080, 1920, 1080).
        // TopLeft snap: (0, -1080, 480, 270).
        let (x, y, w, h) = corner_origin(
            MinimizeCorner::TopLeft,
            480,
            270,
            0, -1080, 1920, 1080,
        );
        assert_eq!((x, y, w, h), (0, -1080, 480, 270));
    }

    #[test]
    fn corner_origin_clamps_oversized_window_to_work_area() {
        // Saved size (800x600) larger than a small monitor's work area
        // (640x480) -- clamps to work area dimensions without panicking.
        let (_, _, w, h) = corner_origin(
            MinimizeCorner::BottomRight,
            800, 600,
            0, 0, 640, 480,
        );
        assert_eq!((w, h), (640, 480));
    }

    // ---- nearest_corner coordinate-space consistency (mhn DPI review) ---
    //
    // All inputs to nearest_corner are in virtual-screen physical pixels:
    //   (x, y, w, h) from GetWindowRect (physical)
    //   (wx, wy, ww, wh) from GetMonitorInfoW::rcWork (physical)
    // Both are queried in the same coordinate space so no DPI scaling is
    // needed. These tests verify correct behaviour with realistic multi-
    // monitor coordinates including negative origins (above-primary layout).

    #[test]
    fn nearest_corner_physical_coords_left_monitor_negative_origin() {
        // Monitor to the left of primary: work area (-1920, 0, 1920, 1040).
        // Window snapped at bottom-left of that monitor.
        let c = nearest_corner(-1920, 1040 - 270, 480, 270, -1920, 0, 1920, 1040);
        assert_eq!(c, MinimizeCorner::BottomLeft);
    }

    #[test]
    fn nearest_corner_physical_coords_right_monitor_positive_origin() {
        // Monitor to the right of primary: work area (1920, 0, 2560, 1440).
        // Window snapped at top-right.
        let c = nearest_corner(1920 + 2560 - 480, 0, 480, 270, 1920, 0, 2560, 1440);
        assert_eq!(c, MinimizeCorner::TopRight);
    }
}
