//! Native libmpv-backed player (Windows-first).

pub mod commands;
pub mod events;

#[cfg(target_os = "windows")]
pub mod host_window;

use std::sync::{Arc, Mutex};

use libmpv2::Mpv;
use tauri::{AppHandle, Manager};

/// Managed state container holding the mpv handle + (on Windows) the native
/// HWND that mpv renders into. Created lazily on the first `ensure_init`.
pub struct PlayerState {
    inner: Mutex<Option<Inner>>,
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
        }
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
            host_window::HostWindow::create(parent)?
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
    #[cfg(target_os = "windows")]
    pub(crate) fn sync_geometry(&self, x: i32, y: i32, width: i32, height: i32) {
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
