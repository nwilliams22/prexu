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
const GEOMETRY_SYNC_MIN_INTERVAL: Duration = Duration::from_millis(50);

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
    /// Saved (x, y, width, height) of the Tauri main window's outer rect
    /// before entering pop-out mode. Stashed by `player_enter_popout` and
    /// consumed by `player_exit_popout` to restore the previous geometry.
    /// `None` when not in pop-out mode.
    pub(crate) pre_popout_geometry: Mutex<Option<(i32, i32, u32, u32)>>,
    /// In-window minimize state: `(width, height, padding)` of the small
    /// player region anchored to the bottom-right corner of the main
    /// window's client area (prexu-7il.2). `None` when not minimized.
    ///
    /// Distinct from pop-out: pop-out shrinks the entire Tauri main
    /// window, minimize keeps the main window full size and only
    /// constrains the mpv host to a small inset region so the user can
    /// navigate the rest of the app underneath / around the video.
    /// `sync_geometry` and `apply_host_geometry` honor this when set —
    /// instead of placing the host at the full WebView client rect, they
    /// place it at the corresponding bottom-right inset.
    ///
    /// Corner is hard-coded to bottom-right in 7il.2; the four-corner
    /// anchor-drag picker lands in prexu-7il.7.
    pub(crate) minimize: Mutex<Option<(u32, u32, u32)>>,
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
            pre_popout_geometry: Mutex::new(None),
            minimize: Mutex::new(None),
        }
    }

    pub(crate) fn set_fullscreen_transition(&self, in_progress: bool) {
        self.fullscreen_transition
            .store(in_progress, Ordering::Release);
    }

    /// Transform a desired host geometry `(x, y, width, height)` — which
    /// normally matches the Tauri main window's inner (client) rect — to
    /// the bottom-right inset when minimize mode is active (prexu-7il.2).
    /// Pass-through when minimize is `None`.
    ///
    /// The inset stays anchored to the bottom-right corner of the client
    /// rect: when the user resizes the main window, the host re-snaps to
    /// the bottom-right on each Resized event, so the small video region
    /// always tracks the corner regardless of window size.
    #[cfg(target_os = "windows")]
    fn apply_minimize_inset(
        &self,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> (i32, i32, i32, i32) {
        if let Ok(mz) = self.minimize.lock() {
            if let Some((mw, mh, pad)) = *mz {
                let off_x = (width - mw as i32 - pad as i32).max(0);
                let off_y = (height - mh as i32 - pad as i32).max(0);
                return (x + off_x, y + off_y, mw as i32, mh as i32);
            }
        }
        (x, y, width, height)
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
    /// Note (prexu-34d): on app startup tao 0.34.x emits two warnings,
    ///   "NewEvents emitted without explicit RedrawEventsCleared"
    ///   "RedrawEventsCleared emitted without explicit MainEventsCleared"
    /// These originate in tao's event-loop runner, not our code — our
    /// run_on_main_thread dispatches and the WS_EX_NOACTIVATE host window are
    /// canonical. The warnings are upstream noise tied to WebView2 init
    /// timing and do not affect playback or geometry sync. Revisit on a tao
    /// version bump.
    pub(crate) fn ensure_init(&self, app: &AppHandle) -> Result<(), String> {
        log::info!("[player] ensure_init called");
        let mut guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        if guard.is_some() {
            log::debug!("[player] ensure_init: already initialized");
            return Ok(());
        }

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
                        let _ = host.set_geometry(
                            pos.x,
                            pos.y,
                            size.width as i32,
                            size.height as i32,
                        );
                        log::debug!("[player] initial geometry sync to ({},{},{}x{})", pos.x, pos.y, size.width, size.height);
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

        // prexu-ps1: marker for cold-start latency attribution. The gap
        // between this log and the first "FileLoaded" event below covers
        // (a) mpv handle construction, (b) demuxer opening the network
        // stream (cold plex.direct connect), and (c) hardware decoder
        // probing. Compare this timestamp with the next FileLoaded /
        // PlaybackRestart entries to see where the 12s cold-start window
        // lives.
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
        // Apply the CURRENT call's args, not any stored pending geometry
        // (prexu-ifj). Pending was previously consumed here as a "trailing-
        // edge guarantee", but that path silently overrode fresh args with
        // stale ones: when a user maximizes (throttled, pending=maximize)
        // and then restores (next call passes the throttle), the restored
        // geometry would be ignored in favour of the older maximize. We
        // still clear pending so it doesn't apply on a future call, but
        // the current args are always the freshest known geometry — every
        // Resized event triggers a new sync_geometry with the latest rect,
        // so the trailing-edge case is already covered by the next event.
        // Worst case: a drag that ends within the 50 ms throttle window
        // may miss the final ~50 ms of motion, which is imperceptible.
        if let Ok(mut pending) = self.pending_geometry.lock() {
            pending.take();
        }
        // Apply the minimize inset (prexu-7il.2). When not minimized this
        // is a pass-through, so non-minimize playback is unaffected.
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
        // Honor the minimize inset (prexu-7il.2). When not minimized this
        // is a pass-through, so the existing fullscreen + popout call
        // sites get the full client rect they pass in.
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

    /// Toggle the mpv host window's topmost flag. Used by pop-out mode
    /// enter/exit so the video itself floats above other apps the same way
    /// the WebView overlay does — without this the host stays in the
    /// regular z-order and other windows can render between the always-
    /// on-top WebView and the video.
    ///
    /// Re-anchors below `parent` whenever a parent is provided, on BOTH
    /// the topmost=true and topmost=false paths. This is critical on
    /// pop-out EXIT (prexu-0c6): SetWindowPos(HWND_NOTOPMOST) only drops
    /// the host below other topmost windows — it does NOT put it back
    /// below the WebView in the regular z-order group. Without the
    /// anchor_below(parent) here, after exit_popout the host floats above
    /// the WebView and steals all mouse events (cursor stuck as the host
    /// class's default arrow; app becomes uninteractable).
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
