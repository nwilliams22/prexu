//! Native libmpv-backed player (Windows-first).

pub mod commands;
pub mod events;

#[cfg(target_os = "windows")]
pub mod host_window;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use libmpv2::Mpv;
use tauri::{AppHandle, Manager};

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
}

struct Inner {
    mpv: Arc<Mpv>,
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
        }
    }

    pub(crate) fn set_fullscreen_transition(&self, in_progress: bool) {
        self.fullscreen_transition
            .store(in_progress, Ordering::Release);
    }

    /// Lazily create the host window + `Mpv` handle with our baseline config
    /// and start the event pump. Subsequent calls are no-ops.
    pub(crate) fn ensure_init(&self, app: &AppHandle) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        if guard.is_some() {
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
            }
            // Now make it visible — the on_window_event listener handles
            // subsequent move/resize/DPI updates.
            let _ = host.set_visible(true);

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

        let mpv = Arc::new(mpv);
        events::spawn_event_pump(Arc::clone(&mpv), app.clone())?;

        *guard = Some(Inner {
            mpv,
            #[cfg(target_os = "windows")]
            host,
        });
        Ok(())
    }

    /// Drop the `Mpv` handle (and host window on Windows). The event pump
    /// exits via `Event::Shutdown` when the underlying mpv context is
    /// destroyed.
    pub(crate) fn destroy(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        *guard = None;
        Ok(())
    }

    /// Resize/move the host window to match the Tauri main window's content
    /// area. No-op when the player hasn't been initialised yet — the
    /// listener fires from app startup, before any playback.
    ///
    /// Skipped while a fullscreen transition is in progress (see
    /// `fullscreen_transition` doc comment for the rationale). The Tauri
    /// command that drives fullscreen does one explicit sync after the
    /// transition completes.
    #[cfg(target_os = "windows")]
    pub(crate) fn sync_geometry(&self, x: i32, y: i32, width: i32, height: i32) {
        if self.fullscreen_transition.load(Ordering::Acquire) {
            return;
        }
        let Ok(guard) = self.inner.lock() else { return };
        if let Some(inner) = guard.as_ref() {
            if let Err(e) = inner.host.set_geometry(x, y, width, height) {
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
