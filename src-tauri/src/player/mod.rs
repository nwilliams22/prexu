//! Native libmpv-backed player (Windows-first).

pub mod commands;
pub mod events;
pub(crate) mod geometry;
pub(crate) mod timeline;

#[cfg(target_os = "windows")]
pub mod host_window;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use tokio::sync::Notify;

use libmpv2::Mpv;
use tauri::{AppHandle, Manager};

use geometry::GeomState;

// Re-export pure helpers that external callers (commands/, lib.rs) reference
// via `crate::player::*`.
pub(crate) use geometry::{compute_minimize_inset, initial_host_geometry};
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
    /// the transition settles.
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
    /// guard on `inner` remains separate and non-blocking.
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
    /// event arrives to consume it.
    trailing_scheduled: AtomicBool,
    /// Saved (x, y, width, height) of the Tauri main window's outer rect
    /// before entering pop-out mode. Stashed by `player_enter_popout` and
    /// consumed by `player_exit_popout` to restore the previous geometry.
    /// `None` when not in pop-out mode.
    pub(crate) pre_popout_geometry: Mutex<Option<(i32, i32, u32, u32)>>,
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MinimizeCorner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

/// Logical-pixel parameters of the in-window mini region. Stored in
/// `GeomState::minimize` so `apply_minimize_inset_inner` can produce the
/// correct host geometry on every Resized event.
///
/// Width / height / padding are CSS (logical) pixels, matching what the
/// React side sends across the IPC. The conversion to physical pixels
/// happens lazily inside the geometry path against the latest
/// `GeomState::scale_factor` — this lets cross-monitor DPI changes
/// (`WindowEvent::ScaleFactorChanged`) recompute the host rect at the
/// new scale without re-firing `player_enter_minimize` from the frontend.
#[derive(Debug, Clone, Copy)]
pub struct MinimizeState {
    pub width: u32,
    pub height: u32,
    pub padding: u32,
    pub corner: MinimizeCorner,
}

struct Inner {
    mpv: Arc<Mpv>,
    /// Event pump JoinHandle. `destroy()` joins this before dropping the
    /// rest of Inner so mpv's final Arc (held by the pump) is released
    /// synchronously — `mpv_terminate_destroy` then runs while we still
    /// own the HWND, avoiding the race where DestroyWindow ran before
    /// mpv's render thread stopped using it.
    event_pump: Option<JoinHandle<()>>,
    /// Host HWND. Created on and owned by the Tauri main thread (see
    /// `ensure_init`), so cross-thread SetWindowPos calls from the main
    /// thread's on_window_event handler and the fullscreen sync closure
    /// are NOT cross-thread — they hit a window the calling thread owns,
    /// so SetWindowPos is synchronous and non-blocking. Wrapped in Option
    /// so `destroy()` can `take()` it and dispatch the Drop (which runs
    /// DestroyWindow) back to the main thread.
    #[cfg(target_os = "windows")]
    host: Option<host_window::HostWindow>,
}

impl PlayerState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            init_lock: Mutex::new(()),
            fullscreen_transition: AtomicBool::new(false),
            geom: Mutex::new(GeomState::new()),
            trailing_scheduled: AtomicBool::new(false),
            pre_popout_geometry: Mutex::new(None),
            #[cfg(target_os = "windows")]
            pending_focus_reassert: AtomicBool::new(false),
            timeline_ctx: Mutex::new(None),
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
        if let Ok(mut g) = self.geom.lock() {
            if (g.scale_factor - scale).abs() > f64::EPSILON {
                log::info!(
                    "[player:host] scale factor {:.3} → {:.3}",
                    g.scale_factor,
                    scale
                );
                g.scale_factor = scale;
            }
        }
    }

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

        // Snapshot minimize state + DPI scale BEFORE the run_on_main_thread
        // closure so the closure (which is 'static + Send) can compute the
        // mini-inset rect without capturing &self. When `ensure_init` runs
        // during an in-mini autoplay handoff (prexu-may), the new host MUST
        // be sized to the mini inset on its FIRST set_geometry — otherwise
        // mpv's vo computes its swapchain against the full WebView rect and
        // the first frame renders black/clipped after the later sync_geometry
        // shrinks the host. Pre-snapshotting here keeps the fix on a single
        // code path (the initial set_geometry below) and avoids a second
        // SetWindowPos that would also trigger a swapchain rebuild.
        #[cfg(target_os = "windows")]
        let (minimize_snapshot, scale_snapshot) = {
            let g = self.geom.lock().ok();
            let snap = g.as_ref().and_then(|g| g.minimize);
            let scale = g.as_ref().map(|g| g.scale_factor).unwrap_or(1.0);
            (snap, scale)
        };

        // On Windows, create the native host window on the MAIN THREAD.
        // Win32 windows are thread-affine: a window's WndProc runs on the
        // thread that called CreateWindow. SetWindowPos from another thread
        // does a cross-thread SendMessage and waits for the owner to pump
        // messages. Tauri's main thread pumps Win32 messages; tokio worker
        // threads (which run `#[tauri::command] async fn`) do not. If the
        // host were created on a tokio worker, the Tauri main thread's
        // on_window_event → sync_geometry → SetWindowPos would block
        // indefinitely (proven by log at 2026-04-19 23:12:30 where the
        // main-thread closure hung inside set_geometry, freezing IPC so
        // that a subsequent back-click's player_unload never reached the
        // backend while mpv kept playing audio).
        //
        // Block on rx.recv: we're on a tokio worker (async command), main
        // thread is alive and will service the queued closure. Safe.
        #[cfg(target_os = "windows")]
        let host = {
            let app_for_spawn = app.clone();
            let (tx, rx) = std::sync::mpsc::channel();
            app.run_on_main_thread(move || {
                let result: Result<host_window::HostWindow, String> = (|| {
                    let main = app_for_spawn
                        .get_webview_window("main")
                        .ok_or_else(|| "main webview window not found".to_string())?;
                    let parent = main
                        .hwnd()
                        .map_err(|e| format!("Failed to get main HWND: {}", e))?;
                    let host = host_window::HostWindow::create(parent)?;
                    log::info!("[player:host] created on main, parent={:?}", parent.0);

                    if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
                        let (gx, gy, gw, gh) = initial_host_geometry(
                            minimize_snapshot,
                            scale_snapshot,
                            pos.x,
                            pos.y,
                            size.width as i32,
                            size.height as i32,
                        );
                        let _ = host.set_geometry(gx, gy, gw, gh);
                        log::debug!(
                            "[player] initial geometry sync to ({},{},{}x{}){}",
                            gx, gy, gw, gh,
                            if minimize_snapshot.is_some() { " (mini-inset)" } else { "" }
                        );
                    }
                    let _ = host.set_visible(true);
                    log::debug!("[player:host] set visible");
                    // Re-anchor z-order below main. SW_SHOWNA shouldn't
                    // raise it, but this is belt-and-suspenders to ensure
                    // the host never covers the WebView.
                    if let Err(e) = host.anchor_below(parent) {
                        log::warn!("[player:host] anchor_below failed: {}", e);
                    } else {
                        log::debug!("[player:host] anchored below parent");
                    }
                    Ok(host)
                })();
                let _ = tx.send(result);
            })
            .map_err(|e| format!("run_on_main_thread for host create failed: {:?}", e))?;
            rx.recv()
                .map_err(|e| format!("host create channel recv failed: {}", e))??
        };

        #[cfg(target_os = "windows")]
        let wid = host.hwnd_as_i64();

        // Marker for cold-start latency attribution. The gap between this
        // log and the first "FileLoaded" event covers: (a) mpv handle
        // construction, (b) demuxer opening the network stream (cold
        // plex.direct connect), and (c) hardware decoder probing.
        log::info!("[player:init] starting mpv init (hwdec=auto-safe)");

        let mpv = Mpv::with_initializer(|init| {
            #[cfg(target_os = "windows")]
            init.set_property("wid", wid)?;
            init.set_property("hwdec", "auto-safe")?;
            init.set_property("vo", "gpu-next")?;
            init.set_property("keep-open", "always")?;
            init.set_property("force-window", "no")?;
            init.set_property("volume-max", 200_i64)?;
            // Disable mpv's built-in OSD — we render our own UI in React.
            // Default osd-level=1 + osd-bar=yes draws a horizontal progress
            // bar in the middle of the video on every seek, which shows
            // through the transparent webview alongside our custom seek bar.
            init.set_property("osd-level", 0_i64)?;
            init.set_property("osd-bar", "no")?;

            // ── Playback perf tuning ──
            // Bigger forward demuxer cache absorbs network hiccups on
            // remote Plex / mediocre Wi-Fi without re-buffering. Plex
            // direct-play streams over HTTP, so deeper read-ahead costs
            // only RAM, not CPU.
            //   - cache=yes              : explicit (default is already yes)
            //   - demuxer-readahead-secs : read 20s of video ahead
            //   - cache-secs             : keep 30s in the forward cache
            //   - cache-pause=no         : don't yank playback to paused
            //                              if the cache momentarily dips
            init.set_property("cache", "yes")?;
            init.set_property("demuxer-readahead-secs", 20_i64)?;
            init.set_property("cache-secs", 30_i64)?;
            init.set_property("cache-pause", "no")?;

            Ok(())
        })
        .map_err(|e| format!("mpv init failed: {:?}", e))?;
        log::info!("[player] mpv created with wid={}", wid);

        let mpv = Arc::new(mpv);
        let event_pump = events::spawn_event_pump(Arc::clone(&mpv), app.clone())?;

        let mut guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        *guard = Some(Inner {
            mpv,
            event_pump: Some(event_pump),
            #[cfg(target_os = "windows")]
            host: Some(host),
        });
        log::info!("[player] event pump spawned, init complete");
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
    #[cfg(target_os = "windows")]
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

    /// Synchronously stop playback and destroy the mpv handle + host window.
    ///
    /// The key invariant: when this function returns, mpv is fully terminated
    /// (audio silenced, render threads exited) AND the host HWND is destroyed.
    /// Callers — notably `player_unload` from the Tauri frontend — rely on
    /// this so audio doesn't keep bleeding through after navigation.
    ///
    /// Steps:
    /// 1. Take `Inner` out of the Mutex so we control drop order.
    /// 2. SYNCHRONOUSLY silence the player: mute, pause, queue stop+quit.
    ///    These are instant; mute is the audio-cut guarantee that lets the
    ///    caller (TS handleExit) navigate away without an audio bleed.
    /// 3. SPAWN a background thread that joins the event pump (which can
    ///    take up to ~1s to break out of its `wait_event(1.0)` loop after
    ///    Shutdown), dispatches HostWindow drop to the main thread, and
    ///    drops Inner — releasing the final Arc<Mpv> and triggering
    ///    `mpv_terminate_destroy` from the background.
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
        // exit-while-minimized re-creates the mpv host at the stale mini inset,
        // so a replay launches in mini even though the React isMinimized flag
        // was reset on exit. Cleared even on the "nothing to destroy" path.
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

        let Some(mut inner) = inner else {
            log::debug!("[player] destroy: nothing to destroy");
            return Ok(());
        };
        log::info!("[player] destroy: Inner taken, Arc strong_count={}", Arc::strong_count(&inner.mpv));

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

        // ASYNCHRONOUS teardown — pump join + host drop + final Arc release
        // all happen on a background thread. Inner is moved in; HostWindow
        // is `unsafe impl Send` (host_window.rs) and we re-dispatch its
        // drop back to the main thread via run_on_main_thread.
        let app = app.clone();
        std::thread::spawn(move || {
            if let Some(handle) = inner.event_pump.take() {
                log::info!("[player] destroy:bg joining event pump (unbounded)");
                let start = Instant::now();
                let _ = handle.join();
                log::info!(
                    "[player] destroy:bg event pump joined in {}ms",
                    start.elapsed().as_millis()
                );
            }
            #[cfg(target_os = "windows")]
            if let Some(host) = inner.host.take() {
                log::info!("[player] destroy:bg dispatching host drop to main thread");
                if let Err(e) = app.run_on_main_thread(move || {
                    drop(host);
                    log::info!("[player:host] dropped on main thread");
                }) {
                    log::warn!(
                        "[player] destroy:bg run_on_main_thread for host drop failed: {:?} (host leaked)",
                        e
                    );
                }
            }
            log::info!(
                "[player] destroy:bg dropping Inner (Arc strong_count={})",
                Arc::strong_count(&inner.mpv)
            );
            // `inner` drops at end of closure. If pump released its Arc,
            // this is the last ref → mpv_terminate_destroy runs here.
        });

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

        // Acquire geom once to compute the adjusted position and check dedup,
        // then release before calling inner.try_lock() / SetWindowPos.
        // A second geom acquisition after SetWindowPos updates last_geometry.
        // Two acquisitions (not one) are required because we must drop geom
        // before inner.try_lock() — holding geom across try_lock would cause
        // the re-entrant call (SetWindowPos fires WM_WINDOWPOSCHANGED → handler
        // → sync_geometry_move) to deadlock on the geom lock.
        let (ax, ay, existing_size) = {
            let Ok(g) = self.geom.lock() else { return };
            let (ax, ay, _aw, _ah) =
                geometry::apply_minimize_inset_inner(&g, x, y, width, height);
            if let Some((lx, ly, _, _)) = g.last_geometry {
                if lx == ax && ly == ay {
                    return;
                }
            }
            let existing_size = g.last_geometry.map(|(_, _, lw, lh)| (lw, lh));
            (ax, ay, existing_size)
            // g is dropped here — geom lock released before try_lock on inner
        };

        // try_lock guards against re-entrancy: SetWindowPos fires
        // WM_WINDOWPOSCHANGED synchronously on this thread, which can
        // re-enter sync_geometry_move via the window-event handler.
        let Ok(guard) = self.inner.try_lock() else { return };
        if let Some(inner) = guard.as_ref() {
            if let Some(host) = inner.host.as_ref() {
                if let Err(e) = host.set_position(ax, ay) {
                    log::warn!("[player] sync_geometry_move failed: {}", e);
                    return;
                }
                // Keep last_geometry's (x, y) in sync so the next
                // sync_geometry call (resize) dedup-compares correctly.
                if let Some((lw, lh)) = existing_size {
                    if let Ok(mut g) = self.geom.lock() {
                        g.last_geometry = Some((ax, ay, lw, lh));
                    }
                }
            }
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

        // Single geom acquisition: throttle + pending + inset + dedup,
        // all computed while holding one lock, then released before
        // inner.try_lock() / SetWindowPos.
        let apply_geom = {
            let Ok(mut g) = self.geom.lock() else { return };
            let now = Instant::now();
            if geometry::should_throttle(g.last_sync, now) {
                // Throttled — store as pending so trailing edge is never lost.
                g.pending_geometry = Some((x, y, width, height));
                log::trace!("[player] sync_geometry throttled, pending stored");
                return;
            }
            g.last_sync = now;
            // Apply the CURRENT call's args, not any stored pending geometry.
            // Pending is cleared so it doesn't apply on a future call, but
            // the current args are always the freshest known geometry — every
            // Resized event triggers a new sync_geometry with the latest rect,
            // so the trailing-edge case is already covered by the next event.
            g.pending_geometry = None;
            // Apply the minimize inset. When not minimized this is a
            // pass-through, so non-minimize playback is unaffected.
            let (ax, ay, aw, ah) = geometry::apply_minimize_inset_inner(&g, x, y, width, height);
            // Skip if geometry hasn't changed since last apply.
            let new = (ax, ay, aw, ah);
            if g.last_geometry == Some(new) {
                log::trace!("[player] sync_geometry dedup skip");
                return;
            }
            g.last_geometry = Some(new);
            new
            // g is dropped here — geom lock released before try_lock on inner
        };

        let (ax, ay, aw, ah) = apply_geom;
        // try_lock guards against re-entrancy: SetWindowPos fires WM_SIZE
        // synchronously on this thread, which re-enters sync_geometry via
        // the window-event handler. If inner is already held, skip — the
        // ongoing SetWindowPos will finish with the correct geometry.
        let Ok(guard) = self.inner.try_lock() else { return };
        if let Some(inner) = guard.as_ref() {
            if let Some(host) = inner.host.as_ref() {
                log::debug!("[player] sync_geometry applied ({},{},{}x{})", ax, ay, aw, ah);
                if let Err(e) = host.set_geometry(ax, ay, aw, ah) {
                    log::warn!("[player] sync_geometry failed: {}", e);
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

    /// True when the player is currently in pop-out mode. Used to decide
    /// whether the focus-restore reassert also needs to re-flag the
    /// host's WS_EX_TOPMOST (popout) or just nudge geometry + z-order
    /// (full / fullscreen / minimize). Returns false when the lock is
    /// poisoned — callers treat that as "not in popout" so they skip
    /// the topmost reassert.
    #[cfg(target_os = "windows")]
    pub(crate) fn is_in_popout(&self) -> bool {
        self.pre_popout_geometry
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }

    /// Reassert the mpv host window's geometry (and topmost flag,
    /// when in popout) after the main Tauri window regains focus.
    ///
    /// Why this exists (prexu-5l5): when another app fully occludes
    /// Prexu (any player mode — full, fullscreen, popout, mini) and
    /// the user alt+tabs back, the mpv vo's D3D11 swap chain can be
    /// left in `DXGI_STATUS_OCCLUDED` and never re-Present without a
    /// kick. The visible result is the player chrome rendered
    /// correctly but the video region showing through to whatever
    /// was behind.
    ///
    /// Mode-split recovery:
    /// - **Full / fullscreen / mini**: only `apply_host_geometry`.
    ///   The forced `SetWindowPos` triggers WM_PAINT on the host;
    ///   mpv's vo handles WM_PAINT by Presenting the next frame,
    ///   which flushes the occluded swap chain. No z-order or
    ///   topmost change, so WebView2 mouse capture is undisturbed.
    /// - **Popout**: `apply_host_topmost(true, Some(parent))` first
    ///   to re-flag WS_EX_TOPMOST + re-anchor below the WebView
    ///   (the always-on-top group can shuffle the host out from
    ///   under the WebView during the focus restore), then
    ///   `apply_host_geometry` for the Present nudge.
    ///
    /// Why the split: in non-popout modes the host is already in
    /// the normal z-order under the WebView; running
    /// `apply_host_topmost(false, Some(parent))` issues a
    /// `SetWindowPos(HWND_NOTOPMOST)` that briefly leaves the host
    /// above sibling z-order before the follow-up `anchor_below`
    /// re-seats it. During that micro-window Win32 re-evaluates
    /// cursor ownership and the WebView2 cursor capture gets
    /// stuck on the host's thick-frame edge hit-test (resize
    /// glyph). Skipping the redundant topmost flip avoids the
    /// flicker entirely.
    ///
    /// Early-returns when mpv isn't initialised so Focused events
    /// during dashboard navigation pay nothing. Gated by
    /// `consume_focus_reassert` in the caller so each out-and-back
    /// focus cycle runs this exactly once.
    #[cfg(target_os = "windows")]
    pub(crate) fn reassert_host_on_focus(
        &self,
        parent: windows::Win32::Foundation::HWND,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) {
        if !self.is_initialised() {
            return;
        }
        let in_popout = self.is_in_popout();
        log::info!(
            "[player:host] reassert_host_on_focus ({},{},{}x{}) popout={}",
            x, y, width, height, in_popout
        );
        if in_popout {
            // Popout: reassert topmost flag + anchor in one call.
            // The always-on-top group can drop the host out from
            // under the WebView during a focus shuffle, so we need
            // BOTH the WS_EX_TOPMOST flip and the anchor.
            self.apply_host_topmost(true, Some(parent));
        } else {
            // Non-popout: anchor-only reassert. Single SetWindowPos
            // with insertAfter=parent triggers WM_WINDOWPOSCHANGED
            // → mpv vo rebuilds the D3D11 swap chain (kicks the
            // occluded state). Skips the HWND_NOTOPMOST flip that
            // would briefly put the host above the WebView and
            // disrupt WebView2 mouse capture (cursor stuck on host
            // edge resize glyph — prexu-5l5 follow-up).
            self.reassert_host_anchor(parent);
        }
        // Geometry nudge — forces SetWindowPos which triggers
        // WM_PAINT and the next Present, flushing any occluded
        // D3D11 swap chain.
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
            if let Some(host) = inner.host.as_ref() {
                log::debug!(
                    "[player] apply_host_geometry force ({},{},{}x{})",
                    ax, ay, aw, ah
                );
                if let Err(e) = host.set_geometry(ax, ay, aw, ah) {
                    log::warn!("[player] apply_host_geometry failed: {}", e);
                }
            }
        }
    }

    /// Re-anchor the mpv host window directly below the WebView in
    /// z-order without touching its WS_EX_TOPMOST flag. Single
    /// `SetWindowPos(parent, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE)`
    /// call — enough to trigger `WM_WINDOWPOSCHANGED` on the host
    /// (which mpv's vo handles by rebuilding its D3D11 swap chain),
    /// but cheap enough not to disturb WebView2 mouse capture.
    ///
    /// Used by the focus-restore reassert path in non-popout modes
    /// (full / fullscreen / mini). Popout uses `apply_host_topmost`
    /// instead because it also needs the topmost flag reasserted.
    /// (prexu-5l5 follow-up)
    #[cfg(target_os = "windows")]
    pub(crate) fn reassert_host_anchor(
        &self,
        parent: windows::Win32::Foundation::HWND,
    ) {
        let Ok(guard) = self.inner.lock() else {
            return;
        };
        if let Some(inner) = guard.as_ref() {
            if let Some(host) = inner.host.as_ref() {
                log::debug!("[player] reassert_host_anchor");
                if let Err(e) = host.anchor_below(parent) {
                    log::warn!("[player:host] reassert_host_anchor failed: {}", e);
                }
            }
        }
    }

    /// Toggle the mpv host window's topmost flag for pop-out mode so the
    /// video floats above other apps the same way the WebView overlay does.
    ///
    /// Re-anchors below `parent` whenever a parent is provided, on BOTH
    /// the topmost=true and topmost=false paths. SetWindowPos(HWND_NOTOPMOST)
    /// only drops the host below other topmost windows — it does NOT put
    /// it back below the WebView in the regular z-order group. Without the
    /// anchor_below(parent) here, after exit_popout the host floats above
    /// the WebView and steals all mouse events.
    #[cfg(target_os = "windows")]
    pub(crate) fn apply_host_topmost(
        &self,
        topmost: bool,
        parent: Option<windows::Win32::Foundation::HWND>,
    ) {
        let Ok(guard) = self.inner.lock() else {
            return;
        };
        if let Some(inner) = guard.as_ref() {
            if let Some(host) = inner.host.as_ref() {
                log::info!("[player] apply_host_topmost({})", topmost);
                if let Err(e) = host.set_topmost(topmost) {
                    log::warn!("[player] apply_host_topmost failed: {}", e);
                }
                if let Some(p) = parent {
                    if let Err(e) = host.anchor_below(p) {
                        log::warn!(
                            "[player] apply_host_topmost: anchor_below failed: {}",
                            e
                        );
                    }
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
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(all(test, target_os = "windows"))]
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

    /// 360×200 mini-rect at 16 px padding, bottom-right corner. Mirrors
    /// `DEFAULT_MINI_RECT` from `src/utils/mini-rect.ts`.
    const DEFAULT: MinimizeState = MinimizeState {
        width: 360,
        height: 200,
        padding: 16,
        corner: MinimizeCorner::BottomRight,
    };

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

    #[test]
    fn inset_clamps_when_client_smaller_than_mini() {
        // User shrunk the window below the mini width — offsets must clamp
        // to 0 rather than producing negative coords that would push the
        // host off-screen.
        let (x, y, _w, _h) =
            compute_minimize_inset(DEFAULT, 1.0, 0, 0, 100, 100);
        assert_eq!((x, y), (0, 0));
    }

    // ---- initial_host_geometry (prexu-may) -----------------------------

    #[test]
    fn initial_host_geometry_passthrough_when_no_minimize() {
        let (x, y, w, h) =
            initial_host_geometry(None, 1.0, 100, 50, 1920, 1080);
        assert_eq!((x, y, w, h), (100, 50, 1920, 1080));
    }

    #[test]
    fn initial_host_geometry_applies_inset_when_minimize_present() {
        let snap = Some(DEFAULT);
        let got = initial_host_geometry(snap, 1.0, 0, 0, 1920, 1080);
        let expected = compute_minimize_inset(DEFAULT, 1.0, 0, 0, 1920, 1080);
        assert_eq!(got, expected);
        assert_eq!(got, (1544, 864, 360, 200));
    }

    #[test]
    fn initial_host_geometry_inset_respects_dpi_scale() {
        let (_, _, w, h) =
            initial_host_geometry(Some(DEFAULT), 1.25, 0, 0, 2400, 1350);
        assert_eq!((w, h), (450, 250));
    }

    // ---- Focus-restore host reassert guard (prexu-5l5) -----------------

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

    #[test]
    fn focus_reassert_latch_starts_clear() {
        let state = PlayerState::new();
        assert!(!state.consume_focus_reassert());
    }

    #[test]
    fn focus_reassert_latch_set_then_consume_once() {
        let state = PlayerState::new();
        state.mark_focus_lost();
        assert!(state.consume_focus_reassert(), "first consume returns true");
        assert!(!state.consume_focus_reassert(), "second consume returns false — latch cleared");
    }

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

    #[test]
    fn stop_playback_is_noop_when_mpv_not_init() {
        let state = PlayerState::new();
        assert!(!state.is_initialised());
        assert!(state.stop_playback().is_ok());
        assert!(!state.is_initialised());
    }

    #[test]
    fn reassert_host_on_focus_is_noop_when_mpv_not_init() {
        let state = PlayerState::new();
        assert!(!state.is_initialised());
        let fake_parent = windows::Win32::Foundation::HWND(std::ptr::null_mut());
        state.reassert_host_on_focus(fake_parent, 0, 0, 1920, 1080);
        assert!(!state.is_initialised());
    }

    // ---- Trailing-edge geometry flush (prexu-hhx) ----------------------

    /// Force the throttle clock far enough in the past that the next
    /// `sync_geometry` call is guaranteed to pass the throttle gate.
    fn release_throttle(state: &PlayerState) {
        let past = Instant::now()
            .checked_sub(GEOMETRY_SYNC_MIN_INTERVAL * 2)
            .unwrap_or_else(Instant::now);
        state.geom.lock().unwrap().last_sync = past;
    }

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

    #[test]
    fn flush_with_no_pending_is_noop() {
        let state = PlayerState::new();
        state.trailing_scheduled.store(true, Ordering::Release);

        state.flush_pending_geometry();

        assert!(state.geom.lock().unwrap().pending_geometry.is_none());
        assert!(!state.trailing_scheduled.load(Ordering::Acquire));
        assert!(state.geom.lock().unwrap().last_geometry.is_none());
    }

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

    #[test]
    fn clear_minimize_snapshot_drops_leftover_inset_on_teardown() {
        let state = PlayerState::new();
        state.set_minimize(Some(MinimizeState {
            width: 959,
            height: 720,
            padding: 16,
            corner: MinimizeCorner::BottomLeft,
        })).unwrap();
        assert!(state.geom.lock().unwrap().minimize.is_some());

        let had = state.clear_minimize_snapshot();
        assert!(had, "snapshot should have been present before teardown");
        assert!(
            state.geom.lock().unwrap().minimize.is_none(),
            "minimize snapshot must be cleared so next session starts full"
        );

        assert!(!state.clear_minimize_snapshot());
        assert!(state.geom.lock().unwrap().minimize.is_none());
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
        assert!(state.geom.lock().unwrap().minimize.is_some());

        // Simulate what player_enter_popout does: clear minimize.
        state.set_minimize(None).unwrap();
        assert!(state.geom.lock().unwrap().minimize.is_none());
    }

    #[test]
    fn popout_enter_is_noop_on_minimize_when_already_none() {
        let state = PlayerState::new();
        assert!(state.geom.lock().unwrap().minimize.is_none());
        state.set_minimize(None).unwrap();
        assert!(state.geom.lock().unwrap().minimize.is_none());
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
        assert!(state.geom.lock().unwrap().minimize.is_none());

        // exit: consume stash
        let taken = state.pre_popout_geometry.lock().unwrap().take();
        assert_eq!(taken, Some((50, 50, 1920, 1080)));
        assert!(!state.is_in_popout());
        assert!(state.geom.lock().unwrap().minimize.is_none());
    }
}
