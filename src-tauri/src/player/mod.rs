//! Native libmpv-backed player (Windows-first).

pub mod commands;
pub mod events;

#[cfg(target_os = "windows")]
pub mod host_window;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use libmpv2::Mpv;
use tauri::{AppHandle, Manager};

/// Minimum interval between consecutive sync_geometry calls. Drag-resize
/// fires WM_SIZE at the OS event rate (~60 Hz). Each sync_geometry runs
/// SetWindowPos which synchronously sends WM_WINDOWPOSCHANGING/CHANGED
/// down the chain plus WM_SIZE to mpv's child window, where mpv rebuilds
/// its D3D11 swapchain. At 60 Hz the Tauri main thread can't service the
/// message queue between calls and the app hard-freezes (mpv's own
/// threads keep playing audio/video, but UI input + paint stop).
/// 20 Hz is smooth enough visually and gives mpv 50 ms to settle between
/// swapchain rebuilds (empirically safe on Win11 with gpu-next + D3D11).
pub(crate) const GEOMETRY_SYNC_MIN_INTERVAL: Duration = Duration::from_millis(50);

/// Managed state container holding the mpv handle + (on Windows) the native
/// HWND that mpv renders into. Created lazily on the first `ensure_init`.
pub struct PlayerState {
    inner: Mutex<Option<Inner>>,
    /// True while a fullscreen toggle is in flight. The window-event
    /// listener fires Resized many times during Tauri's animated transition;
    /// each one triggers SetWindowPos on the host, which makes mpv's
    /// gpu-next vo rebuild its D3D11 swapchain. Doing that ~10 times within
    /// 300 ms reliably crashes the mpv render thread, so we suppress
    /// sync_geometry while this flag is set and do one explicit sync after
    /// the transition settles.
    fullscreen_transition: AtomicBool,
    /// Last time sync_geometry actually ran. Leading-edge throttle — see
    /// `GEOMETRY_SYNC_MIN_INTERVAL`. Mutex contention is negligible (only
    /// the main thread reads/writes).
    last_sync: Mutex<Instant>,
    /// (x, y, w, h) of the last sync we actually applied. Lets us skip the
    /// SetWindowPos call when called with identical args — common during
    /// drag where position changes but size stays put, or vice versa.
    pub(crate) last_geometry: Mutex<Option<(i32, i32, i32, i32)>>,
    /// Trailing-edge pending geometry. When a sync is throttled, the most
    /// recent requested geometry is stored here. The next event that passes
    /// the throttle check will apply it, ensuring the final drag position is
    /// never lost.
    pending_geometry: Mutex<Option<(i32, i32, i32, i32)>>,
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
    /// In-window minimize state: the size+corner of the small player
    /// region anchored inside the main window's client area.
    /// `None` when not minimized.
    ///
    /// Distinct from pop-out: pop-out shrinks the entire Tauri main
    /// window, minimize keeps the main window full size and only
    /// constrains the mpv host to a small inset region so the user can
    /// navigate the rest of the app underneath / around the video.
    /// `sync_geometry` and `apply_host_geometry` honor this when set —
    /// instead of placing the host at the full WebView client rect, they
    /// place it at the inset corresponding to `corner`.
    pub(crate) minimize: Mutex<Option<MinimizeState>>,
    /// Last observed DPI scale factor of the main window. Used by
    /// `apply_minimize_inset` to convert the logical-px `MinimizeState`
    /// into physical-px host geometry on every sync.
    ///
    /// Updated from two places:
    /// 1. `player_enter_minimize` — when the user enters minimize mode,
    ///    so the initial conversion uses the live scale of the monitor
    ///    the main window currently lives on.
    /// 2. `WindowEvent::ScaleFactorChanged` — when the main window crosses
    ///    a DPI boundary (e.g. 100% → 125% monitor). The handler stores
    ///    the new scale BEFORE calling `sync_geometry`, so the very next
    ///    host placement uses the new scale and the mini region remains
    ///    visually correct at its anchor corner.
    pub(crate) scale_factor: Mutex<f64>,
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
/// `PlayerState::minimize` so `apply_minimize_inset` can produce the
/// correct host geometry on every Resized event.
///
/// Width / height / padding are CSS (logical) pixels, matching what the
/// React side sends across the IPC. The conversion to physical pixels
/// happens lazily inside `apply_minimize_inset` against the latest
/// `PlayerState::scale_factor` — this lets cross-monitor DPI changes
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
            fullscreen_transition: AtomicBool::new(false),
            // Initial value is `now` so the very first sync passes through
            // immediately (Instant arithmetic is monotonic).
            last_sync: Mutex::new(
                Instant::now()
                    .checked_sub(GEOMETRY_SYNC_MIN_INTERVAL)
                    .unwrap_or_else(Instant::now),
            ),
            last_geometry: Mutex::new(None),
            pending_geometry: Mutex::new(None),
            trailing_scheduled: AtomicBool::new(false),
            pre_popout_geometry: Mutex::new(None),
            minimize: Mutex::new(None),
            // 1.0 is the safe default — single-monitor 100% DPI. The very
            // first `player_enter_minimize` overwrites this with the real
            // scale before applying the inset; `WindowEvent::ScaleFactorChanged`
            // keeps it fresh thereafter.
            scale_factor: Mutex::new(1.0),
        }
    }

    /// Update the stored DPI scale factor. Called from the
    /// `ScaleFactorChanged` window-event handler and from
    /// `player_enter_minimize` so `apply_minimize_inset` always converts
    /// the logical-px `MinimizeState` against the live scale.
    #[cfg(target_os = "windows")]
    pub(crate) fn set_scale_factor(&self, scale: f64) {
        if let Ok(mut sf) = self.scale_factor.lock() {
            if (*sf - scale).abs() > f64::EPSILON {
                log::info!(
                    "[player:host] scale factor {:.3} → {:.3}",
                    *sf,
                    scale
                );
                *sf = scale;
            }
        }
    }

    /// Read the stored DPI scale factor. Defaults to 1.0 if the mutex is
    /// poisoned (which should never happen in practice — we only ever
    /// hold this lock for the duration of a read or single write).
    #[cfg(target_os = "windows")]
    pub(crate) fn current_scale_factor(&self) -> f64 {
        self.scale_factor.lock().map(|sf| *sf).unwrap_or(1.0)
    }

    pub(crate) fn set_fullscreen_transition(&self, in_progress: bool) {
        self.fullscreen_transition
            .store(in_progress, Ordering::Release);
    }

    /// Transform a desired host geometry `(x, y, width, height)` — which
    /// normally matches the Tauri main window's inner (client) rect — to
    /// the corner-anchored inset when minimize mode is active.
    /// Pass-through when minimize is `None`.
    ///
    /// The inset stays anchored to `MinimizeState::corner` of the client
    /// rect: when the user resizes the main window, the host re-snaps to
    /// the chosen corner on each Resized event, so the small video region
    /// always tracks the corner regardless of window size.
    ///
    /// `MinimizeState` is stored in CSS (logical) pixels — width / height /
    /// padding are multiplied here by `current_scale_factor()` so the host
    /// rect is always sized against the live DPI of whichever monitor the
    /// main window currently lives on. This is what makes cross-monitor
    /// DPI changes (`WindowEvent::ScaleFactorChanged`) Just Work — the
    /// handler refreshes the stored scale before calling `sync_geometry`.
    #[cfg(target_os = "windows")]
    fn apply_minimize_inset(
        &self,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> (i32, i32, i32, i32) {
        let snapshot = self.minimize.lock().ok().and_then(|g| *g);
        let Some(state) = snapshot else {
            return (x, y, width, height);
        };
        let scale = self.current_scale_factor();
        compute_minimize_inset(state, scale, x, y, width, height)
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
        let mut guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        if guard.is_some() {
            log::debug!("[player] ensure_init: already initialized");
            return Ok(());
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
            let snap = self.minimize.lock().ok().and_then(|g| *g);
            (snap, self.current_scale_factor())
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
            Ok(())
        })
        .map_err(|e| format!("mpv init failed: {:?}", e))?;
        log::info!("[player] mpv created with wid={}", wid);

        let mpv = Arc::new(mpv);
        let event_pump = events::spawn_event_pump(Arc::clone(&mpv), app.clone())?;
        log::info!("[player] event pump spawned, init complete");

        *guard = Some(Inner {
            mpv,
            event_pump: Some(event_pump),
            #[cfg(target_os = "windows")]
            host: Some(host),
        });
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

    /// Resize/move the host window to match the Tauri main window's content
    /// area. No-op when the player hasn't been initialised yet — the
    /// listener fires from app startup, before any playback.
    ///
    /// Skipped while a fullscreen transition is in progress and
    /// throttled to ~20 Hz on the regular path. When throttled, the
    /// geometry is stored as pending and applied on the next event that
    /// passes the throttle check (trailing-edge guarantee).
    #[cfg(target_os = "windows")]
    pub(crate) fn sync_geometry(&self, x: i32, y: i32, width: i32, height: i32) {
        log::trace!("[player] sync_geometry({},{},{}x{})", x, y, width, height);
        if self.fullscreen_transition.load(Ordering::Acquire) {
            log::trace!("[player] sync_geometry suppressed — fullscreen transition");
            return;
        }
        {
            let now = Instant::now();
            let Ok(mut last) = self.last_sync.lock() else {
                return;
            };
            if now.duration_since(*last) < GEOMETRY_SYNC_MIN_INTERVAL {
                // Throttled — store as pending so trailing edge is never lost.
                if let Ok(mut pending) = self.pending_geometry.lock() {
                    *pending = Some((x, y, width, height));
                }
                log::trace!("[player] sync_geometry throttled, pending stored");
                return;
            }
            *last = now;
        }
        // Apply the CURRENT call's args, not any stored pending geometry.
        // Pending is cleared so it doesn't apply on a future call, but
        // the current args are always the freshest known geometry — every
        // Resized event triggers a new sync_geometry with the latest rect,
        // so the trailing-edge case is already covered by the next event.
        // Worst case: a drag that ends within the 50 ms throttle window
        // may miss the final ~50 ms of motion, which is imperceptible.
        if let Ok(mut pending) = self.pending_geometry.lock() {
            pending.take();
        }
        // Apply the minimize inset. When not minimized this is a
        // pass-through, so non-minimize playback is unaffected.
        let (ax, ay, aw, ah) = self.apply_minimize_inset(x, y, width, height);
        // Skip if geometry hasn't changed since last apply.
        let new = (ax, ay, aw, ah);
        if let Ok(mut last_geom) = self.last_geometry.lock() {
            if *last_geom == Some(new) {
                log::trace!("[player] sync_geometry dedup skip");
                return;
            }
            *last_geom = Some(new);
        }
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
            .pending_geometry
            .lock()
            .ok()
            .and_then(|mut p| p.take());
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

    /// Apply host geometry directly, bypassing the fullscreen-transition
    /// suppression flag and the throttle. Used from inside the fullscreen
    /// command's main-thread closure to resize the host *immediately* after
    /// Tauri toggles fullscreen, so the video catches up with the overlay
    /// within a frame instead of waiting the full 350 ms transition delay.
    /// The throttle and flag still apply to the normal on_window_event
    /// path — this is a one-off forced apply.
    #[cfg(target_os = "windows")]
    pub(crate) fn apply_host_geometry(&self, x: i32, y: i32, width: i32, height: i32) {
        let Ok(guard) = self.inner.lock() else {
            return;
        };
        // Honor the minimize inset. When not minimized this is a
        // pass-through, so fullscreen + popout call sites get the full
        // client rect they pass in.
        let (ax, ay, aw, ah) = self.apply_minimize_inset(x, y, width, height);
        if let Some(inner) = guard.as_ref() {
            if let Some(host) = inner.host.as_ref() {
                log::debug!(
                    "[player] apply_host_geometry force ({},{},{}x{})",
                    ax, ay, aw, ah
                );
                // Update last_geometry so the throttled sync_geometry doesn't
                // re-apply the same value right after this.
                if let Ok(mut lg) = self.last_geometry.lock() {
                    *lg = Some((ax, ay, aw, ah));
                }
                if let Err(e) = host.set_geometry(ax, ay, aw, ah) {
                    log::warn!("[player] apply_host_geometry failed: {}", e);
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
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Pure helper: compute the corner-anchored physical-px inset for the mpv
/// host given a logical-px `MinimizeState`, a DPI scale factor, and the
/// physical-px Tauri inner rect.
///
/// Extracted from `PlayerState::apply_minimize_inset` so it can be unit
/// tested without spinning up a real `PlayerState` + Win32 host window.
/// Returns the host `(x, y, w, h)` in physical pixels.
#[cfg(target_os = "windows")]
pub(crate) fn compute_minimize_inset(
    state: MinimizeState,
    scale: f64,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> (i32, i32, i32, i32) {
    // Round the logical → physical conversion to the nearest pixel. Using
    // floor or ceil would drift cumulatively across DPI changes; round
    // gives the same value coming back from a logical → physical → logical
    // round-trip (within ±0.5 px per dimension).
    let mw = ((state.width as f64) * scale).round() as i32;
    let mh = ((state.height as f64) * scale).round() as i32;
    let pad = ((state.padding as f64) * scale).round() as i32;
    // Right-anchored corners: offset is `clientWidth - miniWidth
    // - padding` so the inset hugs the right edge with `pad`
    // pixels of gutter. Left-anchored: simply `pad` from x.
    // Same vertical math for top/bottom. The .max(0) clamps
    // protect against pathological cases where the client
    // rect is narrower than the requested inset (e.g. user
    // shrinks the window below the mini width); the inset
    // collapses to the top-left of the client area rather
    // than producing negative offsets that would put the
    // host off-screen.
    let off_x = match state.corner {
        MinimizeCorner::TopLeft | MinimizeCorner::BottomLeft => pad,
        MinimizeCorner::TopRight | MinimizeCorner::BottomRight => {
            (width - mw - pad).max(0)
        }
    };
    let off_y = match state.corner {
        MinimizeCorner::TopLeft | MinimizeCorner::TopRight => pad,
        MinimizeCorner::BottomLeft | MinimizeCorner::BottomRight => {
            (height - mh - pad).max(0)
        }
    };
    (x + off_x, y + off_y, mw, mh)
}

/// Pure helper: initial host geometry for `ensure_init`. Returns the
/// mini-inset rect when a `MinimizeState` snapshot is present, otherwise
/// passes the full client rect through. Pre-snapshotting + this helper
/// let the (Send + 'static) `run_on_main_thread` closure produce the
/// correct first-frame geometry without capturing `&self`.
///
/// Why this matters (prexu-may): when an in-mini autoplay handoff calls
/// `unload` → `load_url`, `ensure_init` builds a fresh host_window + mpv.
/// If the host were sized to the full WebView rect on its first
/// `set_geometry`, mpv's vo would lock its D3D11 swapchain to that rect.
/// The subsequent `sync_geometry` shrink to the mini inset rebuilds the
/// HWND but leaves mpv rendering against the stale full-rect viewport,
/// producing the black/clipped frame the bug reports.
#[cfg(target_os = "windows")]
pub(crate) fn initial_host_geometry(
    snapshot: Option<MinimizeState>,
    scale: f64,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> (i32, i32, i32, i32) {
    match snapshot {
        Some(state) => compute_minimize_inset(state, scale, x, y, width, height),
        None => (x, y, width, height),
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

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
    //
    // `ensure_init` must size the host to the mini inset on its FIRST
    // set_geometry when an autoplay handoff lands during in-mini playback.
    // Otherwise mpv's vo locks its swapchain to a full-rect host and the
    // subsequent shrink leaves the first frame black/clipped.

    #[test]
    fn initial_host_geometry_passthrough_when_no_minimize() {
        // None snapshot → full client rect passes through untouched.
        let (x, y, w, h) =
            initial_host_geometry(None, 1.0, 100, 50, 1920, 1080);
        assert_eq!((x, y, w, h), (100, 50, 1920, 1080));
    }

    #[test]
    fn initial_host_geometry_applies_inset_when_minimize_present() {
        // Some snapshot → result matches compute_minimize_inset for the
        // same args, so the first host frame is the mini rect not the
        // full WebView rect.
        let snap = Some(DEFAULT);
        let got = initial_host_geometry(snap, 1.0, 0, 0, 1920, 1080);
        let expected = compute_minimize_inset(DEFAULT, 1.0, 0, 0, 1920, 1080);
        assert_eq!(got, expected);
        assert_eq!(got, (1544, 864, 360, 200));
    }

    #[test]
    fn initial_host_geometry_inset_respects_dpi_scale() {
        // 1.25× DPI snapshot → inset is scaled, not the logical-px values.
        let (_, _, w, h) =
            initial_host_geometry(Some(DEFAULT), 1.25, 0, 0, 2400, 1350);
        assert_eq!((w, h), (450, 250));
    }

    // ---- Trailing-edge geometry flush (prexu-hhx) ----------------------
    //
    // PlayerState::sync_geometry / flush_pending_geometry are exercised
    // here without an initialised mpv host: `inner` stays `None`, so the
    // SetWindowPos branch is skipped and we only assert on the throttle/
    // pending state machine. That is exactly the surface area being
    // changed in prexu-hhx; the host-side application of the geometry is
    // covered by the existing manual-test plan.

    /// Force the throttle clock far enough in the past that the next
    /// `sync_geometry` call is guaranteed to pass the throttle gate. Used
    /// in tests where we want to simulate "throttle window has elapsed"
    /// without actually sleeping.
    fn release_throttle(state: &PlayerState) {
        let past = Instant::now()
            .checked_sub(GEOMETRY_SYNC_MIN_INTERVAL * 2)
            .unwrap_or_else(Instant::now);
        *state.last_sync.lock().unwrap() = past;
    }

    #[test]
    fn throttled_sync_geometry_stores_pending() {
        let state = PlayerState::new();
        // First call passes the throttle (new() sets last_sync to
        // now - interval) and resets the clock to now.
        state.sync_geometry(0, 0, 1920, 1080);
        assert!(state.pending_geometry.lock().unwrap().is_none());
        // Second call immediately after is throttled → stored as pending.
        state.sync_geometry(10, 20, 800, 600);
        assert_eq!(
            *state.pending_geometry.lock().unwrap(),
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
        // Only the most recent geometry survives — last writer wins.
        assert_eq!(
            *state.pending_geometry.lock().unwrap(),
            Some((3, 3, 300, 300))
        );
    }

    #[test]
    fn flush_consumes_pending_geometry() {
        let state = PlayerState::new();
        state.sync_geometry(0, 0, 1920, 1080); // passes throttle
        state.sync_geometry(50, 60, 400, 300); // throttled → pending
        assert_eq!(
            *state.pending_geometry.lock().unwrap(),
            Some((50, 60, 400, 300))
        );
        // Simulate the throttle window having elapsed (what the worker
        // thread does by sleeping GEOMETRY_SYNC_MIN_INTERVAL before
        // dispatching this call to the main thread).
        release_throttle(&state);
        state.trailing_scheduled
            .store(true, Ordering::Release);

        state.flush_pending_geometry();

        // After flush: pending taken, trailing_scheduled cleared, and the
        // (50,60,400,300) geometry made it all the way through
        // sync_geometry's apply path so last_geometry now reflects it.
        assert!(state.pending_geometry.lock().unwrap().is_none());
        assert!(!state.trailing_scheduled.load(Ordering::Acquire));
        assert_eq!(
            *state.last_geometry.lock().unwrap(),
            Some((50, 60, 400, 300))
        );
    }

    #[test]
    fn flush_with_no_pending_is_noop() {
        let state = PlayerState::new();
        // Pretend a worker is scheduled but nothing was ever throttled
        // (e.g. all events naturally spaced > 50ms apart). The flush
        // should silently clear the flag and not touch last_geometry.
        state.trailing_scheduled
            .store(true, Ordering::Release);

        state.flush_pending_geometry();

        assert!(state.pending_geometry.lock().unwrap().is_none());
        assert!(!state.trailing_scheduled.load(Ordering::Acquire));
        assert!(state.last_geometry.lock().unwrap().is_none());
    }

    #[test]
    fn claim_trailing_schedule_is_one_shot_until_flushed() {
        let state = PlayerState::new();
        // First claimer wins.
        assert!(state.claim_trailing_schedule());
        // Subsequent claims lose while the flag is set.
        assert!(!state.claim_trailing_schedule());
        assert!(!state.claim_trailing_schedule());
        // Flush clears the flag → next claim wins again.
        state.flush_pending_geometry();
        assert!(state.claim_trailing_schedule());
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
        // Unknown string is a hard error, not a silent fallback.
        assert!(serde_json::from_str::<MinimizeCorner>(r#""diagonal""#).is_err());
    }
}
