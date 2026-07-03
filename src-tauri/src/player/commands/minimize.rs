//! In-window minimize commands.
//!
//! Keeps the Tauri main window full size and only constrains the rendered
//! video to a small inset of the WebView client area. The rest of the
//! WebView remains interactive so the user can browse the Library, check
//! cast/crew, etc. while the small video region keeps playing in the corner.
//!
//! Two different mechanisms implement the same user-visible inset:
//! - **Windows**: a separate Win32 mpv host window is repositioned to the
//!   corner rect (see the `resync_host` / `win32_monitor` path below).
//! - **Linux** (prexu-axj4.5): there is no separate host window — mpv renders
//!   into a `GtkGLArea` spanning the whole window, composited UNDER the
//!   transparent WebKitWebView (see `player::linux_compositor`). The inset is
//!   achieved by setting mpv's `video-margin-ratio-left/right/top/bottom`
//!   properties, which tell mpv to keep video out of those fractional
//!   margins and fit/letterbox it into what remains.
//!
//! Both platforms share the pure `compute_minimize_state` defaulting logic
//! and the same command names/signatures, so the frontend IPC surface is
//! identical regardless of platform.

use tauri::{AppHandle, Emitter, State};
#[cfg(target_os = "windows")]
use tauri::Manager;

use crate::player::{MinimizeCorner, MinimizeState, PlayerState};
#[cfg(target_os = "windows")]
use super::win32_monitor::resync_host;

const MINIMIZE_DEFAULT_PADDING: u32 = 16;

/// Pure core: apply the optional-with-default IPC arguments and produce the
/// `MinimizeState` value that `enter_minimize` and `update_mini_geometry`
/// both store. Extracted so the state-transition logic is unit-testable
/// without an `AppHandle` or a Tauri runtime. Shared by both the Windows and
/// Linux command bodies below.
///
/// `padding` defaults to `MINIMIZE_DEFAULT_PADDING` (16 logical px).
/// `corner` defaults to `MinimizeCorner::BottomRight`.
pub(crate) fn compute_minimize_state(
    width: u32,
    height: u32,
    padding: Option<u32>,
    corner: Option<MinimizeCorner>,
) -> MinimizeState {
    MinimizeState {
        width,
        height,
        padding: padding.unwrap_or(MINIMIZE_DEFAULT_PADDING),
        corner: corner.unwrap_or(MinimizeCorner::BottomRight),
    }
}

/// Enter minimize mode: store the (corner, width, height, padding) of the
/// desired inset rect in PlayerState and force a host resync so the mpv
/// window shrinks to the chosen corner of the current WebView client area.
///
/// Omitting `corner` preserves the default bottom-right placement. The
/// host re-snaps to the chosen corner on every Resized event via
/// `apply_minimize_inset`, so the small region tracks the corner regardless
/// of subsequent window resizes.
///
/// Re-entrant: calling this again while already in minimize mode (e.g. the
/// React side dragging the resize handle or moving to a different corner)
/// updates the inset in place. The synchronous resync via
/// `apply_host_geometry` makes the new geometry visible within one frame.
///
/// Mutual exclusion with pop-out is handled at the React button layer so
/// the IPC contract stays simple — this command itself does not touch
/// popout state.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_enter_minimize(
    width: u32,
    height: u32,
    padding: Option<u32>,
    corner: Option<MinimizeCorner>,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    // Drop body.player-transparent for the transition (prexu-7d3). When
    // chained after exit_popout (popout → minimize), the WebView has just
    // restored to full-main size and the underlying route may still be
    // painting. Re-armed after the host inset is applied.
    let _ = app.emit("player://host-window-busy", ());
    let new_state = compute_minimize_state(width, height, padding, corner);
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    // The frontend passes width / height / padding in CSS (logical) pixels
    // so the mini chrome and the AppLayout mask hole are sized consistently
    // across DPI scales. We store the logical px here verbatim and refresh
    // the cached `scale_factor` from the live main window;
    // `apply_minimize_inset` then multiplies by the cached scale on every
    // host placement.
    //
    // This makes cross-monitor DPI changes (WM_DPICHANGED → Tauri's
    // WindowEvent::ScaleFactorChanged) Just Work — the handler updates
    // the cached scale and the very next `sync_geometry` produces the
    // correct host rect for the new monitor's DPI without re-issuing
    // this IPC from React.
    let scale = main.scale_factor().unwrap_or(1.0);
    state.set_scale_factor(scale);
    log::info!(
        "[player:cmd] enter_minimize size={}x{} padding={} corner={:?} scale={:.2} (logical px stored)",
        width, height, new_state.padding, new_state.corner, scale
    );

    state.set_minimize(Some(new_state))?;

    // Force resync now so the host shrinks immediately rather than waiting
    // for the next window event. apply_host_geometry honors the inset.
    resync_host(&main, &state);

    // Transition complete — re-arm transparent body (prexu-7d3).
    let _ = app.emit("player://host-window-ready", ());
    Ok(())
}

/// Geometry-only update while already in minimize mode.
///
/// Updates the stored inset (corner, width, height, padding) and forces
/// an immediate host resync — identical geometry work to `enter_minimize`
/// but WITHOUT emitting `player://host-window-busy` / `player://host-window-ready`.
///
/// The busy/ready pair was added (prexu-7d3) for genuine mode transitions
/// (popout ↔ minimize) where the host window is recreated. Per-tick drag
/// and resize updates are NOT transitions — the host is already minimized,
/// only its inset rect is moving. Emitting busy/ready on every 33ms resize
/// tick caused `useTransparentWindow` to drop and re-arm body transparency
/// on each tick, producing the thrashing background visible during drag.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_update_mini_geometry(
    width: u32,
    height: u32,
    padding: Option<u32>,
    corner: Option<MinimizeCorner>,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    let new_state = compute_minimize_state(width, height, padding, corner);
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    let scale = main.scale_factor().unwrap_or(1.0);
    state.set_scale_factor(scale);
    log::debug!(
        "[player:cmd] update_mini_geometry size={}x{} padding={} corner={:?} scale={:.2}",
        width, height, new_state.padding, new_state.corner, scale
    );

    state.set_minimize(Some(new_state))?;

    resync_host(&main, &state);

    // Intentionally NO busy/ready emit here — this is a geometry-only
    // update, not a mode transition. Emitting busy/ready on every drag
    // tick causes useTransparentWindow to thrash body transparency.
    Ok(())
}

/// Exit minimize mode: clear the inset and force a host resync so the
/// mpv window expands back to the full WebView client area.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_exit_minimize(
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] exit_minimize");
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    state.set_minimize(None)?;

    resync_host(&main, &state);
    Ok(())
}

// ── Linux commands (prexu-axj4.5) ──────────────────────────────────────────
//
// Same names/signatures as the Windows commands above, but instead of
// repositioning a Win32 host window, these compute and apply mpv's
// `video-margin-ratio-*` properties against the GtkGLArea's current logical
// allocation. All GTK/mpv-handle marshalling lives in `linux_compositor`
// (`apply_margins_now` / `clear_margins_now`), which dispatches onto the GTK
// main thread and blocks (with a timeout) until the properties are applied —
// this keeps these commands synchronous like their Windows counterparts.

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn player_enter_minimize(
    width: u32,
    height: u32,
    padding: Option<u32>,
    corner: Option<MinimizeCorner>,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    // See the Windows `player_enter_minimize` doc comment for why this pair
    // brackets genuine mode transitions (prexu-7d3): dropped here, re-armed
    // after the new margins are applied below.
    let _ = app.emit("player://host-window-busy", ());
    let new_state = compute_minimize_state(width, height, padding, corner);
    log::info!(
        "[player:cmd] enter_minimize (linux) size={}x{} padding={} corner={:?}",
        width, height, new_state.padding, new_state.corner
    );
    state.set_minimize(Some(new_state))?;
    crate::player::linux_compositor::apply_margins_now(&app);
    let _ = app.emit("player://host-window-ready", ());
    Ok(())
}

/// Geometry-only update while already in minimize mode. Identical work to
/// `player_enter_minimize` but WITHOUT the busy/ready event pair — see the
/// Windows `player_update_mini_geometry` doc comment: per-tick drag/resize
/// updates are not mode transitions and must not thrash body transparency.
#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn player_update_mini_geometry(
    width: u32,
    height: u32,
    padding: Option<u32>,
    corner: Option<MinimizeCorner>,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    let new_state = compute_minimize_state(width, height, padding, corner);
    log::debug!(
        "[player:cmd] update_mini_geometry (linux) size={}x{} padding={} corner={:?}",
        width, height, new_state.padding, new_state.corner
    );
    state.set_minimize(Some(new_state))?;
    crate::player::linux_compositor::apply_margins_now(&app);
    // Intentionally NO busy/ready emit here — matches the Windows contract.
    Ok(())
}

/// Exit minimize mode: clear the stored inset and reset all four
/// `video-margin-ratio-*` properties to 0.0 so mpv fills the whole GLArea
/// again.
#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn player_exit_minimize(
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] exit_minimize (linux)");
    state.set_minimize(None)?;
    crate::player::linux_compositor::clear_margins_now(&app);
    Ok(())
}

/// Fraction of a margin ratio (`video-margin-ratio-*`) beyond which the
/// remaining video area on that axis would be a sliver or gone entirely.
/// Individual ratios and axis-pair sums are clamped to this bound rather
/// than `1.0` so a degenerate request (window smaller than the requested
/// rect + padding, or padding alone larger than the window) always leaves
/// mpv with *some* visible video area instead of a fully collapsed one.
#[cfg(target_os = "linux")]
const MAX_MARGIN_RATIO: f64 = 0.99;

/// One axis (width or height) of the margin computation. Returns
/// `(padding_side_ratio, far_side_ratio)`:
/// - `padding_side` is the margin touching the anchored corner —
///   always `padding / total`.
/// - `far_side` is the margin on the opposite edge —
///   `(total - size - padding) / total`.
///
/// Each ratio is clamped to `[0.0, MAX_MARGIN_RATIO]` individually. If their
/// sum would still leave no room (or negative room) for the video — the
/// degenerate case where the window is smaller than the requested rect plus
/// padding — `far_side` is shrunk further so the pair never inverts or
/// overlaps, and a `warn` is logged.
#[cfg(target_os = "linux")]
fn axis_margins(total: f64, size: f64, padding: f64, axis: &str, corner: MinimizeCorner) -> (f64, f64) {
    let padding_side = (padding / total).clamp(0.0, MAX_MARGIN_RATIO);
    let far_side_raw = (total - size - padding) / total;
    let mut far_side = far_side_raw.clamp(0.0, MAX_MARGIN_RATIO);

    if far_side_raw < 0.0 {
        log::warn!(
            "[player:linux] compute_margin_ratios: {axis} axis rect+padding ({size}+{padding}) \
             exceeds window {total} for corner {corner:?}, clamping far margin to 0"
        );
    }

    if padding_side + far_side >= MAX_MARGIN_RATIO {
        let clamped = (MAX_MARGIN_RATIO - padding_side).max(0.0);
        log::warn!(
            "[player:linux] compute_margin_ratios: {axis} margins would invert/overlap \
             (padding={padding_side:.3} far={far_side:.3}), clamping far to {clamped:.3}"
        );
        far_side = clamped;
    }

    (padding_side, far_side)
}

/// Compute the four `video-margin-ratio-*` fractions (left, right, top,
/// bottom) that inset mpv's video area into the requested corner rect of a
/// `window_logical_w × window_logical_h` GtkGLArea allocation (logical
/// pixels — the same units GTK reports via `allocated_width`/
/// `allocated_height`).
///
/// mpv's `video-margin-ratio-*` properties are fractions (0.0..1.0) of the
/// surface dimension that mpv keeps clear of video, fitting/letterboxing the
/// video into what remains. Two properties bound each axis (left+right for
/// width, top+bottom for height); the corner anchors one side of each axis
/// at `padding` and lets the opposite side absorb the rest of the window.
///
/// Degenerate inputs (window smaller than the requested rect + padding, or
/// zero/negative window dimensions) are clamped so the margins never invert
/// or overlap — worst case the video area collapses to a sliver rather than
/// handing mpv a nonsensical negative or `>= 1.0` margin. Each occurrence is
/// logged at `warn`.
#[cfg(target_os = "linux")]
pub(crate) fn compute_margin_ratios(
    window_logical_w: i32,
    window_logical_h: i32,
    mini: MinimizeState,
) -> (f64, f64, f64, f64) {
    if window_logical_w <= 0 || window_logical_h <= 0 {
        log::warn!(
            "[player:linux] compute_margin_ratios: degenerate window {}x{}, using zero margins",
            window_logical_w, window_logical_h
        );
        return (0.0, 0.0, 0.0, 0.0);
    }
    let w = window_logical_w as f64;
    let h = window_logical_h as f64;
    let (padding_w, far_w) = axis_margins(w, mini.width as f64, mini.padding as f64, "width", mini.corner);
    let (padding_h, far_h) = axis_margins(h, mini.height as f64, mini.padding as f64, "height", mini.corner);

    // (left, right, top, bottom). The anchored side of each axis gets the
    // padding-side ratio; the opposite side absorbs the rest of the window.
    match mini.corner {
        MinimizeCorner::TopLeft => (padding_w, far_w, padding_h, far_h),
        MinimizeCorner::TopRight => (far_w, padding_w, padding_h, far_h),
        MinimizeCorner::BottomLeft => (padding_w, far_w, far_h, padding_h),
        MinimizeCorner::BottomRight => (far_w, padding_w, far_h, padding_h),
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    use crate::player::{MinimizeCorner, PlayerState};

    // ── compute_minimize_state: default application ──────────────────────
    //
    // Both `player_enter_minimize` and `player_update_mini_geometry` go
    // through this fn, so asserting its output covers the defaulting
    // behaviour of both commands.

    #[test]
    fn compute_minimize_state_explicit_padding_and_corner_stored_verbatim() {
        let s = compute_minimize_state(320, 180, Some(8), Some(MinimizeCorner::TopLeft));
        assert_eq!(s.width, 320);
        assert_eq!(s.height, 180);
        assert_eq!(s.padding, 8);
        assert_eq!(s.corner, MinimizeCorner::TopLeft);
    }

    #[test]
    fn compute_minimize_state_none_padding_applies_default_16() {
        let s = compute_minimize_state(360, 200, None, Some(MinimizeCorner::TopRight));
        assert_eq!(s.padding, MINIMIZE_DEFAULT_PADDING);
    }

    #[test]
    fn compute_minimize_state_none_corner_applies_default_bottom_right() {
        let s = compute_minimize_state(360, 200, Some(12), None);
        assert_eq!(s.corner, MinimizeCorner::BottomRight);
    }

    #[test]
    fn compute_minimize_state_both_none_applies_both_defaults() {
        let s = compute_minimize_state(480, 270, None, None);
        assert_eq!(s.padding, MINIMIZE_DEFAULT_PADDING);
        assert_eq!(s.corner, MinimizeCorner::BottomRight);
    }

    #[test]
    fn compute_minimize_state_all_explicit_no_defaults_applied() {
        let s = compute_minimize_state(240, 135, Some(0), Some(MinimizeCorner::BottomLeft));
        assert_eq!(s.padding, 0);
        assert_eq!(s.corner, MinimizeCorner::BottomLeft);
    }

    // ── minimize state transitions via PlayerState ────────────────────────
    //
    // These mirror the convention used by the existing mod.rs tests for
    // is_in_popout / focus-reassert: we manipulate the Mutex directly so
    // the transition logic is tested without an AppHandle.

    #[test]
    fn minimize_state_starts_none() {
        let state = PlayerState::new();
        assert!(state.geom.lock().unwrap().minimize.is_none());
    }

    #[test]
    fn enter_minimize_core_sets_state_with_explicit_values() {
        // Simulate what player_enter_minimize does after calling
        // compute_minimize_state: write the result via set_minimize.
        let state = PlayerState::new();
        let new_state = compute_minimize_state(320, 180, Some(8), Some(MinimizeCorner::TopLeft));
        state.set_minimize(Some(new_state)).unwrap();

        let stored = state.geom.lock().unwrap().minimize.unwrap();
        assert_eq!(stored.width, 320);
        assert_eq!(stored.height, 180);
        assert_eq!(stored.padding, 8);
        assert_eq!(stored.corner, MinimizeCorner::TopLeft);
    }

    #[test]
    fn enter_minimize_core_applies_defaults_when_none() {
        let state = PlayerState::new();
        let new_state = compute_minimize_state(360, 200, None, None);
        state.set_minimize(Some(new_state)).unwrap();

        let stored = state.geom.lock().unwrap().minimize.unwrap();
        assert_eq!(stored.padding, MINIMIZE_DEFAULT_PADDING);
        assert_eq!(stored.corner, MinimizeCorner::BottomRight);
    }

    #[test]
    fn update_mini_geometry_core_overwrites_existing_state() {
        // update_mini_geometry calls compute_minimize_state then replaces
        // via set_minimize. Verify that a second write with different args
        // overwrites the first.
        let state = PlayerState::new();
        state.set_minimize(Some(compute_minimize_state(360, 200, Some(16), Some(MinimizeCorner::BottomRight)))).unwrap();
        // Now simulate an update (e.g. user drags resize handle).
        state.set_minimize(Some(compute_minimize_state(240, 135, Some(8), Some(MinimizeCorner::TopLeft)))).unwrap();

        let stored = state.geom.lock().unwrap().minimize.unwrap();
        assert_eq!(stored.width, 240);
        assert_eq!(stored.height, 135);
        assert_eq!(stored.padding, 8);
        assert_eq!(stored.corner, MinimizeCorner::TopLeft);
    }

    #[test]
    fn update_mini_geometry_core_applies_defaults_on_none_args() {
        let state = PlayerState::new();
        state.set_minimize(Some(compute_minimize_state(360, 200, Some(20), Some(MinimizeCorner::TopRight)))).unwrap();
        // Simulate update with None padding/corner.
        state.set_minimize(Some(compute_minimize_state(480, 270, None, None))).unwrap();

        let stored = state.geom.lock().unwrap().minimize.unwrap();
        assert_eq!(stored.padding, MINIMIZE_DEFAULT_PADDING);
        assert_eq!(stored.corner, MinimizeCorner::BottomRight);
    }

    #[test]
    fn exit_minimize_core_clears_state_to_none() {
        let state = PlayerState::new();
        state.set_minimize(Some(compute_minimize_state(360, 200, None, None))).unwrap();
        assert!(state.geom.lock().unwrap().minimize.is_some());

        // Simulate what player_exit_minimize does.
        state.set_minimize(None).unwrap();

        assert!(state.geom.lock().unwrap().minimize.is_none());
    }

    #[test]
    fn exit_minimize_core_is_idempotent_when_already_none() {
        let state = PlayerState::new();
        // Already None — clearing again must not panic.
        state.set_minimize(None).unwrap();
        assert!(state.geom.lock().unwrap().minimize.is_none());
    }

    // ── MINIMIZE_DEFAULT_PADDING constant is the single source of truth ──
    #[test]
    fn default_padding_constant_value_is_16() {
        assert_eq!(MINIMIZE_DEFAULT_PADDING, 16);
    }
}

#[cfg(all(test, target_os = "linux"))]
mod linux_tests {
    use super::*;

    /// Loose float comparison — the ratios below intentionally use divisions
    /// that aren't exact binary fractions (e.g. `20.0 / 600.0`), so exact
    /// `assert_eq!` would be brittle against harmless last-bit rounding.
    fn close(a: f64, b: f64) {
        assert!(
            (a - b).abs() < 1e-9,
            "expected {a} ~= {b} (diff {})",
            (a - b).abs()
        );
    }

    // ── compute_minimize_state defaults, reused from the pure core ───────
    //
    // `compute_minimize_state` lost its Windows-only cfg gate (prexu-axj4.5)
    // specifically so both platforms' commands — and both platforms' test
    // suites — can share it. These mirror the Windows defaulting tests.

    #[test]
    fn compute_minimize_state_defaults_padding_16_corner_bottom_right() {
        let s = compute_minimize_state(480, 270, None, None);
        assert_eq!(s.padding, MINIMIZE_DEFAULT_PADDING);
        assert_eq!(s.corner, MinimizeCorner::BottomRight);
    }

    #[test]
    fn compute_minimize_state_explicit_values_stored_verbatim() {
        let s = compute_minimize_state(320, 180, Some(8), Some(MinimizeCorner::TopLeft));
        assert_eq!(s.width, 320);
        assert_eq!(s.height, 180);
        assert_eq!(s.padding, 8);
        assert_eq!(s.corner, MinimizeCorner::TopLeft);
    }

    // ── compute_margin_ratios: all four corners, non-degenerate window ────
    //
    // Window 800x600, mini rect 200x100, padding 20. Chosen so results are
    // clean-ish fractions and cross-checked against the formula in the
    // module doc comment / task brief (BottomRight case matches exactly).

    fn default_mini(corner: MinimizeCorner) -> MinimizeState {
        MinimizeState {
            width: 200,
            height: 100,
            padding: 20,
            corner,
        }
    }

    #[test]
    fn margin_ratios_bottom_right() {
        let (left, right, top, bottom) =
            compute_margin_ratios(800, 600, default_mini(MinimizeCorner::BottomRight));
        // left = (W - width - padding) / W = (800-200-20)/800 = 580/800
        close(left, 580.0 / 800.0);
        // right = padding / W = 20/800
        close(right, 20.0 / 800.0);
        // top = (H - height - padding) / H = (600-100-20)/600 = 480/600
        close(top, 480.0 / 600.0);
        // bottom = padding / H = 20/600
        close(bottom, 20.0 / 600.0);
    }

    #[test]
    fn margin_ratios_top_left() {
        let (left, right, top, bottom) =
            compute_margin_ratios(800, 600, default_mini(MinimizeCorner::TopLeft));
        close(left, 20.0 / 800.0);
        close(right, 580.0 / 800.0);
        close(top, 20.0 / 600.0);
        close(bottom, 480.0 / 600.0);
    }

    #[test]
    fn margin_ratios_top_right() {
        let (left, right, top, bottom) =
            compute_margin_ratios(800, 600, default_mini(MinimizeCorner::TopRight));
        close(left, 580.0 / 800.0);
        close(right, 20.0 / 800.0);
        close(top, 20.0 / 600.0);
        close(bottom, 480.0 / 600.0);
    }

    #[test]
    fn margin_ratios_bottom_left() {
        let (left, right, top, bottom) =
            compute_margin_ratios(800, 600, default_mini(MinimizeCorner::BottomLeft));
        close(left, 20.0 / 800.0);
        close(right, 580.0 / 800.0);
        close(top, 480.0 / 600.0);
        close(bottom, 20.0 / 600.0);
    }

    // ── compute_margin_ratios: defaults (padding None -> 16, corner None ->
    // BottomRight) applied through compute_minimize_state, then fed through ──

    #[test]
    fn margin_ratios_use_compute_minimize_state_defaults() {
        let mini = compute_minimize_state(360, 200, None, None);
        assert_eq!(mini.padding, 16);
        assert_eq!(mini.corner, MinimizeCorner::BottomRight);
        let (left, right, top, bottom) = compute_margin_ratios(1920, 1080, mini);
        close(left, (1920.0 - 360.0 - 16.0) / 1920.0);
        close(right, 16.0 / 1920.0);
        close(top, (1080.0 - 200.0 - 16.0) / 1080.0);
        close(bottom, 16.0 / 1080.0);
    }

    // ── degenerate cases ───────────────────────────────────────────────────

    #[test]
    fn margin_ratios_zero_width_window_returns_zero_margins() {
        let ratios = compute_margin_ratios(0, 600, default_mini(MinimizeCorner::BottomRight));
        assert_eq!(ratios, (0.0, 0.0, 0.0, 0.0));
    }

    #[test]
    fn margin_ratios_zero_height_window_returns_zero_margins() {
        let ratios = compute_margin_ratios(800, 0, default_mini(MinimizeCorner::BottomRight));
        assert_eq!(ratios, (0.0, 0.0, 0.0, 0.0));
    }

    #[test]
    fn margin_ratios_negative_window_dims_return_zero_margins() {
        // Defensive: GTK allocations are never negative in practice, but a
        // signal callback firing before first layout could plausibly report
        // 0 or transiently odd values — never panic/underflow here.
        let ratios = compute_margin_ratios(-10, -5, default_mini(MinimizeCorner::BottomRight));
        assert_eq!(ratios, (0.0, 0.0, 0.0, 0.0));
    }

    #[test]
    fn margin_ratios_window_smaller_than_rect_plus_padding_clamps_far_side_to_zero() {
        // Window 100x100 requesting a 200x100 mini rect at 20px padding: the
        // rect alone doesn't fit, let alone with padding. The far-side ratio
        // on each axis must clamp to 0 (never negative) rather than handing
        // mpv a negative video-margin-ratio.
        let (left, right, top, bottom) =
            compute_margin_ratios(100, 100, default_mini(MinimizeCorner::BottomRight));
        // BottomRight: left/top are the "far" side (which go negative here).
        assert_eq!(left, 0.0);
        assert_eq!(top, 0.0);
        // right/bottom are the padding-side, unaffected by the width/height
        // shortfall: padding=20 over a 100px window = 0.2.
        close(right, 0.2);
        close(bottom, 0.2);
    }

    #[test]
    fn margin_ratios_padding_larger_than_window_clamps_individual_ratio() {
        // Padding (100) alone exceeds the window (50) on both axes.
        // padding_side clamps to MAX_MARGIN_RATIO instead of blowing past 1.0.
        let mini = MinimizeState {
            width: 10,
            height: 10,
            padding: 100,
            corner: MinimizeCorner::BottomRight,
        };
        let (left, right, top, bottom) = compute_margin_ratios(50, 50, mini);
        assert!(right <= MAX_MARGIN_RATIO);
        assert!(bottom <= MAX_MARGIN_RATIO);
        assert_eq!(left, 0.0);
        assert_eq!(top, 0.0);
    }

    #[test]
    fn margin_ratios_axis_sum_never_inverts_even_when_first_clamp_alone_is_insufficient() {
        // Synthetic edge case isolating the pair-sum guard in `axis_margins`:
        // sum(padding_side, far_side) = 1 - size/total regardless of padding
        // (padding cancels out of the sum), so a tiny rect relative to a huge
        // window pushes the sum near 1.0 even though neither ratio alone hit
        // the individual clamp. total=1000, size=5 -> sum = 1 - 5/1000 = 0.995,
        // which exceeds MAX_MARGIN_RATIO (0.99) and must trigger the
        // second-stage clamp on `far_side`.
        let mini = MinimizeState {
            width: 5,
            height: 600,
            padding: 200,
            corner: MinimizeCorner::BottomRight,
        };
        let (left, right, _top, _bottom) = compute_margin_ratios(1000, 600, mini);
        // right = padding_side = 200/1000 = 0.2 (unaffected, well under clamp).
        close(right, 0.2);
        // left = far_side, would naturally be (1000-5-200)/1000 = 0.795, but
        // the pair-sum guard must clamp it to MAX_MARGIN_RATIO - 0.2 = 0.79.
        close(left, 0.79);
        assert!(left + right < 1.0, "left+right must leave room for video");
    }

    // ── PlayerState Linux minimize storage ─────────────────────────────────

    #[test]
    fn player_state_minimize_starts_none() {
        let state = PlayerState::new();
        assert!(state.get_minimize().is_none());
    }

    #[test]
    fn player_state_set_then_get_minimize_round_trips() {
        let state = PlayerState::new();
        let mini = compute_minimize_state(320, 180, Some(8), Some(MinimizeCorner::TopLeft));
        state.set_minimize(Some(mini)).unwrap();
        let stored = state.get_minimize().unwrap();
        assert_eq!(stored.width, 320);
        assert_eq!(stored.height, 180);
        assert_eq!(stored.padding, 8);
        assert_eq!(stored.corner, MinimizeCorner::TopLeft);
    }

    #[test]
    fn player_state_set_minimize_overwrites_previous_value() {
        let state = PlayerState::new();
        state
            .set_minimize(Some(compute_minimize_state(360, 200, Some(16), Some(MinimizeCorner::BottomRight))))
            .unwrap();
        state
            .set_minimize(Some(compute_minimize_state(240, 135, Some(8), Some(MinimizeCorner::TopLeft))))
            .unwrap();
        let stored = state.get_minimize().unwrap();
        assert_eq!(stored.width, 240);
        assert_eq!(stored.padding, 8);
        assert_eq!(stored.corner, MinimizeCorner::TopLeft);
    }

    #[test]
    fn player_state_set_minimize_none_clears_state() {
        let state = PlayerState::new();
        state
            .set_minimize(Some(compute_minimize_state(360, 200, None, None)))
            .unwrap();
        assert!(state.get_minimize().is_some());
        state.set_minimize(None).unwrap();
        assert!(state.get_minimize().is_none());
    }

    #[test]
    fn player_state_clear_minimize_snapshot_reports_presence_and_clears() {
        let state = PlayerState::new();
        assert!(!state.clear_minimize_snapshot());
        state
            .set_minimize(Some(compute_minimize_state(360, 200, None, None)))
            .unwrap();
        assert!(state.clear_minimize_snapshot());
        assert!(state.get_minimize().is_none());
        // Idempotent — clearing again reports nothing was present.
        assert!(!state.clear_minimize_snapshot());
    }
}
