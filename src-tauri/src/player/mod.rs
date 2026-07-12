//! Native libmpv-backed player.
//!
//! Two rendering backends share the cross-platform core (`PlayerState`, the mpv
//! event pump, lifecycle, timeline reporting, and the playback command surface):
//!   - **Windows**: `wid`/HWND host + DirectComposition (`video_render`,
//!     `composition_host`, `angle_loader`, Win32 geometry sync).
//!   - **Linux**: the mpv render API compositing a `GtkGLArea` under the
//!     transparent WebKitWebView (`linux_compositor`, prexu-axj4.3).

pub mod commands;
pub mod events;
pub(crate) mod lifecycle;
pub(crate) mod timeline;

// Win32 geometry-sync math (host inset / throttle / dedup) — only the Windows
// `wid` host needs it; Linux lets GTK's widget allocation drive resize/DPI.
#[cfg(target_os = "windows")]
pub(crate) mod geometry;

#[cfg(target_os = "windows")]
pub mod composition_host;

#[cfg(target_os = "windows")]
pub mod angle_loader;

#[cfg(target_os = "windows")]
pub mod video_render;

// Linux render-API compositor: reparents wry's webview under a GtkOverlay with
// an mpv-render GtkGLArea beneath, and owns the render context + frame loop.
#[cfg(target_os = "linux")]
pub mod linux_compositor;

#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use tokio::sync::Notify;

use libmpv2::Mpv;
#[cfg_attr(not(target_os = "windows"), allow(unused_imports))]
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use geometry::GeomState;

// Re-export pure helpers that external callers (commands/, lib.rs) reference
// via `crate::player::*`. `compute_minimize_inset` is Windows-only (the host
// inset it computes only exists under composition hosting), so the re-export
// must carry the same gate or it fails to resolve on Linux/macOS.
// (`initial_host_geometry` was removed with the legacy WS_POPUP host, prexu-zfyi.)
#[cfg(target_os = "windows")]
pub(crate) use geometry::compute_minimize_inset;
pub use timeline::TimelineCtx;

/// Minimum interval between consecutive sync_geometry calls. Drag-resize
/// fires WM_SIZE at the OS event rate (~60 Hz). Each sync_geometry runs
/// SetWindowPos which synchronously sends WM_WINDOWPOSCHANGING/CHANGED
/// down the chain plus WM_SIZE to mpv's child window, where mpv rebuilds
/// its D3D11 swapchain. At 60 Hz the Tauri main thread can't service the
/// message queue between calls and the app hard-freezes.
///
/// 50 ms (20 Hz) was the old value. After prexu-aqd split MOVE off this
/// path (only resize hits sync_geometry now), the rate dropped — pure
/// drag never enters here. Resize bursts are short (user grabs handle
/// for seconds at a time), so 33 ms (30 Hz) is safe and visibly closes
/// the gap between WebView chrome (no throttle) and mpv host (throttled),
/// which at 50 ms produced visible mismatched-edge artifacts during
/// resize (host extends past or stops short of chrome).
#[cfg(target_os = "windows")]
pub(crate) const GEOMETRY_SYNC_MIN_INTERVAL: Duration = Duration::from_millis(33);

/// How long `report_stopped_on_close` waits for the spawned report thread
/// before letting window close proceed. Caps shutdown latency: the typical
/// LAN Plex timeline GET completes in tens of ms (close stays effectively
/// instant); a dead/slow server costs at most this much instead of the old
/// main-thread worst case of client construction + 1500ms send. Past this
/// budget the thread is detached and races process exit (prexu-bgz.9).
pub(crate) const CLOSE_REPORT_JOIN_BUDGET: Duration = Duration::from_millis(300);

/// Managed state container holding the mpv handle + (on Windows) the native
/// HWND that mpv renders into. Created lazily on the first `ensure_init`.
pub struct PlayerState {
    inner: Mutex<Option<Inner>>,
    /// Serializes `ensure_init` runs. `inner` must NEVER be held across
    /// host-window creation or mpv construction (~12 s cold hwdec probe):
    /// main-thread handlers (`Focused`, `CloseRequested`, the fullscreen
    /// early-sync closure) take `inner` with blocking locks, and host
    /// creation round-trips through `run_on_main_thread` — a main thread
    /// parked on `inner` can never service that closure. Initialization
    /// is therefore guarded by this dedicated lock instead, and `inner`
    /// is only taken briefly to check/store.
    init_lock: Mutex<()>,
    /// True while a fullscreen toggle is in flight. The window-event
    /// listener fires Resized many times during Tauri's animated transition;
    /// each one triggers SetWindowPos on the host, which makes mpv's
    /// gpu-next vo rebuild its D3D11 swapchain. Doing that ~10 times within
    /// 300 ms reliably crashes the mpv render thread, so we suppress
    /// sync_geometry while this flag is set and do one explicit sync after
    /// the transition settles. Windows-only: Linux fullscreen is a plain
    /// Tauri window toggle with no host geometry to suppress.
    #[cfg(target_os = "windows")]
    fullscreen_transition: AtomicBool,
    /// All geometry-throttle state behind a single mutex, eliminating the
    /// six-way lock-order hazard of the previous per-field mutexes.
    ///
    /// Fields bundled here:
    /// - `last_sync`        — leading-edge throttle clock
    /// - `last_geometry`    — dedup cache
    /// - `pending_geometry` — trailing-edge stash
    /// - `minimize`         — optional in-window mini-inset (logical px)
    /// - `scale_factor`     — DPI multiplier for logical→physical
    ///
    /// Acquired once per geometry event; dropped before the
    /// `inner.try_lock()` / `SetWindowPos` call so the Win32 re-entrancy
    /// guard on `inner` remains separate and non-blocking. Windows-only: on
    /// Linux GTK's widget allocation drives resize/DPI, so there is no
    /// geometry to throttle or sync.
    #[cfg(target_os = "windows")]
    geom: Mutex<GeomState>,
    /// True while a trailing-edge flush is scheduled for the pending
    /// geometry. Acts as a one-shot debounce: the first event of a fast
    /// burst spawns a worker thread that sleeps the throttle window and
    /// then calls `flush_pending_geometry` on the main thread; subsequent
    /// events that lose the race (`swap` returns true) skip the spawn so
    /// we never have more than one flush in flight. Cleared by
    /// `flush_pending_geometry` before it consumes pending.
    ///
    /// Without this, a fast drag-resize whose FINAL event lands inside the
    /// 50ms throttle window leaves the host stuck at stale geometry —
    /// `sync_geometry` stores the final geometry to pending but no further
    /// event arrives to consume it. Windows-only (geometry sync).
    #[cfg(target_os = "windows")]
    trailing_scheduled: AtomicBool,
    /// Saved (x, y, width, height) of the Tauri main window's rect before
    /// entering pop-out mode. Stashed by `player_enter_popout` and consumed
    /// by `player_exit_popout` to restore the previous geometry. `None` when
    /// not in pop-out mode. Windows stashes the Win32 outer rect
    /// (GetWindowRect); Linux (prexu-axj4.10) stashes outer position +
    /// inner size (the symmetric round-trip through Tauri's GTK ops — see
    /// `commands::popout`'s Linux section).
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    pub(crate) pre_popout_geometry: Mutex<Option<(i32, i32, u32, u32)>>,
    /// True if the main window was maximized immediately before
    /// `player_enter_popout` unmaximized it (Linux/Wayland fix, prexu-6qi5.4).
    /// GTK's `gtk_window_resize` no-ops on a maximized toplevel, and tao's own
    /// GTK edge-drag hit-test explicitly bails out while
    /// `window.is_maximized()` — so pop-out must unmaximize before it can
    /// shrink the window or accept an edge-drag resize. `player_exit_popout`
    /// re-maximizes the window when this was `Some(true)`, after restoring
    /// the pre-popout geometry. `None` when not currently in pop-out (mirrors
    /// `pre_popout_geometry`). Windows/macOS never touch this — the Windows
    /// popout path resizes via raw Win32 `SetWindowPos`, which has no such
    /// maximized-toplevel restriction.
    #[cfg(target_os = "linux")]
    pub(crate) pre_popout_maximized: Mutex<Option<bool>>,
    /// True if the main window was edge-tiled immediately before
    /// `player_enter_popout` broke the tile via an unmap/remap of the
    /// toplevel (prexu-7xxx tile-break, PR #77 — see `commands::popout`'s
    /// `probe_and_break_tile`). `None` when not currently in pop-out (mirrors
    /// `pre_popout_maximized`).
    ///
    /// Surfaced for `player_exit_popout` (prexu-fgrt): a hardware log showed
    /// the main window passing through THREE sizes over ~4s on exit from a
    /// previously-tiled pop-out, rather than landing in one configure like
    /// the non-tiled case. A window that just went through the hide/show
    /// remap is "fresh" for Wayland configure-negotiation purposes the same
    /// way a newly created window is, so exit mirrors enter's own
    /// resize-before-decorations ordering and bounded verify-and-retry loop
    /// (prexu-rmm7) for this case specifically — see `commands::popout`'s
    /// module doc "Exit settling" section for the full evidence trail.
    #[cfg(target_os = "linux")]
    pub(crate) pre_popout_was_tiled: Mutex<Option<bool>>,
    /// Latched on `WindowEvent::Focused(false)`, consumed on the next
    /// `WindowEvent::Focused(true)`. Gates `reassert_host_on_focus`
    /// so the host SetWindowPos storm only fires on an actual
    /// out-and-back focus cycle (alt+tab to another app and back),
    /// not on every focus event Tauri emits during normal playback
    /// (click in chrome, mouse enter, etc.). Without this gate, the
    /// repeated set_topmost / anchor_below / SetWindowPos calls
    /// disrupt WebView2 mouse capture and leave the cursor stuck on
    /// the host's edge-hit-test resize glyph (prexu-5l5 follow-up).
    #[cfg(target_os = "windows")]
    pub(crate) pending_focus_reassert: AtomicBool,
    /// Report context for the final `state=stopped` timeline GET fired
    /// from Rust when the window closes mid-playback (prexu-50f). The JS
    /// unmount cleanup cannot be relied on during webview teardown, so the
    /// frontend registers this once per playback and clears it after its
    /// own route-exit report; `report_stopped_on_close` takes it (one-shot)
    /// and reads the live position from mpv.
    timeline_ctx: Mutex<Option<TimelineCtx>>,
    /// Active `video-margin-ratio-*` application (Linux, prexu-axj4.5 /
    /// prexu-v45v / prexu-fgrt). Mirrors Windows' `GeomState::minimize` but
    /// stored directly on `PlayerState` since Linux has no `GeomState`/
    /// host-geometry-throttle machinery — GTK drives resize directly and
    /// margins are recomputed live against the current GLArea allocation
    /// (see `linux_compositor`'s GLArea `resize` handler and
    /// `commands::minimize::apply_margins_now`). `None` when no margin is
    /// active.
    ///
    /// Holds a `MarginState` rather than a bare `MinimizeState` (prexu-fgrt)
    /// because two structurally different callers share this one slot: the
    /// in-window minimize corner-inset (a fixed-pixel rect whose margins DO
    /// need recomputing against the live allocation) and the pop-out's
    /// subtitle-safe bottom strip (a constant ratio that never depended on
    /// the allocation at all — see `MarginState::PopoutBottomRatio`).
    /// Representing the latter as a fake `MinimizeState` rect frozen to
    /// whatever size the pop-out was at enter time caused stale-rect drift
    /// and WARN spam on every resize once the window no longer matched that
    /// frozen size.
    #[cfg(target_os = "linux")]
    linux_margin: Mutex<Option<MarginState>>,
    /// Notification primitive shared between the window-event handler and the
    /// long-lived trailing-edge flusher task (prexu-bgz.24). The handler calls
    /// `notify_one()` when it wins the `claim_trailing_schedule` race; the
    /// flusher task parks on `notified().await` between bursts (no spinning).
    ///
    /// Stored here so teardown can `abort()` the task handle (below) and drop
    /// the `Notify` cleanly. Created in `PlayerState::new()` and shared with
    /// the flusher task via `Arc::clone`.
    #[cfg(target_os = "windows")]
    flusher_notify: Arc<Notify>,
    /// `JoinHandle` for the long-lived trailing-edge flusher tokio task.
    /// `None` until `start_flusher` creates it (lazy, on first window-handler
    /// attachment). Stored inside a `Mutex<Option<...>>` so `destroy()` can
    /// `take()` + `abort()` it without a mutable `&mut self` reference.
    #[cfg(target_os = "windows")]
    flusher_handle: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

/// Which of the four corners the mini player anchors to. Mirrors the
/// `MiniCorner` string union in `src/utils/mini-rect.ts`. Serde deserializes
/// the kebab-case IPC string directly into this enum at the command boundary,
/// so unknown strings are a hard error rather than a silent fallback.
///
/// Cross-platform (prexu-axj4.5): Windows repositions a separate Win32 host
/// window into this corner; Linux insets mpv's own video area into it via
/// the `video-margin-ratio-*` properties (see `commands::minimize` and
/// `linux_compositor`) since GTK composites video and WebView on one surface
/// with no separate host window to move.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MinimizeCorner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

/// Logical-pixel parameters of the in-window mini region.
///
/// Width / height / padding are CSS (logical) pixels, matching what the
/// React side sends across the IPC.
///
/// - **Windows**: stored in `GeomState::minimize` so `apply_minimize_inset_inner`
///   can produce the correct host geometry on every Resized event. The
///   conversion to physical pixels happens lazily inside the geometry path
///   against the latest `GeomState::scale_factor` — this lets cross-monitor
///   DPI changes (`WindowEvent::ScaleFactorChanged`) recompute the host rect
///   at the new scale without re-firing `player_enter_minimize` from the
///   frontend.
/// - **Linux** (prexu-axj4.5): stored in `PlayerState::linux_margin` (wrapped
///   in `MarginState::Minimize`) and converted into `video-margin-ratio-*`
///   fractions against the GtkGLArea's current logical allocation by
///   `commands::minimize::compute_margin_ratios`. GTK allocations are already
///   logical units, so no DPI conversion is needed there; margins are simply
///   recomputed whenever the allocation changes (see the GLArea `resize`
///   handler in `linux_compositor`). This recomputation is correct BECAUSE
///   the rect it represents has a fixed pixel SIZE — as the window resizes,
///   the far-side margin has to re-proportion so the rect keeps that size.
#[derive(Debug, Clone, Copy)]
pub struct MinimizeState {
    pub width: u32,
    pub height: u32,
    pub padding: u32,
    pub corner: MinimizeCorner,
}

/// The `video-margin-ratio-*` application `PlayerState::linux_margin`
/// currently holds (Linux only, prexu-fgrt). Two structurally different
/// margin sources share the one storage slot:
///
/// - `Minimize` — the in-window minimize corner inset: a FIXED-PIXEL rect
///   (`MinimizeState`). Its ratios must be recomputed against the LIVE
///   GtkGLArea allocation on every resize (`commands::minimize::
///   compute_margin_ratios`) because the rect's SIZE is what's fixed — the
///   far-side margin has to grow/shrink so the rect keeps that size as the
///   window resizes.
/// - `PopoutBottomRatio` — the pop-out's subtitle-safe bottom strip
///   (prexu-v45v): a CONSTANT fraction of the window height. Unlike the
///   minimize case, this ratio has never depended on the window's actual
///   size and does not need the live allocation to resolve — `ratios()`
///   below returns it directly with zero left/right/top margin.
///
/// Before this split (see PR #82's `compute_popout_subtitle_margin_state`),
/// the pop-out case was represented as a fake `MinimizeState` rect frozen to
/// whatever size the pop-out happened to be resized to at enter time. Every
/// subsequent GTK allocation during a user edge-resize then recomputed
/// against that STALE rect via the fixed-pixel formula above, which:
/// - logged a `compute_margin_ratios` WARN on every allocation once the live
///   window no longer matched the frozen rect (dozens per drag gesture), and
/// - on a second pop-out enter, could transiently produce badly wrong ratios
///   when `apply_margins_now` ran against a not-yet-resized allocation,
///   self-correcting only once the window caught up.
///
/// Storing the ratio-native intent directly (this enum) makes both classes
/// of bug structurally impossible for the pop-out case: there is no stored
/// pixel rect to go stale, and no allocation-dependent math to warn about.
#[derive(Debug, Clone, Copy)]
#[cfg(target_os = "linux")]
pub(crate) enum MarginState {
    Minimize(MinimizeState),
    PopoutBottomRatio(f64),
}

#[cfg(target_os = "linux")]
impl MarginState {
    /// Resolve to the four `video-margin-ratio-*` fractions (left, right,
    /// top, bottom) for the given LIVE GtkGLArea logical allocation. Pure —
    /// the mpv property dispatch happens in
    /// `linux_compositor::apply_margin_ratios`.
    ///
    /// `Minimize` needs the allocation (fixed-rect math, see the enum doc);
    /// `PopoutBottomRatio` does not — its ratio is already the answer,
    /// independent of `window_logical_w`/`window_logical_h`, which is the
    /// whole point of representing it this way.
    pub(crate) fn ratios(&self, window_logical_w: i32, window_logical_h: i32) -> (f64, f64, f64, f64) {
        match self {
            MarginState::Minimize(mini) => crate::player::commands::minimize::compute_margin_ratios(
                window_logical_w,
                window_logical_h,
                *mini,
            ),
            MarginState::PopoutBottomRatio(ratio) => (0.0, 0.0, 0.0, *ratio),
        }
    }
}

struct Inner {
    mpv: Arc<Mpv>,
    /// Event pump JoinHandle. `destroy()` joins this before dropping the
    /// rest of Inner so mpv's final Arc (held by the pump) is released
    /// synchronously — `mpv_terminate_destroy` then runs while we still
    /// own the HWND, avoiding the race where DestroyWindow ran before
    /// mpv's render thread stopped using it.
    event_pump: Option<JoinHandle<()>>,
    /// Path C3d: the mpv→DComp render thread, present only in composition mode.
    /// `destroy()` stops+joins it BEFORE the final `Arc<Mpv>` drops so the
    /// libmpv2 `RenderContext` is freed before `mpv_terminate_destroy` runs.
    #[cfg(target_os = "windows")]
    video_render: Option<video_render::VideoRenderThread>,
}

impl PlayerState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            init_lock: Mutex::new(()),
            #[cfg(target_os = "windows")]
            fullscreen_transition: AtomicBool::new(false),
            #[cfg(target_os = "windows")]
            geom: Mutex::new(GeomState::new()),
            #[cfg(target_os = "windows")]
            trailing_scheduled: AtomicBool::new(false),
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            pre_popout_geometry: Mutex::new(None),
            #[cfg(target_os = "linux")]
            pre_popout_maximized: Mutex::new(None),
            #[cfg(target_os = "linux")]
            pre_popout_was_tiled: Mutex::new(None),
            #[cfg(target_os = "windows")]
            pending_focus_reassert: AtomicBool::new(false),
            timeline_ctx: Mutex::new(None),
            #[cfg(target_os = "linux")]
            linux_margin: Mutex::new(None),
            #[cfg(target_os = "windows")]
            flusher_notify: Arc::new(Notify::new()),
            #[cfg(target_os = "windows")]
            flusher_handle: Mutex::new(None),
        }
    }

    /// Update the stored DPI scale factor. Called from the
    /// `ScaleFactorChanged` window-event handler and from
    /// `player_enter_minimize` so geometry conversions use the live scale.
    #[cfg(target_os = "windows")]
    pub(crate) fn set_scale_factor(&self, scale: f64) {
        let changed = if let Ok(mut g) = self.geom.lock() {
            let changed = (g.scale_factor - scale).abs() > f64::EPSILON;
            if changed {
                log::info!(
                    "[player:host] scale factor {:.3} → {:.3}",
                    g.scale_factor,
                    scale
                );
                g.scale_factor = scale;
            }
            changed
            // geom lock released here before touching the composition controller
        } else {
            false
        };
        // C4c (prexu-od2n): keep the composition-hosted webview crisp after a
        // monitor/DPI change by re-applying the rasterization scale. No-op when
        // composition isn't installed (windowed host / non-main thread).
        if changed {
            composition_host::set_rasterization_scale(scale);
        }
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn set_fullscreen_transition(&self, in_progress: bool) {
        self.fullscreen_transition
            .store(in_progress, Ordering::Release);
    }

    /// Drop the in-window minimize snapshot so the next `ensure_init` builds
    /// the mpv host at full geometry rather than the leftover mini inset.
    /// Called from `destroy` on player teardown (prexu-ta9). Returns whether a
    /// snapshot was actually present (for logging / test assertions). The
    /// snapshot lives on `PlayerState` (per-process), so an exit-while-minimized
    /// would otherwise leak the mini rect into the following session.
    #[cfg(target_os = "windows")]
    pub(crate) fn clear_minimize_snapshot(&self) -> bool {
        match self.geom.lock() {
            Ok(mut g) => {
                let had = g.minimize.is_some();
                if had {
                    log::info!("[player] clearing leftover minimize snapshot on teardown");
                    g.minimize = None;
                }
                had
            }
            Err(_) => false,
        }
    }

    /// Linux equivalent of the Windows `clear_minimize_snapshot` above: drops
    /// any leftover margin state (in-window minimize inset OR pop-out
    /// bottom-ratio, prexu-axj4.5 / prexu-fgrt) so a fresh `ensure_init`
    /// after an exit-while-minimized/popped-out does not carry stale
    /// `video-margin-ratio-*` values into the next playback session.
    #[cfg(target_os = "linux")]
    pub(crate) fn clear_minimize_snapshot(&self) -> bool {
        match self.linux_margin.lock() {
            Ok(mut g) => {
                let had = g.is_some();
                if had {
                    log::info!("[player:linux] clearing leftover margin snapshot on teardown");
                    *g = None;
                }
                had
            }
            Err(_) => false,
        }
    }

    /// Write the in-window minimize corner-inset state (Linux, prexu-axj4.5).
    /// Used by the in-window mini commands (`commands::minimize`) to store
    /// the desired inset; consumed by `apply_margins_now` and the GLArea
    /// `resize` handler in `linux_compositor` (via `margin_ratios`) to
    /// recompute margins whenever the window size changes while minimized.
    ///
    /// `Some(state)` wraps it in `MarginState::Minimize`; `None` clears
    /// `linux_margin` unconditionally regardless of which variant (if any)
    /// was active — this is also how `commands::popout` clears its OWN
    /// `PopoutBottomRatio` margin on exit (pop-out and minimize are mutually
    /// exclusive, see both modules' enter commands).
    #[cfg(target_os = "linux")]
    pub(crate) fn set_minimize(&self, state: Option<MinimizeState>) -> Result<(), String> {
        self.linux_margin
            .lock()
            .map(|mut g| *g = state.map(MarginState::Minimize))
            .map_err(|_| "margin lock poisoned".to_string())
    }

    /// Read the current in-window minimize corner-inset state (Linux,
    /// prexu-axj4.5). Returns `None` both when no margin is active AND when
    /// the active margin is a pop-out `PopoutBottomRatio` — callers use this
    /// specifically to detect a REAL leftover minimize inset (e.g.
    /// `player_enter_popout`'s mutual-exclusion guard). To check "is ANY
    /// margin active, regardless of variant" instead, use
    /// `margin_ratios(..).is_some()`.
    #[cfg(target_os = "linux")]
    pub(crate) fn get_minimize(&self) -> Option<MinimizeState> {
        self.linux_margin.lock().ok().and_then(|g| match *g {
            Some(MarginState::Minimize(mini)) => Some(mini),
            _ => None,
        })
    }

    /// Write the pop-out subtitle-safe bottom-ratio margin (Linux,
    /// prexu-v45v/prexu-fgrt). `Some(ratio)` wraps it in
    /// `MarginState::PopoutBottomRatio`; `None` clears `linux_margin`
    /// unconditionally (same "clear wins outright" contract as
    /// `set_minimize(None)` above).
    #[cfg(target_os = "linux")]
    pub(crate) fn set_popout_margin_ratio(&self, ratio: Option<f64>) -> Result<(), String> {
        self.linux_margin
            .lock()
            .map(|mut g| *g = ratio.map(MarginState::PopoutBottomRatio))
            .map_err(|_| "margin lock poisoned".to_string())
    }

    /// Resolve the four `video-margin-ratio-*` fractions for the current
    /// margin state (whichever variant is active) against a LIVE GtkGLArea
    /// logical allocation. `None` when no margin is active. The single entry
    /// point `linux_compositor` uses (`apply_margins_now` and the GLArea
    /// `resize` handler) so it never has to know which kind of margin is in
    /// effect.
    #[cfg(target_os = "linux")]
    pub(crate) fn margin_ratios(&self, window_logical_w: i32, window_logical_h: i32) -> Option<(f64, f64, f64, f64)> {
        let mini = self.linux_margin.lock().ok().and_then(|g| *g)?;
        Some(mini.ratios(window_logical_w, window_logical_h))
    }

    /// True when `ensure_init` has run and `destroy` has not. Used by
    /// `player_set_fullscreen` to skip all mpv-aware work when there's no
    /// mpv to sync — e.g. during unmount cleanup after `player_unload`.
    pub(crate) fn is_initialised(&self) -> bool {
        self.inner
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }

    /// Lazily create the host window + `Mpv` handle with our baseline config
    /// and start the event pump. Subsequent calls are no-ops.
    ///
    /// Note: on app startup tao emits two warnings,
    ///   "NewEvents emitted without explicit RedrawEventsCleared"
    ///   "RedrawEventsCleared emitted without explicit MainEventsCleared"
    /// These originate in tao's event-loop runner, not our code. The
    /// warnings are upstream noise tied to WebView2 init timing and do not
    /// affect playback or geometry sync. Revisit on a tao version bump.
    pub(crate) fn ensure_init(&self, app: &AppHandle) -> Result<(), String> {
        log::info!("[player] ensure_init called");
        {
            let guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
            if guard.is_some() {
                log::debug!("[player] ensure_init: already initialized");
                return Ok(());
            }
        }

        // Serialize initializers on `init_lock`, not `inner` — see the
        // field doc on `init_lock` for why `inner` must stay free during
        // construction. Concurrent callers (warmup thread vs an early
        // player_load_url) must WAIT here rather than fail: load_url
        // errors surface to the user as a fatal playback error, and the
        // warmup race is by design (see app_ready in lib.rs).
        let _init_guard = match self.init_lock.try_lock() {
            Ok(g) => g,
            Err(std::sync::TryLockError::WouldBlock) => {
                log::warn!(
                    "[player] ensure_init: init already in progress on another thread; waiting"
                );
                self.init_lock
                    .lock()
                    .map_err(|e| format!("Init lock poisoned: {}", e))?
            }
            Err(std::sync::TryLockError::Poisoned(e)) => {
                log::error!("[player] ensure_init: init lock poisoned: {:?}", e);
                return Err(format!("Init lock poisoned: {}", e));
            }
        };

        // Re-check under the init lock: a concurrent caller may have
        // finished (or failed — in which case we retry below) while we
        // waited for the lock.
        {
            let guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
            if guard.is_some() {
                log::info!("[player] ensure_init: completed by concurrent caller");
                return Ok(());
            }
        }

        // Marker for cold-start latency attribution. The gap between this
        // log and the first "FileLoaded" event covers: (a) mpv handle
        // construction, (b) demuxer opening the network stream (cold
        // plex.direct connect), and (c) hardware decoder probing.
        log::info!("[player:init] starting mpv init (hwdec=auto-safe)");

        // Both platforms use the render-context path (`composition = true` →
        // `vo=libmpv`, no host window, no `wid`):
        //   - Windows: a libmpv2 RenderContext feeds the DComp video visual.
        //   - Linux: a libmpv2 RenderContext feeds the GtkGLArea under the
        //     transparent webview (prexu-axj4.3). `setlocale(LC_NUMERIC, "C")`
        //     is applied inside `configure_mpv_properties` before `mpv_create`.
        let mpv = lifecycle::configure_mpv_properties(None, true)?;
        log::info!("[player] mpv created");

        let mpv = Arc::new(mpv);
        let event_pump = events::spawn_event_pump(Arc::clone(&mpv), app.clone())?;

        // Claim the GPU surfaces published by `composition_host::install` and
        // spawn the mpv render thread. If the surfaces are missing (install
        // failed/didn't run) we log and continue with no video output rather
        // than failing init.
        #[cfg(target_os = "windows")]
        let video_render = match video_render::claim_surfaces() {
            Some(surfaces) => {
                log::info!("[player] starting video render thread (composition mode)");
                // Invalidate the cross-playback geom dedup cache: the new render
                // thread starts at the stale install surface size, so the initial
                // sync (scheduled after init) MUST apply rather than dedup-skip,
                // or the video stays stuck at install size and frozen (prexu-3fxj).
                if let Ok(mut g) = self.geom.lock() {
                    g.last_geometry = None;
                }
                Some(video_render::VideoRenderThread::start(Arc::clone(&mpv), surfaces, app.clone()))
            }
            None => {
                log::error!(
                    "[player] no GPU surfaces published; video will not render \
                     (composition_host::install did not run?)"
                );
                None
            }
        };

        // Linux (prexu-axj4.3): hand the live mpv handle to the compositor so it
        // creates the mpv render context on the GTK main thread and binds it to
        // the GtkGLArea. Marshalled internally — safe to call from this worker.
        #[cfg(target_os = "linux")]
        linux_compositor::attach_mpv(app, Arc::clone(&mpv));

        let mut guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        *guard = Some(Inner {
            mpv,
            event_pump: Some(event_pump),
            #[cfg(target_os = "windows")]
            video_render,
        });
        drop(guard); // release before the main-thread sync below tries inner.try_lock()
        log::info!("[player] event pump spawned, init complete");

        // prexu-3fxj / prexu-0qri: composition playbacks reuse the persistent geom
        // dedup cache but spawn a FRESH render thread at the stale install surface
        // size. Window-event geometry syncs only fire when the window moves/resizes,
        // so a replay at the same window size leaves the render thread stuck at the
        // install size — video frozen (no swapchain rebuild + commit) and/or cropped.
        // Fire one immediate sync on the MAIN thread (required: set_video_offset's
        // DComp commit is thread-affine) so every composition playback resizes the
        // video to the current player viewport and commits the visual.
        #[cfg(target_os = "windows")]
        {
            let app2 = app.clone();
            if let Err(e) = app.run_on_main_thread(move || {
                if let Some(win) = app2.get_webview_window("main") {
                    if let (Ok(pos), Ok(size)) = (win.inner_position(), win.inner_size()) {
                        app2.state::<PlayerState>().sync_geometry_now(
                            pos.x,
                            pos.y,
                            size.width as i32,
                            size.height as i32,
                        );
                    }
                }
            }) {
                log::warn!("[player] initial composition geometry sync schedule failed: {:?}", e);
            }
        }
        Ok(())
    }

    /// Soft stop: clear mpv's current file but KEEP the mpv handle, host
    /// window, and event pump alive. Used by `player_stop` (the Tauri
    /// command driving the per-episode handoff path on the TS side) so a
    /// subsequent `player_load_url` just runs `loadfile` on the existing
    /// instance instead of paying for a full destroy + ensure_init +
    /// hwdec probe + DXGI swap chain rebuild cycle (prexu-7fe).
    ///
    /// Synchronous, fast: mute + pause=false + mpv `stop`. After it
    /// returns, mpv has no active file and is ready for the next
    /// `loadfile`. No background teardown thread, no event-pump join.
    ///
    /// `pause=false` is critical (prexu-7fe.1): the TS EOF handler sets
    /// `pause=true` before postplay shows. The `pause` property persists
    /// across `loadfile replace`, so without clearing it here the next
    /// episode would load and then sit paused waiting for the user to
    /// click play. Clearing pause is idempotent — does nothing if mpv
    /// was already unpaused. (`destroy()` sets pause=true because there
    /// IS no next loadfile after it; here we always expect one.)
    ///
    /// The synchronous `mute=true` is the audio-cut guarantee for the
    /// brief gap; TS resets `mute=false` on the next load_url so audio
    /// resumes immediately when the new file is ready.
    ///
    /// Other state across `loadfile replace`:
    ///   - aid / sid: reset to mpv defaults → TS re-sets per episode
    ///   - external sub-add tracks: cleared by mpv on loadfile → no work
    ///   - volume, audio-delay, af, sub-style: persist → TS ready-flush
    ///     re-applies them idempotently after each load
    ///
    /// No-op when mpv isn't initialised (e.g. called twice, or before
    /// the first load) — returns Ok so callers don't need to gate.
    ///
    /// Cross-platform: on Linux the render context stays alive across a soft
    /// stop (only `player_unload`/`destroy` tears it down), so the next
    /// `loadfile` reuses the same mpv handle + GtkGLArea render path.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    pub(crate) fn stop_playback(&self) -> Result<(), String> {
        let guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        let Some(inner) = guard.as_ref() else {
            log::debug!("[player] stop_playback: not initialised, no-op");
            return Ok(());
        };
        log::info!("[player] stop_playback: clearing current file (keep mpv alive)");
        // Mute synchronously — audio cut guarantee for the gap until
        // the next load_url. mpv's `mute` property accepts a bool.
        if let Err(e) = inner.mpv.set_property("mute", true) {
            log::warn!("[player] stop_playback: mute set failed: {:?}", e);
        }
        // Clear any stale pause from the prior file's EOF flow before
        // the next loadfile inherits it. See doc comment (prexu-7fe.1).
        if let Err(e) = inner.mpv.set_property("pause", false) {
            log::warn!("[player] stop_playback: pause=false set failed: {:?}", e);
        }
        // Send mpv `stop` to clear the playlist + current file. Next
        // loadfile starts fresh. `stop` is fast (~ms) — no thread join
        // needed because we're not terminating mpv.
        if let Err(e) = inner.mpv.command("stop", &[]) {
            log::warn!("[player] stop_playback: stop command failed: {:?}", e);
        }
        Ok(())
    }

    /// Synchronously stop playback and destroy the mpv handle.
    ///
    /// The key invariant: when this function returns, mpv is fully terminated
    /// (audio silenced, render threads exited). Callers — notably `player_unload`
    /// from the Tauri frontend — rely on this so audio doesn't keep bleeding
    /// through after navigation.
    ///
    /// Steps:
    /// 1. Take `Inner` out of the Mutex so we control drop order.
    /// 2. SYNCHRONOUSLY silence the player: mute, pause, queue stop+quit.
    ///    These are instant; mute is the audio-cut guarantee that lets the
    ///    caller (TS handleExit) navigate away without an audio bleed.
    /// 3. SPAWN a background thread that joins the event pump (which can
    ///    take up to ~1s to break out of its `wait_event(1.0)` loop after
    ///    Shutdown) and drops Inner — releasing the final Arc<Mpv> and
    ///    triggering `mpv_terminate_destroy` from the background.
    /// 4. Return immediately so the caller's await resolves in <50ms.
    ///
    /// Rationale: previously this function joined the pump synchronously
    /// with a 2s timeout. The TS handleExit awaits this command, so when
    /// the timeout was hit (often, in practice) the user saw the player
    /// chrome / exit-fade for the full 2s before the dashboard rendered.
    /// Audio is already silenced by the synchronous mute, so the slow
    /// teardown can run in the background without user-visible cost.
    pub(crate) fn destroy(&self, app: &AppHandle) -> Result<(), String> {
        let t0 = Instant::now();
        log::info!("[player] destroy: entered");

        // Clear the in-window minimize snapshot on teardown (prexu-ta9). See
        // `clear_minimize_snapshot` — without this a fresh ensure_init after
        // exit-while-minimized re-creates the mpv host (Windows) or re-applies
        // stale video-margin-ratio values (Linux, prexu-axj4.5) at the stale
        // mini inset, so a replay launches in mini even though the React
        // isMinimized flag was reset on exit. Cleared even on the "nothing to
        // destroy" path.
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        self.clear_minimize_snapshot();

        // Abort the long-lived trailing-edge flusher task (prexu-bgz.24).
        // Done before taking `inner` so no in-flight flush can race with
        // the destroy teardown path. `abort()` is instantaneous — it posts
        // a cancellation to the tokio reactor; the task exits on its next
        // await point (which is either `notified()` or `sleep()`). No flush
        // can be lost by this abort: we're inside `destroy()` which only
        // runs when the window is closing, so there will be no further
        // geometry events that need a trailing flush.
        #[cfg(target_os = "windows")]
        if let Ok(mut h) = self.flusher_handle.lock() {
            if let Some(handle) = h.take() {
                log::info!("[player] destroy: aborting flusher task");
                handle.abort();
            }
        }

        let inner = self
            .inner
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?
            .take();

        // `mut` is used on Windows (inner.video_render.take()); on Linux nothing
        // mutates `inner` before it is moved into the teardown task.
        #[allow(unused_mut)]
        let Some(mut inner) = inner else {
            log::debug!("[player] destroy: nothing to destroy");
            return Ok(());
        };
        log::info!("[player] destroy: Inner taken, Arc strong_count={}", Arc::strong_count(&inner.mpv));

        // Linux (prexu-axj4.3): free the mpv render context on the GTK main
        // thread and drop the compositor's `Arc<Mpv>` clone BEFORE the final Arc
        // release below triggers `mpv_terminate_destroy`. This blocks until the
        // main thread has run the teardown, enforcing the
        // `mpv_render_context_free` before `mpv_terminate_destroy` ordering
        // (same bug class as prexu-60mz.4 on Windows).
        #[cfg(target_os = "linux")]
        linux_compositor::detach_mpv(app);

        // Path C3d: stop the video render thread FIRST (composition mode only).
        // `stop()` signals + joins it, which frees the libmpv2 RenderContext and
        // releases the thread's `Arc<Mpv>` clone — both must happen before the
        // final Arc drop in the teardown task triggers `mpv_terminate_destroy`.
        #[cfg(target_os = "windows")]
        if let Some(rt) = inner.video_render.take() {
            log::info!("[player] destroy: stopping video render thread");
            rt.stop();
            log::info!("[player] destroy: video render thread stopped");
        }

        // SYNCHRONOUS silence — mute first so audio cuts immediately, then
        // pause + queue stop/quit. Mute is the only piece the caller has
        // to wait for; everything else propagates through mpv's internals
        // on its own time.
        match inner.mpv.set_property("mute", true) {
            Ok(_) => log::info!("[player] destroy: mute=true set"),
            Err(e) => log::warn!("[player] destroy: mute set failed: {:?}", e),
        }
        match inner.mpv.set_property("pause", true) {
            Ok(_) => log::info!("[player] destroy: pause=true set"),
            Err(e) => log::warn!("[player] destroy: pause set failed: {:?}", e),
        }
        log::info!("[player] destroy: sending stop command");
        if let Err(e) = inner.mpv.command("stop", &[]) {
            log::warn!("[player] destroy: stop failed: {:?}", e);
        }
        log::info!("[player] destroy: sending quit command");
        if let Err(e) = inner.mpv.command("quit", &[]) {
            log::warn!("[player] destroy: quit failed: {:?}", e);
        }

        // ASYNCHRONOUS teardown — pump join + final Arc release happen on a
        // background thread (see `lifecycle::spawn_teardown_task`). Inner is
        // moved in and dropped there.
        lifecycle::spawn_teardown_task(inner, app.clone());

        log::info!(
            "[player] destroy: returning in {}ms (teardown spawned)",
            t0.elapsed().as_millis()
        );
        Ok(())
    }

    /// Fast-path sync for position-only changes (WM_MOVE / drag).
    ///
    /// Pure position changes do NOT trigger mpv's D3D11 swapchain
    /// rebuild — that is gated on WM_SIZE. So we can skip the 50ms
    /// throttle that `sync_geometry` enforces and dispatch SetWindowPos
    /// (with SWP_NOSIZE) at the full event rate, eliminating the
    /// visible mpv-lags-chrome lag during drag (prexu-aqd).
    ///
    /// Caller passes width+height too (not just x,y) because the
    /// minimize-inset corner computation depends on the parent's
    /// dimensions to anchor the mini region. width/height are NOT used
    /// to resize the host — `SWP_NOSIZE` preserves the existing host
    /// size — they only feed the inset computation.
    ///
    /// Still suppressed during fullscreen transitions, same as
    /// `sync_geometry`, so the transition's burst of resize events
    /// doesn't drive position resyncs through this path either.
    #[cfg(target_os = "windows")]
    pub(crate) fn sync_geometry_move(&self, x: i32, y: i32, width: i32, height: i32) {
        log::trace!("[player] sync_geometry_move({},{},{}x{})", x, y, width, height);
        if self.fullscreen_transition.load(Ordering::Acquire) {
            log::trace!("[player] sync_geometry_move suppressed — fullscreen transition");
            return;
        }

        // C4b (prexu-x2bt): the window moved on screen — tell the composition-
        // hosted webview so it repositions OS-owned popups (the IME candidate
        // window). No-op until composition is installed.
        composition_host::notify_window_moved();

        // Acquire geom once to plan the move (inset + dedup), then release
        // before calling inner.try_lock() / SetWindowPos. Dropping geom
        // before try_lock is mandatory: holding it across try_lock would let
        // the re-entrant call (SetWindowPos fires WM_WINDOWPOSCHANGED →
        // handler → sync_geometry_move) deadlock on the geom lock.
        let plan = {
            let Ok(g) = self.geom.lock() else { return };
            geometry::plan_move(&g, x, y, width, height)
            // g is dropped here — geom lock released before try_lock on inner
        };
        let Some(plan) = plan else { return };

        // A move that carried a size change (maximize/restore/snap or a
        // top-left corner drag-resize) is really a resize: delegate to the
        // throttled sync_geometry path (prexu-hia9). A one-shot maximize passes
        // the throttle immediately (gate open), so the video resizes without
        // waiting for the trailing Resized; a continuous corner-resize stays
        // coalesced to ~30 Hz, avoiding the mpv swapchain-rebuild storm.
        //
        // A pure reposition needs no further work under composition hosting:
        // the video visual is composited on the same HWND and tracks the window
        // automatically, and IME popups were already repositioned by the
        // notify_window_moved() call above.
        if matches!(plan, geometry::MovePlan::Resize) {
            self.sync_geometry(x, y, width, height);
        }
    }

    /// Resize/move the host window to match the Tauri main window's content
    /// area. No-op when the player hasn't been initialised yet — the
    /// listener fires from app startup, before any playback.
    ///
    /// Skipped while a fullscreen transition is in progress and
    /// throttled to ~20 Hz on the regular path. When throttled, the
    /// geometry is stored as pending and applied on the next event that
    /// passes the throttle check (trailing-edge guarantee).
    ///
    /// For pure position changes (drag without resize) prefer
    /// `sync_geometry_move` which skips the throttle.
    #[cfg(target_os = "windows")]
    pub(crate) fn sync_geometry(&self, x: i32, y: i32, width: i32, height: i32) {
        log::trace!("[player] sync_geometry({},{},{}x{})", x, y, width, height);
        if self.fullscreen_transition.load(Ordering::Acquire) {
            log::trace!("[player] sync_geometry suppressed — fullscreen transition");
            return;
        }

        // C4b (prexu-x2bt): a maximize/restore/snap shifts the window origin —
        // reposition the composition webview's IME candidate window. No-op until
        // composition is installed.
        composition_host::notify_window_moved();

        // Single geom acquisition: throttle + pending + inset + dedup,
        // all computed while holding one lock by plan_sync, then released
        // before inner.try_lock() / SetWindowPos. The throttle stashes the
        // current args as pending so the trailing-edge flush never loses the
        // final rect of a drag-resize burst.
        let plan = {
            let Ok(mut g) = self.geom.lock() else { return };
            geometry::plan_sync(&mut g, Instant::now(), x, y, width, height)
            // g is dropped here — geom lock released before try_lock on inner
        };
        let (ax, ay, aw, ah) = match plan {
            geometry::SyncPlan::Throttled => {
                log::trace!("[player] sync_geometry throttled, pending stored");
                return;
            }
            geometry::SyncPlan::Deduped => {
                log::trace!("[player] sync_geometry dedup skip");
                return;
            }
            geometry::SyncPlan::Apply(ax, ay, aw, ah) => (ax, ay, aw, ah),
        };
        // try_lock guards against re-entrancy: SetWindowPos fires WM_SIZE
        // synchronously on this thread, which re-enters sync_geometry via
        // the window-event handler. If inner is already held, skip — the
        // ongoing SetWindowPos will finish with the correct geometry.
        let Ok(guard) = self.inner.try_lock() else { return };
        if let Some(inner) = guard.as_ref() {
            if let Some(vr) = inner.video_render.as_ref() {
                // Composition mode: no host HWND. The swapchain tracks the inset
                // SIZE (aw,ah); the video DComp visual is OFFSET to the inset's
                // client-relative corner (ax-x, ay-y) — (0,0) = full-window video,
                // a corner = mini player. Runs on the main thread (window event).
                if aw > 0 && ah > 0 {
                    log::trace!("[player] sync_geometry -> video {}x{} @ ({},{})", aw, ah, ax - x, ay - y);
                    vr.request_resize(aw as u32, ah as u32);
                    composition_host::set_video_dest(ax - x, ay - y, aw as u32, ah as u32);
                }
            }
        }
    }

    /// Immediate, throttle-bypassing geometry sync for discrete window-state
    /// transitions (maximize / restore / un-minimize). The regular
    /// `sync_geometry` throttle exists to coalesce continuous drag-resize
    /// bursts; a one-shot maximize is not a burst, and routing it through the
    /// throttle (plus waiting for the DWM-animation-delayed `WM_SIZE`) is what
    /// makes the host lag the chrome. Applies the supplied client rect at once.
    /// (prexu-hia9)
    #[cfg(target_os = "windows")]
    pub(crate) fn sync_geometry_now(&self, x: i32, y: i32, width: i32, height: i32) {
        log::debug!(
            "[player] sync_geometry_now (state transition) ({},{},{}x{})",
            x, y, width, height
        );
        if self.fullscreen_transition.load(Ordering::Acquire) {
            log::trace!("[player] sync_geometry_now suppressed — fullscreen transition");
            return;
        }
        let plan = {
            let Ok(mut g) = self.geom.lock() else { return };
            geometry::plan_sync_immediate(&mut g, Instant::now(), x, y, width, height)
            // g dropped before inner.try_lock() — same invariant as sync_geometry
        };
        let geometry::SyncPlan::Apply(ax, ay, aw, ah) = plan else { return };
        let Ok(guard) = self.inner.try_lock() else { return };
        if let Some(inner) = guard.as_ref() {
            if let Some(vr) = inner.video_render.as_ref() {
                if aw > 0 && ah > 0 {
                    log::debug!("[player] sync_geometry_now -> video {}x{} @ ({},{})", aw, ah, ax - x, ay - y);
                    vr.request_resize(aw as u32, ah as u32);
                    composition_host::set_video_dest(ax - x, ay - y, aw as u32, ah as u32);
                }
            }
        }
    }

    /// Spawn the long-lived trailing-edge flusher task (prexu-bgz.24).
    ///
    /// Called once from `attach_window_handlers` in `events.rs` before any
    /// window events can fire. Subsequent calls on the same `PlayerState` are
    /// no-ops — the task is only ever created once and reused across all
    /// playback sessions (the state fields it touches are per-`PlayerState`,
    /// not per-session).
    ///
    /// The task loop:
    /// 1. Park: `flusher_notify.notified().await` — zero CPU when idle.
    /// 2. Wake: `notify_one()` arrives from `wake_flusher` (first event of a burst).
    /// 3. Sleep: `tokio::time::sleep(GEOMETRY_SYNC_MIN_INTERVAL).await` — gives
    ///    the burst time to accumulate its final rect into `pending_geometry`.
    /// 4. Flush: `run_on_main_thread(flush_pending_geometry)` — applies the
    ///    stashed rect on the Win32 main thread exactly as before.
    /// 5. Loop back to step 1.
    ///
    /// No spinloop, no per-burst thread creation. The `trailing_scheduled`
    /// AtomicBool dedup is unchanged — `wake_flusher` only calls `notify_one`
    /// when `claim_trailing_schedule()` returns true (i.e. once per burst), so
    /// the flusher is never woken multiple times for the same burst.
    ///
    /// Teardown: `destroy()` calls `abort()` on the stored `JoinHandle` so the
    /// task exits cleanly when the player is torn down.
    #[cfg(target_os = "windows")]
    pub(crate) fn start_flusher(&self, app: AppHandle) {
        let mut guard = match self.flusher_handle.lock() {
            Ok(g) => g,
            Err(e) => {
                log::error!("[player] start_flusher: lock poisoned: {:?}", e);
                return;
            }
        };
        if guard.is_some() {
            log::debug!("[player] start_flusher: already running, no-op");
            return;
        }
        let notify = Arc::clone(&self.flusher_notify);
        log::info!("[player] start_flusher: spawning long-lived trailing-edge flusher task");
        let handle = tauri::async_runtime::spawn(async move {
            log::debug!("[player:flusher] task started");
            loop {
                // Park until a burst starts.
                notify.notified().await;
                log::trace!("[player:flusher] woken for burst, sleeping {}ms",
                    GEOMETRY_SYNC_MIN_INTERVAL.as_millis());
                // Sleep the throttle window so the burst can accumulate
                // its final rect into pending_geometry.
                tokio::time::sleep(GEOMETRY_SYNC_MIN_INTERVAL).await;
                // Dispatch flush to the Win32 main thread.
                let ah = app.clone();
                if let Err(e) = app.run_on_main_thread(move || {
                    let state = ah.state::<PlayerState>();
                    state.flush_pending_geometry();
                }) {
                    log::warn!("[player:flusher] flush dispatch failed: {:?}", e);
                }
            }
        });
        *guard = Some(handle);
    }

    /// Wake the long-lived flusher task when the first event of a resize burst
    /// arrives. Must be called only when `claim_trailing_schedule()` returned
    /// true (the caller won the one-shot-per-burst race).
    #[cfg(target_os = "windows")]
    pub(crate) fn wake_flusher(&self) {
        log::trace!("[player:flusher] wake_flusher: notify_one");
        self.flusher_notify.notify_one();
    }

    /// Try to claim the right to schedule a trailing-edge flush. Returns
    /// true if the caller is the first to ask since the last flush (the
    /// caller should now spawn the worker that will eventually call
    /// `flush_pending_geometry`); returns false if someone else has
    /// already claimed it and a flush is already in flight.
    ///
    /// Atomic swap so claim/flush race-free across the window-event
    /// handler (main thread) and the trailing worker thread.
    #[cfg(target_os = "windows")]
    pub(crate) fn claim_trailing_schedule(&self) -> bool {
        !self.trailing_scheduled.swap(true, Ordering::AcqRel)
    }

    /// Apply any pending geometry stashed by a throttled `sync_geometry`
    /// call. Called from the trailing worker after sleeping the throttle
    /// window. Order matters: clear `trailing_scheduled` BEFORE consuming
    /// pending so a Resized event that arrives mid-flush can schedule a
    /// fresh worker for whatever geometry comes next. No-op when nothing
    /// is pending (e.g. the throttle-passing event already cleared it).
    #[cfg(target_os = "windows")]
    pub(crate) fn flush_pending_geometry(&self) {
        self.trailing_scheduled.store(false, Ordering::Release);
        let pending = self
            .geom
            .lock()
            .ok()
            .and_then(|mut g| g.pending_geometry.take());
        match pending {
            Some((x, y, w, h)) => {
                log::debug!(
                    "[player] flush_pending_geometry applying ({},{},{}x{})",
                    x, y, w, h
                );
                self.sync_geometry(x, y, w, h);
            }
            None => {
                log::trace!("[player] flush_pending_geometry: no pending");
            }
        }
    }

    /// Latch that the main window just lost focus. The next
    /// `Focused(true)` consumes this and runs `reassert_host_on_focus`.
    /// Called from the window-event handler's `Focused(false)` arm.
    #[cfg(target_os = "windows")]
    pub(crate) fn mark_focus_lost(&self) {
        self.pending_focus_reassert.store(true, Ordering::Release);
    }

    /// Atomically consume the focus-lost latch. Returns true exactly
    /// once per out-and-back focus cycle, even if multiple
    /// `Focused(true)` events fire in rapid succession (which Tauri
    /// does emit during click/mouse-enter on top of the real
    /// alt+tab restore). Used by the lib.rs focus handler to gate
    /// the SetWindowPos reassert.
    #[cfg(target_os = "windows")]
    pub(crate) fn consume_focus_reassert(&self) -> bool {
        self.pending_focus_reassert.swap(false, Ordering::AcqRel)
    }

    /// True when the player is currently in pop-out mode (a `pre_popout_geometry`
    /// stash is present). Returns false when the lock is poisoned. Retained as a
    /// pop-out state accessor exercised by the enter/exit state-machine tests;
    /// its former production caller (the legacy host topmost reassert) was
    /// removed when composition hosting became unconditional (prexu-zfyi).
    /// Cross-platform accessor (W5): the pop-out stash it reads is platform-
    /// neutral, so the Linux build compiles it for the un-gated state tests.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    #[allow(dead_code)]
    pub(crate) fn is_in_popout(&self) -> bool {
        self.pre_popout_geometry
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }

    /// Reassert the video geometry after the main Tauri window regains focus.
    ///
    /// Why this exists (prexu-5l5): when another app fully occludes Prexu (any
    /// player mode — full, fullscreen, popout, mini) and the user alt+tabs
    /// back, the composition swapchain can be left stale and never recomposite
    /// without a kick. The visible result is the player chrome rendered
    /// correctly but the video region showing through to whatever was behind.
    ///
    /// Under composition hosting the video lives on the main HWND's own
    /// composited surface, so there is no separate host window to re-anchor or
    /// re-flag topmost — the always-on-top / z-order shuffle the legacy host
    /// suffered no longer applies. Re-applying the current geometry re-runs the
    /// DComp commit (via `apply_host_geometry`), which refreshes the visual.
    ///
    /// Early-returns when mpv isn't initialised so Focused events during
    /// dashboard navigation pay nothing. Gated by `consume_focus_reassert` in
    /// the caller so each out-and-back focus cycle runs this exactly once.
    #[cfg(target_os = "windows")]
    pub(crate) fn reassert_host_on_focus(
        &self,
        _parent: windows::Win32::Foundation::HWND,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) {
        if !self.is_initialised() {
            return;
        }
        log::info!(
            "[player:host] reassert_host_on_focus ({},{},{}x{})",
            x, y, width, height
        );
        // Re-apply the current geometry to re-run the DComp commit and refresh
        // a swapchain left stale while occluded.
        self.apply_host_geometry(x, y, width, height);
    }

    pub(crate) fn with_mpv<R>(
        &self,
        f: impl FnOnce(&Mpv) -> Result<R, libmpv2::Error>,
    ) -> Result<R, String> {
        let guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        let inner = guard
            .as_ref()
            .ok_or_else(|| "mpv not initialised".to_string())?;
        f(&inner.mpv).map_err(|e| format!("mpv error: {:?}", e))
    }

    /// Store (or clear, with `None`) the close-time timeline report context.
    pub fn set_timeline_ctx(&self, ctx: Option<TimelineCtx>) {
        if let Ok(mut guard) = self.timeline_ctx.lock() {
            *guard = ctx;
        }
    }

    /// One-shot take of the report context. A `CloseRequested` is typically
    /// followed by `Destroyed`; taking ensures only the first event reports.
    pub(crate) fn take_timeline_ctx(&self) -> Option<TimelineCtx> {
        self.timeline_ctx.lock().ok().and_then(|mut g| g.take())
    }

    /// Fire the final `state=stopped` timeline report when the window is
    /// closing mid-playback (prexu-50f). Runs on the main thread during
    /// shutdown. mpv is still alive here (CloseRequested fires before
    /// `destroy()`), so the position is read synchronously from `time-pos`
    /// on the caller thread; the network send happens on a spawned thread
    /// so window close is not held hostage by reqwest's blocking client
    /// (which spins up a private tokio runtime) + up to 1.5s of network
    /// I/O (prexu-bgz.9).
    ///
    /// The caller waits at most `CLOSE_REPORT_JOIN_BUDGET` for the send to
    /// finish. A fully detached thread would usually be killed before the
    /// request lands: nothing in the Tauri run loop waits on app exit
    /// (`lib.rs` has no RunEvent handler — `.run()` returns as soon as the
    /// last window is destroyed and the process exits, reaping detached
    /// threads). The bounded wait caps the close delay at 300ms (vs the
    /// old worst case of runtime spawn + 1500ms send) while still letting
    /// the typical LAN Plex request (~tens of ms) land. No-op when no
    /// playback registered a context or the frontend already cleared it
    /// after its own report.
    pub fn report_stopped_on_close(&self) {
        let ctx = self.take_timeline_ctx();
        // time-pos MUST be read here on the caller thread — mpv is torn
        // down immediately after this returns.
        let pos_ms_opt = if ctx.is_some() {
            match self.with_mpv(|mpv| mpv.get_property::<f64>("time-pos")) {
                Ok(secs) => Some((secs * 1000.0).max(0.0).round() as u64),
                Err(e) => {
                    log::warn!("[player] close report skipped — time-pos unavailable: {}", e);
                    None
                }
            }
        } else {
            None
        };
        timeline::fire_stopped_report(ctx, pos_ms_opt);
    }

    /// Apply host geometry directly, bypassing the fullscreen-transition
    /// suppression flag and the throttle. Used from inside the fullscreen
    /// command's main-thread closure to resize the host *immediately* after
    /// Tauri toggles fullscreen, so the video catches up with the overlay
    /// within a frame instead of waiting the full 350 ms transition delay.
    /// The throttle and flag still apply to the normal on_window_event
    /// path — this is a one-off forced apply.
    #[cfg(target_os = "windows")]
    pub(crate) fn apply_host_geometry(&self, x: i32, y: i32, width: i32, height: i32) {
        // Acquire geom to apply inset + update last_geometry, then release
        // before calling inner.lock() / SetWindowPos.
        let adjusted = {
            let Ok(mut g) = self.geom.lock() else { return };
            let (ax, ay, aw, ah) = geometry::apply_minimize_inset_inner(&g, x, y, width, height);
            // Update last_geometry so the throttled sync_geometry doesn't
            // re-apply the same value right after this.
            g.last_geometry = Some((ax, ay, aw, ah));
            (ax, ay, aw, ah)
            // g dropped here
        };
        let (ax, ay, aw, ah) = adjusted;
        let Ok(guard) = self.inner.lock() else { return };
        if let Some(inner) = guard.as_ref() {
            if let Some(vr) = inner.video_render.as_ref() {
                // Composition instant-apply (fullscreen toggle, minimize/popout
                // resync). Size -> swapchain, corner -> visual offset. Caller runs
                // this on the main thread (see resync_host / fullscreen command).
                if aw > 0 && ah > 0 {
                    log::debug!("[player] apply_host_geometry -> video {}x{} @ ({},{})", aw, ah, ax - x, ay - y);
                    vr.request_resize(aw as u32, ah as u32);
                    composition_host::set_video_dest(ax - x, ay - y, aw as u32, ah as u32);
                }
            }
        }
    }

    /// Write the minimize state. Used by minimize commands and popout enter.
    #[cfg(target_os = "windows")]
    pub(crate) fn set_minimize(&self, state: Option<MinimizeState>) -> Result<(), String> {
        self.geom
            .lock()
            .map(|mut g| g.minimize = state)
            .map_err(|_| "minimize lock poisoned".to_string())
    }

    /// Read the current in-window minimize corner-inset state (Windows).
    /// Non-consuming (unlike `clear_minimize_snapshot`), so it can be used by
    /// `player_enter_popout`'s mutual-exclusion guard and by state-round-trip
    /// tests without disturbing what's being asserted. Mirrors the Linux
    /// `get_minimize` accessor so `cross_platform_state_tests` can assert
    /// minimize-inset state via the same call on both platforms (prexu-b3vq).
    #[cfg(target_os = "windows")]
    pub(crate) fn get_minimize(&self) -> Option<MinimizeState> {
        self.geom.lock().ok().and_then(|g| g.minimize)
    }
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}

// This module used to be whole-file `#[cfg(all(test, target_os = "windows"))]`.
// Un-gated (prexu-b3vq) for `any(windows, linux)` at the module level; tests that
// exercise genuinely Windows-only production code (inset-math, the focus-reassert
// atomic latch, the geometry throttle/flusher — see each group's own comment below)
// keep an individual `#[cfg(target_os = "windows")]`. Everything else here — the
// timeline-context tests, the `is_in_popout` tests, the soft-stop no-op test, and the
// `MinimizeCorner` deserialize test — exercises cross-platform code paths and now runs
// on Linux too.
#[cfg(all(test, any(target_os = "windows", target_os = "linux")))]
mod tests {
    use super::*;

    fn timeline_ctx() -> TimelineCtx {
        TimelineCtx {
            server_uri: "https://server.example:32400".into(),
            token: "tok".into(),
            rating_key: "66324".into(),
            duration_ms: 1_244_200,
            client_id: "client-id".into(),
        }
    }

    #[test]
    fn timeline_ctx_take_is_one_shot() {
        let state = PlayerState::new();
        state.set_timeline_ctx(Some(timeline_ctx()));
        assert!(state.take_timeline_ctx().is_some());
        assert!(state.take_timeline_ctx().is_none());
    }

    #[test]
    fn close_report_is_noop_without_ctx_or_mpv() {
        let state = PlayerState::new();
        // No ctx — returns immediately.
        state.report_stopped_on_close();
        // Ctx but no mpv — bails before any network call and consumes the
        // ctx so a follow-up Destroyed event cannot fire a stale report.
        state.set_timeline_ctx(Some(timeline_ctx()));
        state.report_stopped_on_close();
        assert!(state.take_timeline_ctx().is_none());
    }

    #[test]
    fn stopped_report_request_builds_expected_url_and_query() {
        use crate::player::timeline::stopped_report_request;
        let ctx = timeline_ctx();
        let (url, query) = stopped_report_request(&ctx, 123_456);
        assert_eq!(url, "https://server.example:32400/:/timeline");
        let expected: Vec<(String, String)> = vec![
            ("ratingKey".into(), "66324".into()),
            ("key".into(), "/library/metadata/66324".into()),
            ("state".into(), "stopped".into()),
            ("time".into(), "123456".into()),
            ("duration".into(), "1244200".into()),
            ("X-Plex-Client-Identifier".into(), "client-id".into()),
            ("X-Plex-Token".into(), "tok".into()),
        ];
        assert_eq!(query, expected);
    }

    #[test]
    fn clear_timeline_ctx_removes_pending_report() {
        let state = PlayerState::new();
        state.set_timeline_ctx(Some(timeline_ctx()));
        state.set_timeline_ctx(None);
        assert!(state.take_timeline_ctx().is_none());
    }

    // ---- Minimize-inset math (Windows-only) -----------------------------
    // `compute_minimize_inset` computes an absolute PHYSICAL-PIXEL host rect
    // for Win32 `SetWindowPos` — a representation that only exists under the
    // Windows composition host (see the fn's own doc in `geometry.rs`). Linux
    // has no separate host window to position; it insets mpv's video area
    // directly via ratio-based `video-margin-ratio-*` GTK properties instead
    // (`MarginState`/`compute_margin_ratios` in `commands::minimize`, which
    // has its own Linux-side tests). There is no shared platform-neutral core
    // to extract between the two — the math genuinely differs (absolute px
    // rect vs. ratio of live allocation) — so these stay Windows-only.

    /// 360×200 mini-rect at 16 px padding, bottom-right corner. Mirrors
    /// `DEFAULT_MINI_RECT` from `src/utils/mini-rect.ts`.
    #[cfg(target_os = "windows")]
    const DEFAULT: MinimizeState = MinimizeState {
        width: 360,
        height: 200,
        padding: 16,
        corner: MinimizeCorner::BottomRight,
    };

    #[cfg(target_os = "windows")]
    #[test]
    fn inset_at_scale_1_matches_legacy_physical_math() {
        // 1920×1080 client at 100% DPI. With logical = physical at 1.0,
        // the result must equal the pre-prexu-buw output where width /
        // height / padding were already physical.
        let (x, y, w, h) = compute_minimize_inset(DEFAULT, 1.0, 0, 0, 1920, 1080);
        // bottom-right anchor: x = 1920 - 360 - 16 = 1544
        //                      y = 1080 - 200 - 16 =  864
        assert_eq!((x, y, w, h), (1544, 864, 360, 200));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn inset_rescales_when_dpi_changes() {
        // Move from 100% → 125% DPI on a 2400×1350 physical client (which
        // is the same 1920×1080 logical viewport scaled by 1.25). The mini
        // region should grow proportionally so it occupies the same logical
        // footprint on the new monitor.
        let (x, y, w, h) =
            compute_minimize_inset(DEFAULT, 1.25, 0, 0, 2400, 1350);
        // mw = 360 * 1.25 = 450, mh = 200 * 1.25 = 250, pad = 16 * 1.25 = 20
        // x = 2400 - 450 - 20 = 1930
        // y = 1350 - 250 - 20 = 1080
        assert_eq!((x, y, w, h), (1930, 1080, 450, 250));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn inset_honors_left_anchored_corners() {
        let state = MinimizeState {
            corner: MinimizeCorner::TopLeft,
            ..DEFAULT
        };
        let (x, y, w, h) = compute_minimize_inset(state, 1.0, 100, 50, 1920, 1080);
        // top-left: offset = (pad, pad) from client origin
        assert_eq!((x, y, w, h), (116, 66, 360, 200));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn inset_clamps_when_client_smaller_than_mini() {
        // User shrunk the window below the mini width — offsets must clamp
        // to 0 rather than producing negative coords that would push the
        // host off-screen.
        let (x, y, _w, _h) =
            compute_minimize_inset(DEFAULT, 1.0, 0, 0, 100, 100);
        assert_eq!((x, y), (0, 0));
    }

    // ---- Focus-restore host reassert guard (prexu-5l5) -----------------
    // `is_in_popout_*` below exercise the cross-platform `pre_popout_geometry`
    // stash + `is_in_popout()` accessor and run on Linux too. The
    // `focus_reassert_latch_*` tests further down exercise the atomic
    // focus-reassert latch, which stays Windows-only — see that group's own
    // comment.

    #[test]
    fn is_in_popout_false_on_fresh_state() {
        let state = PlayerState::new();
        assert!(!state.is_in_popout());
    }

    #[test]
    fn is_in_popout_true_after_pre_popout_geometry_set() {
        let state = PlayerState::new();
        {
            let mut g = state.pre_popout_geometry.lock().unwrap();
            *g = Some((100, 100, 800, 600));
        }
        assert!(state.is_in_popout());
    }

    #[test]
    fn is_in_popout_false_after_pre_popout_geometry_cleared() {
        let state = PlayerState::new();
        {
            let mut g = state.pre_popout_geometry.lock().unwrap();
            *g = Some((100, 100, 800, 600));
        }
        {
            let mut g = state.pre_popout_geometry.lock().unwrap();
            *g = None;
        }
        assert!(!state.is_in_popout());
    }

    // The atomic focus-reassert latch (`pending_focus_reassert` /
    // `mark_focus_lost` / `consume_focus_reassert`) exists purely to gate
    // `reassert_host_on_focus`, which re-runs the DirectComposition commit on
    // a stale Windows composition-host swapchain after alt-tab occlusion (see
    // that fn's doc, prexu-5l5). Linux has no separate host swapchain to go
    // stale in this way (the GtkGLArea render loop doesn't suffer the same
    // occlusion staleness), so there is no Linux behavior for this latch to
    // gate — it stays Windows-only.
    #[cfg(target_os = "windows")]
    #[test]
    fn focus_reassert_latch_starts_clear() {
        let state = PlayerState::new();
        assert!(!state.consume_focus_reassert());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn focus_reassert_latch_set_then_consume_once() {
        let state = PlayerState::new();
        state.mark_focus_lost();
        assert!(state.consume_focus_reassert(), "first consume returns true");
        assert!(!state.consume_focus_reassert(), "second consume returns false — latch cleared");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn focus_reassert_latch_multi_set_still_consumes_once() {
        // Multiple Focused(false) events in a row (Tauri can emit
        // these during rapid focus shuffles) must not produce
        // multiple reassert runs on the eventual Focused(true).
        let state = PlayerState::new();
        state.mark_focus_lost();
        state.mark_focus_lost();
        state.mark_focus_lost();
        assert!(state.consume_focus_reassert());
        assert!(!state.consume_focus_reassert());
    }

    // ---- Soft stop (prexu-7fe) -----------------------------------------
    // `stop_playback` is cross-platform (`#[cfg(any(windows, linux))]` on
    // `PlayerState::stop_playback`), so its no-op-before-init behavior is
    // verified on both. `reassert_host_on_focus` itself takes a raw Win32
    // `HWND` and only exists on Windows, so its no-op test stays gated.

    #[test]
    fn stop_playback_is_noop_when_mpv_not_init() {
        let state = PlayerState::new();
        assert!(!state.is_initialised());
        assert!(state.stop_playback().is_ok());
        assert!(!state.is_initialised());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn reassert_host_on_focus_is_noop_when_mpv_not_init() {
        let state = PlayerState::new();
        assert!(!state.is_initialised());
        let fake_parent = windows::Win32::Foundation::HWND(std::ptr::null_mut());
        state.reassert_host_on_focus(fake_parent, 0, 0, 1920, 1080);
        assert!(!state.is_initialised());
    }

    // ---- Trailing-edge geometry flush (prexu-hhx) ----------------------
    // This whole group drives `PlayerState::geom` (a `Mutex<GeomState>`) and
    // `GEOMETRY_SYNC_MIN_INTERVAL` — both Windows-only: the throttle exists
    // to coalesce Win32 `SetWindowPos` calls ahead of an mpv D3D11 swapchain
    // rebuild storm (see the field doc on `geom`). Linux has no host window
    // to throttle SetWindowPos-equivalent calls for — GTK's own widget
    // allocation drives resize directly, with nothing analogous to debounce.
    // There is no platform-neutral core to extract here without inventing a
    // throttle Linux doesn't need, so this stays Windows-only.

    /// Force the throttle clock far enough in the past that the next
    /// `sync_geometry` call is guaranteed to pass the throttle gate.
    #[cfg(target_os = "windows")]
    fn release_throttle(state: &PlayerState) {
        let past = Instant::now()
            .checked_sub(GEOMETRY_SYNC_MIN_INTERVAL * 2)
            .unwrap_or_else(Instant::now);
        state.geom.lock().unwrap().last_sync = past;
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn throttled_sync_geometry_stores_pending() {
        let state = PlayerState::new();
        // First call passes the throttle (new() sets last_sync to
        // now - interval) and resets the clock to now.
        state.sync_geometry(0, 0, 1920, 1080);
        assert!(state.geom.lock().unwrap().pending_geometry.is_none());
        // Second call immediately after is throttled → stored as pending.
        state.sync_geometry(10, 20, 800, 600);
        assert_eq!(
            state.geom.lock().unwrap().pending_geometry,
            Some((10, 20, 800, 600))
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn multi_throttled_overwrites_to_latest() {
        let state = PlayerState::new();
        state.sync_geometry(0, 0, 1920, 1080); // passes throttle
        state.sync_geometry(1, 1, 100, 100); // throttled → pending
        state.sync_geometry(2, 2, 200, 200); // throttled → overwrites
        state.sync_geometry(3, 3, 300, 300); // throttled → overwrites again
        assert_eq!(
            state.geom.lock().unwrap().pending_geometry,
            Some((3, 3, 300, 300))
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn flush_consumes_pending_geometry() {
        let state = PlayerState::new();
        state.sync_geometry(0, 0, 1920, 1080); // passes throttle
        state.sync_geometry(50, 60, 400, 300); // throttled → pending
        assert_eq!(
            state.geom.lock().unwrap().pending_geometry,
            Some((50, 60, 400, 300))
        );
        release_throttle(&state);
        state.trailing_scheduled.store(true, Ordering::Release);

        state.flush_pending_geometry();

        assert!(state.geom.lock().unwrap().pending_geometry.is_none());
        assert!(!state.trailing_scheduled.load(Ordering::Acquire));
        assert_eq!(
            state.geom.lock().unwrap().last_geometry,
            Some((50, 60, 400, 300))
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn flush_with_no_pending_is_noop() {
        let state = PlayerState::new();
        state.trailing_scheduled.store(true, Ordering::Release);

        state.flush_pending_geometry();

        assert!(state.geom.lock().unwrap().pending_geometry.is_none());
        assert!(!state.trailing_scheduled.load(Ordering::Acquire));
        assert!(state.geom.lock().unwrap().last_geometry.is_none());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn claim_trailing_schedule_is_one_shot_until_flushed() {
        let state = PlayerState::new();
        assert!(state.claim_trailing_schedule());
        assert!(!state.claim_trailing_schedule());
        assert!(!state.claim_trailing_schedule());
        state.flush_pending_geometry();
        assert!(state.claim_trailing_schedule());
    }

    // ── Long-lived flusher state machine (prexu-bgz.24) -----------------
    //
    // These tests verify the dedup invariant and Notify / flusher_handle
    // lifecycle without spinning up a real tokio runtime or Win32 window.
    // They exercise only the synchronous parts: claim/flush atomics and the
    // Notify count observable via `notify_one` / `try_recv`-equivalent.

    /// After a burst of N throttled events, `claim_trailing_schedule` must
    /// return true exactly once (on the first call) and false for all
    /// subsequent calls. `wake_flusher` is safe to call only on the true
    /// return, so only one `notify_one` is dispatched per burst — exactly as
    /// the old per-burst `std::thread::spawn` dedup did.
    #[cfg(target_os = "windows")]
    #[test]
    fn flusher_dedup_one_wake_per_burst() {
        let state = PlayerState::new();

        // Simulate burst: first claim → true, rest → false.
        let first = state.claim_trailing_schedule();
        assert!(first, "first claim of burst must be true (one wake issued)");
        for _ in 0..5 {
            let subsequent = state.claim_trailing_schedule();
            assert!(!subsequent, "subsequent claims must be false (no extra wakes)");
        }
    }

    /// After `flush_pending_geometry` clears `trailing_scheduled`, the next
    /// burst can claim again — the flusher is re-armed for the next drag
    /// session.
    #[cfg(target_os = "windows")]
    #[test]
    fn flusher_re_armed_after_flush() {
        let state = PlayerState::new();

        // First burst
        assert!(state.claim_trailing_schedule());
        assert!(!state.claim_trailing_schedule());

        // Flush (simulates the flusher task finishing its sleep + dispatch)
        state.flush_pending_geometry();
        assert!(
            !state.trailing_scheduled.load(Ordering::Acquire),
            "trailing_scheduled must be cleared by flush_pending_geometry"
        );

        // Second burst can now claim
        assert!(
            state.claim_trailing_schedule(),
            "must be re-armable after flush for next drag burst"
        );
    }

    /// `flush_pending_geometry` clears `trailing_scheduled` BEFORE consuming
    /// pending. This ordering lets a Resized event that arrives concurrently
    /// during flush claim a new schedule and issue a new `notify_one` for the
    /// geometry that arrived after the flush started — no geometry is lost.
    #[cfg(target_os = "windows")]
    #[test]
    fn flusher_clear_before_consume_ordering() {
        let state = PlayerState::new();

        // Set up: pending geometry + trailing_scheduled set
        state.sync_geometry(0, 0, 1920, 1080); // passes throttle, clears pending
        state.sync_geometry(10, 20, 800, 600); // throttled → stored as pending
        state.trailing_scheduled.store(true, Ordering::Release);

        // Before flush: trailing_scheduled=true, pending=Some(...)
        assert!(state.trailing_scheduled.load(Ordering::Acquire));
        assert!(state.geom.lock().unwrap().pending_geometry.is_some());

        // Release the throttle so flush_pending_geometry's internal
        // sync_geometry call actually applies the geometry.
        release_throttle(&state);

        state.flush_pending_geometry();

        // After flush: trailing_scheduled=false, pending consumed
        assert!(
            !state.trailing_scheduled.load(Ordering::Acquire),
            "trailing_scheduled cleared by flush"
        );
        assert!(
            state.geom.lock().unwrap().pending_geometry.is_none(),
            "pending consumed by flush"
        );
    }

    /// `flusher_handle` starts as `None` before `start_flusher` is called.
    /// After `destroy()` takes + aborts the handle, it must be `None` again.
    /// We use `tokio::spawn` to produce a real `JoinHandle` without needing
    /// a live `AppHandle`.
    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn flusher_handle_lifecycle() {
        let state = PlayerState::new();

        // Initially no flusher.
        assert!(
            state.flusher_handle.lock().unwrap().is_none(),
            "handle must be None before start_flusher"
        );

        // Inject a real tokio task handle (stand-in for what start_flusher
        // would produce via tauri::async_runtime::spawn).
        // `tauri::async_runtime::JoinHandle` is an enum; the Tokio runtime
        // variant wraps a `tokio::task::JoinHandle` (revealed by compiler
        // diagnostic E0308 pointing to `JoinHandle::Tokio`).
        let raw_jh = tokio::spawn(async {
            // Park forever — the abort will cancel it.
            tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
        });
        let jh = tauri::async_runtime::JoinHandle::Tokio(raw_jh);
        *state.flusher_handle.lock().unwrap() = Some(jh);

        assert!(
            state.flusher_handle.lock().unwrap().is_some(),
            "handle must be Some after injection"
        );

        // Simulate destroy() abort path: take + abort.
        let taken = state.flusher_handle.lock().unwrap().take();
        assert!(taken.is_some(), "must have a handle to abort");
        if let Some(h) = taken {
            h.abort();
        }

        assert!(
            state.flusher_handle.lock().unwrap().is_none(),
            "handle must be None after destroy abort"
        );
    }

    #[test]
    fn minimize_corner_deserializes_kebab_case() {
        use MinimizeCorner::*;
        assert_eq!(
            serde_json::from_str::<MinimizeCorner>(r#""top-left""#).unwrap(),
            TopLeft
        );
        assert_eq!(
            serde_json::from_str::<MinimizeCorner>(r#""top-right""#).unwrap(),
            TopRight
        );
        assert_eq!(
            serde_json::from_str::<MinimizeCorner>(r#""bottom-left""#).unwrap(),
            BottomLeft
        );
        assert_eq!(
            serde_json::from_str::<MinimizeCorner>(r#""bottom-right""#).unwrap(),
            BottomRight
        );
        assert!(serde_json::from_str::<MinimizeCorner>(r#""diagonal""#).is_err());
    }
}

// Cross-platform PlayerState pop-out / minimize-inset state tests (W5, prexu-pd1x.5;
// minimize-inset round-trips un-gated in prexu-b3vq via the `get_minimize` accessor).
// These exercise pure state-machine logic — pre_popout_geometry stash round-trip and
// minimize-inset set/clear round-trips (teardown, popout-enter mutual exclusion) — that
// is identical on Windows and Linux (both platforms expose the same `set_minimize` /
// `get_minimize` / `clear_minimize_snapshot` signatures, backed by `geom.minimize` on
// Windows and `linux_margin` on Linux), so they run in the linux-build CI job too, not
// only on Windows. The remaining tests in `mod tests` stay Windows-only where they
// depend on genuinely Windows-only infrastructure that has no Linux equivalent to run
// against: `compute_minimize_inset`'s absolute-pixel host-rect math (Linux insets video
// via ratio-based `video-margin-ratio-*` GTK properties instead — a structurally
// different representation, see `MarginState`), the atomic focus-reassert latch (guards
// `reassert_host_on_focus`, itself Windows-only composition-host machinery), and the
// geometry throttle/flusher (Windows' Win32 `SetWindowPos` needs throttling; GTK drives
// Linux resize directly with no equivalent to throttle). See the PR description for the
// per-group rationale.
#[cfg(all(test, any(target_os = "windows", target_os = "linux")))]
mod cross_platform_state_tests {
    use super::*;

    // ── Pop-out enter/exit state transitions ─────────────────────────────

    #[test]
    fn popout_enter_stashes_pre_popout_geometry() {
        let state = PlayerState::new();
        assert!(state.pre_popout_geometry.lock().unwrap().is_none());
        *state.pre_popout_geometry.lock().unwrap() = Some((100, 200, 1280, 800));
        let stash = *state.pre_popout_geometry.lock().unwrap();
        assert_eq!(stash, Some((100, 200, 1280, 800)));
        assert!(state.is_in_popout());
    }

    #[test]
    fn popout_exit_consumes_stash_leaving_none() {
        let state = PlayerState::new();
        *state.pre_popout_geometry.lock().unwrap() = Some((100, 200, 1280, 800));
        assert!(state.is_in_popout());

        let taken = state
            .pre_popout_geometry
            .lock()
            .unwrap()
            .take();
        assert_eq!(taken, Some((100, 200, 1280, 800)));
        assert!(!state.is_in_popout());
        assert!(state.pre_popout_geometry.lock().unwrap().is_none());
    }

    #[test]
    fn popout_exit_without_prior_enter_returns_none_stash() {
        let state = PlayerState::new();
        assert!(!state.is_in_popout());
        let taken = state
            .pre_popout_geometry
            .lock()
            .unwrap()
            .take();
        assert!(taken.is_none());
        assert!(!state.is_in_popout());
    }

    // Cross-platform (prexu-b3vq): both platforms expose the same
    // `set_minimize`/`get_minimize` signatures — Windows backs them with the
    // `geom.minimize` field, Linux with `linux_margin` — so this STATE
    // round-trip (set inset -> cleared on teardown/popout-enter) is verified
    // identically on both without touching either platform's private field.
    #[test]
    fn clear_minimize_snapshot_drops_leftover_inset_on_teardown() {
        let state = PlayerState::new();
        state.set_minimize(Some(MinimizeState {
            width: 959,
            height: 720,
            padding: 16,
            corner: MinimizeCorner::BottomLeft,
        })).unwrap();
        assert!(state.get_minimize().is_some());

        let had = state.clear_minimize_snapshot();
        assert!(had, "snapshot should have been present before teardown");
        assert!(
            state.get_minimize().is_none(),
            "minimize snapshot must be cleared so next session starts full"
        );

        assert!(!state.clear_minimize_snapshot());
        assert!(state.get_minimize().is_none());
    }

    #[test]
    fn popout_enter_clears_leftover_minimize_inset() {
        let state = PlayerState::new();
        state.set_minimize(Some(MinimizeState {
            width: 360,
            height: 200,
            padding: 16,
            corner: MinimizeCorner::BottomRight,
        })).unwrap();
        assert!(state.get_minimize().is_some());

        // Simulate what player_enter_popout does: clear minimize.
        state.set_minimize(None).unwrap();
        assert!(state.get_minimize().is_none());
    }

    #[test]
    fn popout_enter_is_noop_on_minimize_when_already_none() {
        let state = PlayerState::new();
        assert!(state.get_minimize().is_none());
        state.set_minimize(None).unwrap();
        assert!(state.get_minimize().is_none());
        assert!(!state.is_in_popout());
    }

    #[test]
    fn popout_enter_then_exit_round_trips_without_minimize_leaking() {
        let state = PlayerState::new();
        state.set_minimize(Some(MinimizeState {
            width: 360,
            height: 200,
            padding: 16,
            corner: MinimizeCorner::BottomRight,
        })).unwrap();

        // enter: clear minimize + stash geometry
        state.set_minimize(None).unwrap();
        *state.pre_popout_geometry.lock().unwrap() = Some((50, 50, 1920, 1080));

        assert!(state.is_in_popout());
        assert!(state.get_minimize().is_none());

        // exit: consume stash
        let taken = state.pre_popout_geometry.lock().unwrap().take();
        assert_eq!(taken, Some((50, 50, 1920, 1080)));
        assert!(!state.is_in_popout());
        assert!(state.get_minimize().is_none());
    }
}
