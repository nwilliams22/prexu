//! Pop-out player commands.
//!
//! Floating mini-window mode: shrinks the whole Tauri main window down to a
//! corner of the user's current display, sets always-on-top, and (Windows)
//! resyncs the mpv host window. Distinct from the in-window "minimize" mode
//! which keeps the main window full size but renders the player chrome in a
//! small corner region of the WebView.
//!
//! ## Platform split
//! - **Windows**: Win32 geometry (`GetWindowRect`/`SetWindowPos` — exact
//!   outer-rect round-trip past Win11's invisible DWM borders) plus
//!   monitor-by-device-name persistence (prexu-ajn) via `win32_monitor`.
//! - **Linux** (prexu-axj4.10): the same main-window morph through Tauri/GTK
//!   window ops. The render-API compositor draws into a GLArea that fills
//!   the window (`player::linux_compositor`), so there is no host window to
//!   reposition and no geometry resync — GTK's allocation drives the video
//!   size automatically. The persisted corner/size store is shared with
//!   Windows (same file + keys); monitor persistence is not ported — the
//!   popout opens on the monitor the main window is currently on.
//!
//! ## Wayland caveats (X11 has full parity)
//! - `set_position` / `outer_position` are no-ops / meaningless (the
//!   protocol has no global window coordinates), so corner placement and
//!   nearest-corner persistence are skipped — the window shrinks in place
//!   and the user drags it where they want it (PopoutDragStrip's
//!   `data-tauri-drag-region` → `gtk_window_begin_move_drag` works on both
//!   backends).
//! - `set_always_on_top` (`gtk_window_set_keep_above`) is ignored by most
//!   Wayland compositors; users can pin the window compositor-side (e.g.
//!   GNOME's window menu → Always on Top).
//! - A maximized main window and the app's 800x600 min-size both silently
//!   block the Wayland shrink (prexu-6qi5.4): GTK no-ops `gtk_window_resize`
//!   on a maximized toplevel, and `gtk_window_set_geometry_hints`'
//!   `GDK_HINT_MIN_SIZE` becomes an `xdg_toplevel.set_min_size` floor that
//!   clamps both programmatic resizes and edge-drag resizes below it. `enter`
//!   therefore unmaximizes (recording the prior state) and lowers the
//!   min-size to a small pop-out floor before resizing; `exit` restores the
//!   min-size, the pre-popout geometry, and re-maximizes if it was maximized.
//!
//! Size + decoration changes work on both backends, so the popout is fully
//! usable on Wayland — it just floats without OS-level pinning.

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_store::StoreExt;

use crate::player::{MinimizeCorner, PlayerState};
#[cfg(target_os = "windows")]
use super::win32_monitor::{decode_device_name, monitor_info, resync_host, work_area_from_info};

/// Path used for the pop-out player store. Kept separate from
/// `secure-store.json` (which holds auth tokens managed via the JS LazyStore)
/// so the Rust-side state and the frontend's secure data don't share a file
/// lock. Existing users without a stored entry fall back to the defaults
/// (bottom-right, 480×270) on first pop-out.
const POPOUT_STORE_PATH: &str = "popout-player.json";
const POPOUT_KEY_CORNER: &str = "popout.corner";
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

const POPOUT_DEFAULT_CORNER: &str = "bottom-right";
const POPOUT_DEFAULT_WIDTH: u32 = 480;
const POPOUT_DEFAULT_HEIGHT: u32 = 270;

/// Fraction of the current monitor's work-area dimensions above which a
/// pop-out size (persisted OR freshly read back at exit) is treated as
/// corrupted rather than a legitimate mini-player (prexu-r6k8). A pop-out is
/// meant to float as a small corner window; nothing legitimate needs more
/// than 60% of either work-area dimension.
///
/// Root cause this guards against: on Linux, a maximized main window or the
/// app's 800x600 min-size used to silently block the popout shrink entirely
/// (prexu-6qi5.4, fixed by PR #52's unmaximize + min-size lift). Every
/// `enter`/`exit` cycle that ran BEFORE that fix landed persisted the
/// still-fullscreen-ish size on exit, and every cycle since faithfully
/// replayed (and re-persisted) that oversized value — `corner_origin`'s own
/// clamp only guarantees a request "fits within the work area"
/// (`w.min(ww)`), not that it looks like an actual pop-out. Confirmed from
/// hardware logs: a persisted 1920x2160 size replayed verbatim onto a
/// 3840x2160 work area, forever.
const POPOUT_SANE_SIZE_RATIO: f64 = 0.6;

/// Absolute floor (PHYSICAL pixels) a pop-out size is clamped to after
/// passing the sane-ceiling check above. Distinct from the Linux-only
/// `POPOUT_MIN_WIDTH`/`POPOUT_MIN_HEIGHT` GTK min-size hint (LOGICAL pixels,
/// only used by `set_min_size` to lift the GTK-level shrink floor) — this
/// constant guards the persisted/requested size value itself, in the same
/// physical-pixel unit `corner_origin` and the store already use, against a
/// degenerate near-zero size slipping through.
const POPOUT_SIZE_FLOOR_PHYSICAL: u32 = 100;

/// The `[floor, ceiling]` a pop-out size must fall within for a given
/// work-area, both in PHYSICAL pixels (see `POPOUT_SANE_SIZE_RATIO` /
/// `POPOUT_SIZE_FLOOR_PHYSICAL`). `.max(floor)` on the ceiling keeps the
/// range valid (non-empty) even on a work area small enough that 60% of it
/// would otherwise fall below the floor.
fn popout_size_ceiling(work_area_w: i32, work_area_h: i32) -> (u32, u32) {
    let ceiling_w = (work_area_w.max(1) as f64 * POPOUT_SANE_SIZE_RATIO) as u32;
    let ceiling_h = (work_area_h.max(1) as f64 * POPOUT_SANE_SIZE_RATIO) as u32;
    (
        ceiling_w.max(POPOUT_SIZE_FLOOR_PHYSICAL),
        ceiling_h.max(POPOUT_SIZE_FLOOR_PHYSICAL),
    )
}

/// Whether a pop-out size (PHYSICAL pixels) looks like a legitimate
/// mini-player rather than a corrupted, fullscreen-ish value, given the
/// current monitor's work area (also PHYSICAL pixels — see
/// `POPOUT_SANE_SIZE_RATIO`). Shared by `sanitize_popout_size` (enter-time)
/// and the exit-time persist guard so corruption can neither enter NOR
/// re-enter the store (prexu-r6k8).
fn is_sane_popout_size(width: u32, height: u32, work_area_w: i32, work_area_h: i32) -> bool {
    let (ceiling_w, ceiling_h) = popout_size_ceiling(work_area_w, work_area_h);
    width <= ceiling_w && height <= ceiling_h
}

/// Validate a (possibly persisted) pop-out size against the current
/// monitor's work area before it's fed into `corner_origin`. Returns the
/// size clamped into `[POPOUT_SIZE_FLOOR_PHYSICAL, ceiling]` when it looks
/// sane, or resets to the project default (480x270) when it exceeds
/// `POPOUT_SANE_SIZE_RATIO` of the work area — seen on hardware as a
/// persisted 1920x2160 replaying onto a 3840x2160 monitor forever
/// (prexu-r6k8). Pure + unit-tested: the exact hardware repro has a
/// regression test below.
fn sanitize_popout_size(width: u32, height: u32, work_area_w: i32, work_area_h: i32) -> (u32, u32) {
    let (ceiling_w, ceiling_h) = popout_size_ceiling(work_area_w, work_area_h);
    if !is_sane_popout_size(width, height, work_area_w, work_area_h) {
        log::warn!(
            "[player:popout] persisted/requested size {}x{} exceeds {:.0}% of work area {}x{} \
             (physical px) — treating as corrupted (prexu-r6k8), resetting to default {}x{}",
            width,
            height,
            POPOUT_SANE_SIZE_RATIO * 100.0,
            work_area_w,
            work_area_h,
            POPOUT_DEFAULT_WIDTH,
            POPOUT_DEFAULT_HEIGHT
        );
        return (POPOUT_DEFAULT_WIDTH, POPOUT_DEFAULT_HEIGHT);
    }
    (
        width.clamp(POPOUT_SIZE_FLOOR_PHYSICAL, ceiling_w),
        height.clamp(POPOUT_SIZE_FLOOR_PHYSICAL, ceiling_h),
    )
}

/// Floor applied to the main window's min-size constraint while pop-out is
/// active (Linux only, prexu-6qi5.4). `tauri.conf.json`'s main window
/// `minWidth`/`minHeight` (800x600) is enforced by GTK via
/// `gtk_window_set_geometry_hints` + `GDK_HINT_MIN_SIZE` — on Wayland this
/// becomes an `xdg_toplevel.set_min_size` request, a real compositor-side
/// floor that clamps BOTH `set_size` calls and interactive edge-drag resizes
/// (see tao's `platform_impl::linux::util::set_size_constraints`). The
/// default pop-out size (480x270) is well under 800x600, so without lifting
/// this floor first the compositor silently clamps the shrink request back
/// up to the main window's minimum. A small non-zero floor (rather than no
/// floor at all) keeps the mini player from being drag-resized down to a
/// degenerate size.
///
/// LOGICAL pixels, deliberately: min-size constraints in tauri.conf.json are
/// logical, and a logical floor scales sensibly on HiDPI (200x120 logical is
/// 400x240 physical at scale 2 — still a usable mini player, whereas a
/// physical floor would shrink relative to the UI as scale grows).
#[cfg(target_os = "linux")]
const POPOUT_MIN_WIDTH: f64 = 200.0;
#[cfg(target_os = "linux")]
const POPOUT_MIN_HEIGHT: f64 = 120.0;

/// Fallback min-size (LOGICAL pixels) restored on pop-out exit when the main
/// window's `WindowConfig` has no `minWidth`/`minHeight` set. The primary
/// source is `app.config().app.windows` looked up by window label (see
/// `configured_main_min_size`), which tracks `tauri.conf.json` automatically;
/// these constants only matter if that config entry is missing or has no
/// min-size — they mirror the current tauri.conf.json values (800x600).
#[cfg(target_os = "linux")]
const MAIN_MIN_WIDTH_FALLBACK: f64 = 800.0;
#[cfg(target_os = "linux")]
const MAIN_MIN_HEIGHT_FALLBACK: f64 = 600.0;

/// Thin accessor for the pop-out store keys. Wraps the key-string
/// constants so call sites name what they're reading/writing rather than
/// repeating raw string literals. All methods are zero-cost (inline).
///
/// Testable: `key_*` methods are pure; JSON round-trips are tested in
/// the `tests` module below.
pub(crate) struct PopoutStore;

impl PopoutStore {
    pub(crate) fn path() -> &'static str {
        POPOUT_STORE_PATH
    }
    pub(crate) fn key_corner() -> &'static str {
        POPOUT_KEY_CORNER
    }
    pub(crate) fn key_size() -> &'static str {
        POPOUT_KEY_SIZE
    }
    /// Monitor persistence is Windows-only (prexu-ajn) — Linux opens the
    /// popout on the main window's current monitor.
    #[cfg(target_os = "windows")]
    pub(crate) fn key_monitor() -> &'static str {
        POPOUT_KEY_MONITOR
    }
}

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
    use windows::Win32::Graphics::Gdi::{MonitorFromWindow, MONITOR_DEFAULTTONEAREST};
    let hwnd = main
        .hwnd()
        .map_err(|e| format!("get main hwnd failed: {}", e))?;
    unsafe {
        let hmonitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        log::debug!(
            "[player:popout] MonitorFromWindow HWND={:?} -> HMONITOR={:?}",
            hwnd.0,
            hmonitor.0
        );
        let info = monitor_info(hmonitor)?;
        let (x, y, w, h) = work_area_from_info(&info);
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
    use windows::Win32::Graphics::Gdi::{MonitorFromWindow, MONITOR_DEFAULTTONEAREST};
    let hwnd = main
        .hwnd()
        .map_err(|e| format!("get main hwnd failed: {}", e))?;
    unsafe {
        let hmonitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        log::debug!(
            "[player:popout] capture_monitor_record MonitorFromWindow HWND={:?} -> HMONITOR={:?}",
            hwnd.0,
            hmonitor.0
        );
        // monitor_info fills MONITORINFOEXW (cbSize = sizeof(MONITORINFOEXW)),
        // which causes Win32 to populate szDevice in addition to the base
        // MONITORINFO fields. See win32_monitor::monitor_info for the safety
        // contract.
        let info = monitor_info(hmonitor)?;
        let work_area = work_area_from_info(&info);
        let device_name = decode_device_name(&info.szDevice);

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
    use windows::Win32::Graphics::Gdi::EnumDisplayMonitors;

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

        // monitor_info fills MONITORINFOEXW so we get szDevice + rcWork in
        // one call. If the call fails for this monitor we skip it and
        // continue enumeration.
        let info = match monitor_info(hmonitor) {
            Ok(i) => i,
            Err(_) => return windows::core::BOOL(1),
        };

        let name = decode_device_name(&info.szDevice);

        log::debug!(
            "[player:popout] EnumDisplayMonitors: device={:?} HMONITOR={:?}",
            name.as_str(),
            hmonitor.0
        );

        if name == state.target {
            state.found = Some(work_area_from_info(&info));
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
fn load_persisted_popout(app: &AppHandle) -> (MinimizeCorner, u32, u32) {
    let mut corner = MinimizeCorner::BottomRight;
    let mut width = POPOUT_DEFAULT_WIDTH;
    let mut height = POPOUT_DEFAULT_HEIGHT;
    if let Ok(store) = app.store(PopoutStore::path()) {
        if let Some(v) = store.get(PopoutStore::key_corner()) {
            match serde_json::from_value::<MinimizeCorner>(v.clone()) {
                Ok(c) => corner = c,
                Err(e) => log::warn!(
                    "[player:popout] persisted corner unrecognised ({:?}), using default: {}",
                    v, e
                ),
            }
        }
        if let Some(v) = store.get(PopoutStore::key_size()) {
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
    let store = app.store(PopoutStore::path()).ok()?;
    let v = store.get(PopoutStore::key_monitor())?;
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
// reason: geometry helper taking window + work-area rect endpoints; grouping
// into structs would obscure the endpoint-by-endpoint corner comparison
#[allow(clippy::too_many_arguments)]
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
    {
        let had = state.geom.lock().map(|g| g.minimize.is_some()).unwrap_or(false);
        if had {
            log::debug!("[player:popout] clearing leftover minimize inset on enter");
        }
        let _ = state.set_minimize(None);
    }

    // prexu-ajn: resolve the target work area from the persisted monitor
    // (if any) rather than always using MonitorFromWindow(main). After
    // exit_popout restores main to its original monitor, the main window
    // is back on monitor 1 -- but the user may have dragged the popout to
    // monitor 2 before exiting. We now persist the monitor at exit and look
    // it up by device name here, so re-entry opens on monitor 2.
    let (wx, wy, ww, wh) = resolve_enter_work_area(&main, &app)?;
    let (width, height) = sanitize_popout_size(width, height, ww, wh);
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
    // Drop the OS title bar so the floating window reads as a clean mini-
    // player, not a shrunk app (prexu-6qz). Use tao's set_decorations rather
    // than a raw Win32 SetWindowLongPtr(GWL_STYLE): doing it behind tao's
    // back desynced tao's cached window size from the WebView2 client area
    // (the mpv host and the React chrome ended up different sizes on
    // drag/resize — the visible seam) and tao re-applied WS_CAPTION on the
    // next window event, so the borderless state didn't stick. tao retains
    // the WS_THICKFRAME sizing border for a resizable window, so the user can
    // still drag the edges to resize; the body is dragged via the frontend
    // data-tauri-drag-region strip.
    main.set_decorations(false)
        .map_err(|e| format!("popout set_decorations(false) failed: {}", e))?;
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
    resync_host(&main, &state);

    // Under composition hosting the video is composited on the main HWND's own
    // surface, so `set_always_on_top` above already floats the video with the
    // WebView — there is no separate host window to flag topmost or re-anchor.

    // Persist the chosen corner + size for next session. A failure here is
    // not fatal — the user can re-enter pop-out and we'll save again.
    match app.store(PopoutStore::path()) {
        Ok(store) => {
            // Serialize the enum back to its kebab-case string to keep the
            // on-disk format stable (old user data remains compatible).
            let corner_str = serde_json::to_value(corner)
                .unwrap_or_else(|_| serde_json::Value::String(POPOUT_DEFAULT_CORNER.to_string()));
            store.set(PopoutStore::key_corner(), corner_str);
            store.set(
                PopoutStore::key_size(),
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

            // prexu-r6k8: guard the persist path with the SAME sanity check
            // used on enter, so a size that's still fullscreen-ish at exit
            // (e.g. a future resize regression, or a Linux popout that never
            // actually shrank) can't re-entrench itself in the store for
            // every subsequent cycle to replay. Fail OPEN (treat as sane)
            // when the work area couldn't be determined — we'd rather persist
            // an unverified size than silently stop persisting resizes.
            let size_is_sane = match &current_wa {
                Ok((_, _, ww, wh)) => is_sane_popout_size(rw as u32, rh as u32, *ww, *wh),
                Err(_) => true,
            };
            match app.store(PopoutStore::path()) {
                Ok(store) => {
                    if let Some(corner) = detected_corner {
                        let corner_str = serde_json::to_value(corner).unwrap_or_else(|_| {
                            serde_json::Value::String(POPOUT_DEFAULT_CORNER.to_string())
                        });
                        store.set(PopoutStore::key_corner(), corner_str);
                    }
                    if size_is_sane {
                        store.set(
                            PopoutStore::key_size(),
                            serde_json::json!({ "width": rw, "height": rh }),
                        );
                    } else {
                        log::warn!(
                            "[player:popout] exit: current size {}x{} looks corrupted (fullscreen-ish \
                             relative to work area {:?}, prexu-r6k8) — skipping size persistence so it \
                             can't re-enter the store",
                            rw, rh, current_wa
                        );
                    }
                    // prexu-ajn: persist the monitor record so re-entry can
                    // target the correct monitor even after main has been
                    // restored to a different one.
                    if let Some(ref rec) = monitor_record {
                        let wa = &rec.work_area;
                        store.set(
                            PopoutStore::key_monitor(),
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
                            "[player:popout] persisted exit geometry corner={:?} size={:?} monitor={:?}",
                            detected_corner,
                            size_is_sane.then_some((rw, rh)),
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

    // Under composition hosting there is no separate host window to clear
    // topmost on or re-anchor — `set_always_on_top(false)` above returns the
    // single composited HWND (video + WebView) to the regular z-order.

    let stash = state
        .pre_popout_geometry
        .lock()
        .ok()
        .and_then(|mut g| g.take());

    let Some((x, y, w, h)) = stash else {
        log::debug!("[player:popout] exit_popout: no stash, only cleared always-on-top");
        return Ok(());
    };

    // Restore the OS title bar. The host-window-busy / host-window-ready
    // events emitted around this command defer the WebView2 transparent
    // re-arm past tao's frame change, so the decoration restore doesn't black
    // the window on exit (the regression that sank prexu-6qz attempt 1).
    main.set_decorations(true)
        .map_err(|e| format!("popout set_decorations(true) failed: {}", e))?;
    write_window_rect(&main, x, y, w as i32, h as i32)
        .map_err(|e| format!("popout restore apply failed: {}", e))?;

    log::debug!(
        "[player:popout] restored main to ({},{},{}x{}) via SetWindowPos; resynced host",
        x, y, w, h
    );

    resync_host(&main, &state);

    // Transition complete — re-arm the transparent body class. The TS hook
    // defers the re-add by a rAF + sync layout read so WebView2 commits the
    // dashboard paint before transparency comes back (prexu-7d3, same paint-
    // commit trick as the prexu-uzk dashboard reflow fix).
    let _ = app.emit("player://host-window-ready", ());

    Ok(())
}

// ── Linux implementation (prexu-axj4.10) ───────────────────────────────────
//
// Same UX as the Windows commands above, driven through Tauri/GTK window ops.
// See the module docs for the platform split and the Wayland caveats.

/// True when the app is running on a Wayland session (and not forced onto
/// X11/XWayland via `GDK_BACKEND=x11`). Env-var heuristic: authoritative
/// backend detection needs the GTK display type on the main thread, and the
/// decisions this gates are benign on a mis-detect (a skipped corner
/// persistence or a harmless no-op move request).
#[cfg(target_os = "linux")]
fn linux_is_wayland() -> bool {
    if std::env::var("GDK_BACKEND")
        .map(|v| v.contains("x11"))
        .unwrap_or(false)
    {
        return false;
    }
    std::env::var("WAYLAND_DISPLAY").is_ok()
        || std::env::var("XDG_SESSION_TYPE")
            .map(|v| v == "wayland")
            .unwrap_or(false)
}

/// Work area (physical px) of the monitor the main window is currently on.
/// Tauri's `Monitor::work_area()` subtracts docked panels on X11; on Wayland
/// it equals the monitor geometry, which is fine — there it only clamps the
/// popout size (placement is skipped, see module docs).
#[cfg(target_os = "linux")]
fn linux_work_area(main: &tauri::WebviewWindow) -> Result<(i32, i32, i32, i32), String> {
    let monitor = main
        .current_monitor()
        .map_err(|e| format!("current_monitor failed: {e}"))?
        .ok_or_else(|| "no monitor for main window".to_string())?;
    let wa = monitor.work_area();
    let (x, y, w, h) = (
        wa.position.x,
        wa.position.y,
        wa.size.width as i32,
        wa.size.height as i32,
    );
    log::debug!("[player:popout] current-monitor work area = ({x},{y},{w}x{h})");
    Ok((x, y, w, h))
}

/// Resolve the min-size (LOGICAL pixels) to restore on pop-out exit from the
/// static window config, looked up by window label. Pure so it's unit-testable
/// without a Tauri runtime; the caller passes `app.config().app.windows` and
/// `main.label()`. Missing config entry or unset `minWidth`/`minHeight` fall
/// back to `MAIN_MIN_*_FALLBACK` per-axis (config min-sizes are `Option<f64>`
/// logical pixels — see tauri-utils `WindowConfig`).
#[cfg(target_os = "linux")]
fn configured_main_min_size(
    windows: &[tauri::utils::config::WindowConfig],
    label: &str,
) -> (f64, f64) {
    let cfg = windows.iter().find(|w| w.label == label);
    if cfg.is_none() {
        log::warn!(
            "[player:popout] no window config with label {:?}, using fallback min-size {}x{}",
            label, MAIN_MIN_WIDTH_FALLBACK, MAIN_MIN_HEIGHT_FALLBACK
        );
    }
    let w = cfg
        .and_then(|c| c.min_width)
        .unwrap_or(MAIN_MIN_WIDTH_FALLBACK);
    let h = cfg
        .and_then(|c| c.min_height)
        .unwrap_or(MAIN_MIN_HEIGHT_FALLBACK);
    (w, h)
}

/// Enter pop-out mode (Linux): same contract as the Windows command above —
/// `Option` args mean "use the persisted geometry", the pre-pop-out geometry
/// is stashed in `PlayerState::pre_popout_geometry` for `player_exit_popout`
/// to restore.
#[cfg(target_os = "linux")]
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
        "[player:cmd] enter_popout (linux) corner={:?} size={}x{} wayland={}",
        corner,
        width,
        height,
        linux_is_wayland()
    );
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    // Pop-out and minimize are mutually exclusive (same frontend race as the
    // Windows command — see its doc). On Linux "minimize" is a set of
    // video-margin-ratio insets, so clear both the snapshot and the live
    // margins authoritatively before the popout geometry applies.
    if state.get_minimize().is_some() {
        log::debug!("[player:popout] clearing leftover minimize inset on enter");
        let _ = state.set_minimize(None);
        crate::player::linux_compositor::clear_margins_now(&app);
    }

    // Unmaximize BEFORE stashing/resizing (prexu-6qi5.4): a maximized GTK
    // toplevel ignores `gtk_window_resize` outright, and tao's own edge-drag
    // hit-test (`platform_impl::linux::event_loop`, `connect_button_press_event`)
    // explicitly requires `!window.is_maximized()` before it will start an
    // interactive resize. Without this, a maximized main window (very common
    // — many WMs/users default to it) stays fullscreen-sized in pop-out and
    // edge-drag resize is a silent no-op. Recorded so exit_popout can restore
    // the maximized state after putting the pre-popout geometry back.
    let was_maximized = main.is_maximized().unwrap_or_else(|e| {
        log::warn!("[player:popout] is_maximized query failed, assuming false: {e}");
        false
    });
    if was_maximized {
        log::debug!("[player:popout] main window is maximized, unmaximizing for popout resize");
        if let Err(e) = main.unmaximize() {
            log::warn!("[player:popout] unmaximize failed: {e}");
        }
    }
    if let Ok(mut m) = state.pre_popout_maximized.lock() {
        *m = Some(was_maximized);
    }

    // Stash the current geometry for exit_popout. inner_size (client area)
    // round-trips symmetrically through set_size; outer_size would grow the
    // window by the frame extents on every enter/exit cycle under X11
    // server-side decorations (same bug class as the Win11 ~7px drift the
    // Windows path solves with GetWindowRect). On Wayland the position is
    // meaningless, but the restore's set_position is a no-op there too, so
    // stashing whatever the backend reports is harmless. Captured AFTER the
    // unmaximize above so a previously-maximized window stashes its restored
    // (windowed) geometry rather than the full-screen maximized rect.
    let pos = main.outer_position().map(|p| (p.x, p.y)).unwrap_or_else(|e| {
        log::warn!("[player:popout] outer_position for stash failed: {e}");
        (0, 0)
    });
    let size = main
        .inner_size()
        .map_err(|e| format!("inner_size for stash failed: {e}"))?;
    if let Ok(mut g) = state.pre_popout_geometry.lock() {
        *g = Some((pos.0, pos.1, size.width, size.height));
        log::debug!(
            "[player:popout] stashed pre-popout geometry ({},{},{}x{})",
            pos.0,
            pos.1,
            size.width,
            size.height
        );
    }

    let (wx, wy, ww, wh) = linux_work_area(&main)?;
    let (width, height) = sanitize_popout_size(width, height, ww, wh);
    let (x, y, w, h) = corner_origin(corner, width, height, wx, wy, ww, wh);

    // keep-above is best-effort: real on X11, ignored by most Wayland
    // compositors (no protocol for it) — log, don't fail the command.
    if let Err(e) = main.set_always_on_top(true) {
        log::warn!("[player:popout] set_always_on_top(true) failed: {e}");
    }
    main.set_decorations(false)
        .map_err(|e| format!("popout set_decorations(false) failed: {e}"))?;

    // Lift the main window's min-size floor (prexu-6qi5.4) — see
    // POPOUT_MIN_WIDTH/HEIGHT doc comment. Without this, GTK's geometry
    // hints (the main window's configured 800x600 minimum) clamp the
    // resize below to 800x600 regardless of the requested 480x270, and
    // block edge-drag resize under that floor too. LogicalSize on purpose:
    // min-size constraints are logical throughout (config + GTK hints).
    log::debug!(
        "[player:popout] lifting main window min-size to {}x{} logical",
        POPOUT_MIN_WIDTH, POPOUT_MIN_HEIGHT
    );
    if let Err(e) = main.set_min_size(Some(tauri::LogicalSize::new(
        POPOUT_MIN_WIDTH,
        POPOUT_MIN_HEIGHT,
    ))) {
        log::warn!("[player:popout] set_min_size (popout floor) failed: {e}");
    }

    main.set_size(tauri::PhysicalSize::new(w, h))
        .map_err(|e| format!("popout resize failed: {e}"))?;
    if let Err(e) = main.set_position(tauri::PhysicalPosition::new(x, y)) {
        // X11 places the corner; Wayland ignores the request (shrink-in-place).
        log::warn!("[player:popout] set_position failed: {e}");
    }
    log::debug!("[player:popout] resized main to ({x},{y},{w}x{h})");

    // No host resync (a Windows-only concept): the GLArea render target
    // follows the GTK allocation change from set_size automatically.

    // Persist the chosen corner + size for next session (same store + keys
    // as Windows). A failure here is not fatal.
    match app.store(PopoutStore::path()) {
        Ok(store) => {
            let corner_str = serde_json::to_value(corner)
                .unwrap_or_else(|_| serde_json::Value::String(POPOUT_DEFAULT_CORNER.to_string()));
            store.set(PopoutStore::key_corner(), corner_str);
            store.set(
                PopoutStore::key_size(),
                serde_json::json!({ "width": w, "height": h }),
            );
            if let Err(e) = store.save() {
                log::warn!("[player:popout] store save failed: {:?}", e);
            } else {
                log::debug!("[player:popout] persisted corner={:?} size={}x{}", corner, w, h);
            }
        }
        Err(e) => log::warn!("[player:popout] store open failed: {:?}", e),
    }

    Ok(())
}

/// Exit pop-out mode (Linux): persist the user's current size (+ nearest
/// corner when the backend reports real coordinates — X11), clear
/// always-on-top, and restore the stashed pre-pop-out geometry.
#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn player_exit_popout(
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] exit_popout (linux)");
    // busy/ready bracket kept for the cross-platform prexu-7d3 contract;
    // Linux's useTransparentWindow deliberately ignores busy (prexu-hg1j).
    let _ = app.emit("player://host-window-busy", ());
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    // Persist the user's drag/resize BEFORE restoring, so the next enter
    // reopens where they left it — same round-trip as Windows. On Wayland
    // the position is meaningless: persist only the size and keep the
    // previously persisted corner.
    if let Ok(size) = main.inner_size() {
        // Computed unconditionally (not just for X11 corner detection) —
        // prexu-r6k8's size-sanity check below needs the work area on
        // Wayland too, even though position/corner persistence stays
        // skipped there.
        let work_area = linux_work_area(&main);
        let detected_corner = if linux_is_wayland() {
            None
        } else {
            match (main.outer_position(), &work_area) {
                (Ok(pos), Ok((wx, wy, ww, wh))) => Some(nearest_corner(
                    pos.x,
                    pos.y,
                    size.width as i32,
                    size.height as i32,
                    *wx,
                    *wy,
                    *ww,
                    *wh,
                )),
                _ => {
                    log::warn!("[player:popout] exit: position/work-area unavailable, corner persistence skipped");
                    None
                }
            }
        };
        // prexu-r6k8: guard the persist path with the SAME sanity check used
        // on enter (`sanitize_popout_size`), so a size that's still
        // fullscreen-ish at exit — e.g. the popout never actually shrank —
        // can't re-entrench itself in the store for every subsequent cycle
        // to replay. Fail OPEN when the work area is unavailable; we'd
        // rather persist an unverified size than silently stop persisting.
        let size_is_sane = match &work_area {
            Ok((_, _, ww, wh)) => is_sane_popout_size(size.width, size.height, *ww, *wh),
            Err(_) => true,
        };
        match app.store(PopoutStore::path()) {
            Ok(store) => {
                if let Some(c) = detected_corner {
                    let corner_str = serde_json::to_value(c).unwrap_or_else(|_| {
                        serde_json::Value::String(POPOUT_DEFAULT_CORNER.to_string())
                    });
                    store.set(PopoutStore::key_corner(), corner_str);
                }
                if size_is_sane {
                    store.set(
                        PopoutStore::key_size(),
                        serde_json::json!({ "width": size.width, "height": size.height }),
                    );
                } else {
                    log::warn!(
                        "[player:popout] exit: current size {}x{} looks corrupted (fullscreen-ish \
                         relative to work area {:?}, prexu-r6k8) — skipping size persistence so it \
                         can't re-enter the store",
                        size.width, size.height, work_area
                    );
                }
                if let Err(e) = store.save() {
                    log::warn!("[player:popout] resize-on-exit save failed: {:?}", e);
                } else {
                    log::info!(
                        "[player:popout] persisted exit geometry corner={:?} size={:?}",
                        detected_corner,
                        size_is_sane.then_some((size.width, size.height))
                    );
                }
            }
            Err(e) => log::warn!("[player:popout] resize-on-exit store open failed: {:?}", e),
        }
    }

    if let Err(e) = main.set_always_on_top(false) {
        log::warn!("[player:popout] set_always_on_top(false) failed: {e}");
    }

    // Take the pre-popout maximized flag alongside the geometry stash
    // (prexu-6qi5.4) so a stray `Some` from an unpaired enter/exit never
    // leaks into a later session. `unwrap_or(false)` treats "never recorded"
    // (e.g. exit called without a prior enter) the same as "was not
    // maximized" — a plain geometry restore with no re-maximize step.
    let was_maximized = state
        .pre_popout_maximized
        .lock()
        .ok()
        .and_then(|mut m| m.take())
        .unwrap_or(false);

    let stash = state
        .pre_popout_geometry
        .lock()
        .ok()
        .and_then(|mut g| g.take());

    let Some((x, y, w, h)) = stash else {
        log::debug!("[player:popout] exit_popout: no stash, only cleared always-on-top");
        let _ = app.emit("player://host-window-ready", ());
        return Ok(());
    };

    // Restore the main window's min-size floor (prexu-6qi5.4) before the
    // geometry restore below, so post-exit drag-resizing below the app's
    // normal minimum is rejected again, matching pre-popout behaviour.
    // `set_min_size` has no read accessor, but the STATIC config the window
    // was built from is available at runtime via `app.config().app.windows`
    // — restore from there (logical pixels, same units the config declares)
    // so this never drifts from tauri.conf.json. LogicalSize is load-bearing:
    // restoring the same numbers as PhysicalSize would halve the effective
    // floor on a scale-2 HiDPI display.
    let (min_w, min_h) = configured_main_min_size(&app.config().app.windows, main.label());
    log::debug!(
        "[player:popout] restoring main window min-size to {}x{} logical (from window config)",
        min_w, min_h
    );
    if let Err(e) = main.set_min_size(Some(tauri::LogicalSize::new(min_w, min_h))) {
        log::warn!("[player:popout] set_min_size (restore) failed: {e}");
    }

    main.set_decorations(true)
        .map_err(|e| format!("popout set_decorations(true) failed: {e}"))?;
    main.set_size(tauri::PhysicalSize::new(w, h))
        .map_err(|e| format!("popout restore resize failed: {e}"))?;
    if let Err(e) = main.set_position(tauri::PhysicalPosition::new(x, y)) {
        log::warn!("[player:popout] restore set_position failed: {e}");
    }
    log::debug!("[player:popout] restored main to ({x},{y},{w}x{h})");

    // Re-maximize AFTER restoring the windowed geometry above (prexu-6qi5.4)
    // — the geometry restore becomes the "normal" size GTK remembers for a
    // future unmaximize, and maximize() then re-enters the fullscreen state
    // the user had before entering pop-out.
    if was_maximized {
        log::info!("[player:popout] re-maximizing main window (was maximized before popout)");
        if let Err(e) = main.maximize() {
            log::warn!("[player:popout] re-maximize failed: {e}");
        }
    }

    // Transition complete — re-arm the transparent body class (prexu-7d3).
    let _ = app.emit("player://host-window-ready", ());

    Ok(())
}

// Pure geometry + store-key tests run on both platforms (the helpers are
// shared since the Linux port, prexu-axj4.10); only the monitor-persistence
// key accessor is Windows-gated.
#[cfg(test)]
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

    // ---- sanitize_popout_size / is_sane_popout_size (prexu-r6k8) -----------
    //
    // Regression coverage for a hardware-confirmed self-perpetuating bug: a
    // Linux popout that silently failed to shrink (pre PR #52) persisted its
    // still-fullscreen size on exit; every subsequent enter/exit replayed
    // (and re-persisted) that oversized value forever, because
    // `corner_origin`'s own clamp only guarantees a request fits the work
    // area, not that it looks like an actual pop-out.

    #[test]
    fn sanitize_popout_size_resets_hardware_repro_to_default() {
        // Exact hardware repro: persisted 1920x2160 replayed onto a
        // 3840x2160 work area (both well within `corner_origin`'s
        // fits-the-monitor clamp, so that clamp alone never catches it).
        let (w, h) = sanitize_popout_size(1920, 2160, 3840, 2160);
        assert_eq!((w, h), (POPOUT_DEFAULT_WIDTH, POPOUT_DEFAULT_HEIGHT));
    }

    #[test]
    fn sanitize_popout_size_passes_through_legitimate_size() {
        // 480x270 on a normal 1920x1080 monitor is well under 60% of either
        // dimension -- passes through unchanged.
        let (w, h) = sanitize_popout_size(480, 270, 1920, 1080);
        assert_eq!((w, h), (480, 270));
    }

    #[test]
    fn sanitize_popout_size_clamps_degenerate_size_to_floor() {
        // A near-zero persisted size (e.g. from a corrupted store write)
        // clamps up to the absolute floor rather than passing through.
        let (w, h) = sanitize_popout_size(10, 10, 1920, 1080);
        assert_eq!((w, h), (POPOUT_SIZE_FLOOR_PHYSICAL, POPOUT_SIZE_FLOOR_PHYSICAL));
    }

    #[test]
    fn sanitize_popout_size_boundary_at_exact_ratio_is_accepted() {
        // Exactly at the 60% ceiling is accepted (not treated as corrupted);
        // one physical pixel over is reset to default.
        let (w, h) = sanitize_popout_size(1152, 648, 1920, 1080);
        assert_eq!((w, h), (1152, 648));

        let (w, h) = sanitize_popout_size(1153, 648, 1920, 1080);
        assert_eq!((w, h), (POPOUT_DEFAULT_WIDTH, POPOUT_DEFAULT_HEIGHT));
    }

    #[test]
    fn sanitize_popout_size_height_alone_over_ceiling_resets() {
        // Width passes but height alone exceeds the ceiling -- still reset
        // (mirrors the hardware repro, where width also happened to pass).
        let (w, h) = sanitize_popout_size(200, 2160, 3840, 2160);
        assert_eq!((w, h), (POPOUT_DEFAULT_WIDTH, POPOUT_DEFAULT_HEIGHT));
    }

    #[test]
    fn sanitize_popout_size_tiny_work_area_keeps_valid_range() {
        // A work area so small that 60% of it would fall below the floor
        // must not panic (clamp requires min <= max) and still returns a
        // usable size.
        let (w, h) = sanitize_popout_size(50, 50, 120, 120);
        assert_eq!((w, h), (POPOUT_SIZE_FLOOR_PHYSICAL, POPOUT_SIZE_FLOOR_PHYSICAL));
    }

    #[test]
    fn is_sane_popout_size_matches_sanitize_accept_reject() {
        assert!(is_sane_popout_size(480, 270, 1920, 1080));
        assert!(!is_sane_popout_size(1920, 2160, 3840, 2160));
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

    // ---- PopoutStore key mapping -------------------------------------------
    //
    // PopoutStore is a pure key-string accessor — fully testable without
    // Win32 or a Tauri runtime.

    #[test]
    fn popout_store_path_is_correct_filename() {
        assert_eq!(PopoutStore::path(), "popout-player.json");
    }

    #[test]
    fn popout_store_key_corner_matches_constant() {
        assert_eq!(PopoutStore::key_corner(), POPOUT_KEY_CORNER);
    }

    #[test]
    fn popout_store_key_size_matches_constant() {
        assert_eq!(PopoutStore::key_size(), POPOUT_KEY_SIZE);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn popout_store_key_monitor_matches_constant() {
        assert_eq!(PopoutStore::key_monitor(), POPOUT_KEY_MONITOR);
    }

    #[test]
    fn popout_store_corner_and_size_keys_are_distinct() {
        assert_ne!(PopoutStore::key_corner(), PopoutStore::key_size());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn popout_store_monitor_key_is_distinct() {
        // Guard against accidental aliasing with the monitor key (Windows-only).
        assert_ne!(PopoutStore::key_corner(), PopoutStore::key_monitor());
        assert_ne!(PopoutStore::key_size(), PopoutStore::key_monitor());
    }

    // ---- configured_main_min_size (prexu-6qi5.4 review fix) --------------
    //
    // Pure lookup over the static window config — testable without a Tauri
    // runtime via WindowConfig::default(). Values are LOGICAL pixels.

    #[cfg(target_os = "linux")]
    mod configured_min_size {
        use super::super::*;
        use tauri::utils::config::WindowConfig;

        fn window(label: &str, min_w: Option<f64>, min_h: Option<f64>) -> WindowConfig {
            WindowConfig {
                label: label.to_string(),
                min_width: min_w,
                min_height: min_h,
                ..Default::default()
            }
        }

        #[test]
        fn reads_configured_values_for_matching_label() {
            let windows = [window("main", Some(800.0), Some(600.0))];
            assert_eq!(configured_main_min_size(&windows, "main"), (800.0, 600.0));
        }

        #[test]
        fn picks_the_window_matching_the_label_not_the_first() {
            let windows = [
                window("splash", Some(100.0), Some(50.0)),
                window("main", Some(800.0), Some(600.0)),
            ];
            assert_eq!(configured_main_min_size(&windows, "main"), (800.0, 600.0));
        }

        #[test]
        fn falls_back_when_label_not_found() {
            let windows = [window("other", Some(320.0), Some(240.0))];
            assert_eq!(
                configured_main_min_size(&windows, "main"),
                (MAIN_MIN_WIDTH_FALLBACK, MAIN_MIN_HEIGHT_FALLBACK)
            );
        }

        #[test]
        fn falls_back_when_config_list_is_empty() {
            assert_eq!(
                configured_main_min_size(&[], "main"),
                (MAIN_MIN_WIDTH_FALLBACK, MAIN_MIN_HEIGHT_FALLBACK)
            );
        }

        #[test]
        fn falls_back_per_axis_when_min_size_unset() {
            // minWidth set but minHeight absent — each axis falls back
            // independently.
            let windows = [window("main", Some(1024.0), None)];
            assert_eq!(
                configured_main_min_size(&windows, "main"),
                (1024.0, MAIN_MIN_HEIGHT_FALLBACK)
            );
        }

        #[test]
        fn fallback_constants_mirror_tauri_conf_json() {
            // tauri.conf.json declares minWidth 800 / minHeight 600 for the
            // main window; the fallbacks must mirror it so behaviour is the
            // same whether or not the config lookup succeeds.
            assert_eq!(MAIN_MIN_WIDTH_FALLBACK, 800.0);
            assert_eq!(MAIN_MIN_HEIGHT_FALLBACK, 600.0);
        }
    }

}
