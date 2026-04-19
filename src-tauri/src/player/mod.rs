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
    /// Kept alive for the lifetime of the Mpv handle. Dropping it after Mpv
    /// is destroyed lets DestroyWindow run cleanly without mpv still
    /// rendering into the surface.
    #[cfg(target_os = "windows")]
    #[allow(dead_code)]
    host: host_window::HostWindow,
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

    /// Lazily create the host window + `Mpv` handle with our baseline config
    /// and start the event pump. Subsequent calls are no-ops.
    pub(crate) fn ensure_init(&self, app: &AppHandle) -> Result<(), String> {
        log::info!("[player] ensure_init called");
        let mut guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        if guard.is_some() {
            log::debug!("[player] ensure_init: already initialized");
            return Ok(());
        }

        // On Windows, create the native host window first so we can hand its
        // HWND to mpv as `wid` BEFORE mpv_initialize runs (mpv requires this
        // ordering). On other platforms we fall through to a windowless mpv
        // for now; cross-platform host windows arrive in phase 5.
        #[cfg(target_os = "windows")]
        let host = {
            let main = app
                .get_webview_window("main")
                .ok_or_else(|| "main webview window not found".to_string())?;
            let parent = main
                .hwnd()
                .map_err(|e| format!("Failed to get main HWND: {}", e))?;
            let host = host_window::HostWindow::create(parent)?;
            log::info!("[player:host] created, parent={:?}", parent.0);

            // Do an initial geometry sync so the host window covers the
            // current webview content area before becoming visible — avoids
            // a flash at the default 1280x720 placeholder rect.
            if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
                let _ = host.set_geometry(
                    pos.x,
                    pos.y,
                    size.width as i32,
                    size.height as i32,
                );
                log::debug!("[player] initial geometry sync to ({},{},{}x{})", pos.x, pos.y, size.width, size.height);
            }
            // Now make it visible — the on_window_event listener handles
            // subsequent move/resize/DPI updates.
            let _ = host.set_visible(true);
            log::debug!("[player:host] set visible");

            host
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
            host,
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
    pub(crate) fn destroy(&self) -> Result<(), String> {
        // Take Inner out up front. We must NOT hold the Mutex across the
        // thread join — that would deadlock anyone else waiting on it, and
        // a fresh `ensure_init` while destroy is in flight is allowed (it
        // just builds a new Inner into the now-empty slot).
        let inner = self
            .inner
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?
            .take();

        let Some(mut inner) = inner else {
            log::debug!("[player] destroy: nothing to destroy");
            return Ok(());
        };

        log::info!("[player] destroy: stopping playback");
        let _ = inner.mpv.command("stop", &[]);
        match inner.mpv.command("quit", &[]) {
            Ok(_) => log::info!("[player] destroy: quit sent OK"),
            Err(e) => log::warn!("[player] destroy: quit failed: {:?}", e),
        }

        if let Some(handle) = inner.event_pump.take() {
            match handle.join() {
                Ok(()) => log::info!("[player] destroy: event pump joined"),
                Err(_) => log::warn!("[player] destroy: event pump panicked"),
            }
        }

        // `inner` drops here: Arc<Mpv> refcount goes 1→0 →
        // mpv_terminate_destroy (sync); then HostWindow::drop →
        // DestroyWindow on an HWND mpv is no longer touching.
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
            log::debug!("[player] sync_geometry applied ({},{},{}x{})", ax, ay, aw, ah);
            if let Err(e) = inner.host.set_geometry(ax, ay, aw, ah) {
                log::warn!("[player] sync_geometry failed: {}", e);
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
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}
