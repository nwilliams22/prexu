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
        }
    }

    pub(crate) fn set_fullscreen_transition(&self, in_progress: bool) {
        self.fullscreen_transition
            .store(in_progress, Ordering::Release);
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

        let mpv = Mpv::with_initializer(|init| {
            #[cfg(target_os = "windows")]
            init.set_property("wid", wid)?;
            init.set_property("hwdec", "auto-safe")?;
            init.set_property("vo", "gpu-next")?;
            init.set_property("keep-open", "always")?;
            init.set_property("force-window", "no")?;
            init.set_property("volume-max", 200_i64)?;
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
    /// 2. Send `stop` (halt playback) then `quit` (fire Shutdown) to mpv.
    /// 3. Join the event-pump thread. It observes Shutdown, breaks its loop,
    ///    and drops its `Arc<Mpv>`.
    /// 4. Our `Arc<Mpv>` drops at end of scope with refcount 1→0, which runs
    ///    `mpv_terminate_destroy` synchronously (libmpv2 Drop impl).
    /// 5. `HostWindow` drops last, now that nothing is rendering into it.
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

        // Belt-and-suspenders: silence audio immediately, don't wait for
        // stop/quit to propagate through mpv's internals.
        match inner.mpv.set_property("mute", true) {
            Ok(_) => log::info!("[player] destroy: mute=true set"),
            Err(e) => log::warn!("[player] destroy: mute set failed: {:?}", e),
        }
        match inner.mpv.set_property("pause", true) {
            Ok(_) => log::info!("[player] destroy: pause=true set"),
            Err(e) => log::warn!("[player] destroy: pause set failed: {:?}", e),
        }

        log::info!("[player] destroy: sending stop command");
        match inner.mpv.command("stop", &[]) {
            Ok(_) => log::info!("[player] destroy: stop sent OK"),
            Err(e) => log::warn!("[player] destroy: stop failed: {:?}", e),
        }
        log::info!("[player] destroy: sending quit command");
        match inner.mpv.command("quit", &[]) {
            Ok(_) => log::info!("[player] destroy: quit sent OK"),
            Err(e) => log::warn!("[player] destroy: quit failed: {:?}", e),
        }

        // Bounded join: if the pump doesn't exit within 2s, give up and
        // let it leak — we'd rather have a zombie thread than a 20 s audio
        // bleed. The pump holds an Arc<Mpv>, so if we detach, mpv lives
        // until the pump's `wait_event` eventually times out and notices
        // the context is gone. In practice, terminate_destroy below will
        // be delayed, but the mute+pause+stop above should already have
        // silenced audio synchronously.
        if let Some(handle) = inner.event_pump.take() {
            log::info!("[player] destroy: joining event pump (timeout 2s)");
            let start = Instant::now();
            let (tx, rx) = std::sync::mpsc::channel::<()>();
            let join_thread = std::thread::spawn(move || {
                let _ = handle.join();
                let _ = tx.send(());
            });
            match rx.recv_timeout(Duration::from_secs(2)) {
                Ok(_) => log::info!(
                    "[player] destroy: event pump joined in {}ms",
                    start.elapsed().as_millis()
                ),
                Err(_) => log::warn!(
                    "[player] destroy: event pump did NOT exit within 2s — detaching; current Arc strong_count={}",
                    Arc::strong_count(&inner.mpv)
                ),
            }
            // Detach the joiner thread so we don't block on it further.
            drop(join_thread);
        }

        // Dispatch HostWindow drop to the main thread since that's where
        // it was created. Fire-and-forget — by the time this closure runs,
        // mpv_terminate_destroy has already halted rendering (below, when
        // `inner` drops the last Arc<Mpv>), so DestroyWindow on the HWND is
        // safe even if the drop happens asynchronously.
        #[cfg(target_os = "windows")]
        if let Some(host) = inner.host.take() {
            log::info!("[player] destroy: dispatching host drop to main thread");
            if let Err(e) = app.run_on_main_thread(move || {
                drop(host);
                log::info!("[player:host] dropped on main thread");
            }) {
                log::warn!("[player] destroy: run_on_main_thread for host drop failed: {:?} (host leaked)", e);
            }
        }

        log::info!(
            "[player] destroy: dropping Inner (Arc strong_count={}, elapsed {}ms)",
            Arc::strong_count(&inner.mpv),
            t0.elapsed().as_millis()
        );
        // `inner` drops at end of scope. If we still hold the last Arc,
        // mpv_terminate_destroy runs synchronously here.
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
        // Take pending geometry if one was stored (trailing-edge), or use
        // the current args (leading-edge).
        let (ax, ay, aw, ah) = if let Ok(mut pending) = self.pending_geometry.lock() {
            pending.take().unwrap_or((x, y, width, height))
        } else {
            (x, y, width, height)
        };
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
        if let Some(inner) = guard.as_ref() {
            if let Some(host) = inner.host.as_ref() {
                log::debug!(
                    "[player] apply_host_geometry force ({},{},{}x{})",
                    x, y, width, height
                );
                // Update last_geometry so the throttled sync_geometry doesn't
                // re-apply the same value right after this.
                if let Ok(mut lg) = self.last_geometry.lock() {
                    *lg = Some((x, y, width, height));
                }
                if let Err(e) = host.set_geometry(x, y, width, height) {
                    log::warn!("[player] apply_host_geometry failed: {}", e);
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
