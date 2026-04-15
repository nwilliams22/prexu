//! Native libmpv-backed player (Windows-first).

pub mod commands;
pub mod events;

use std::sync::{Arc, Mutex};

use libmpv2::Mpv;
use tauri::AppHandle;

/// Managed state container holding the mpv handle.
///
/// `Mpv` is created lazily on the first `ensure_init` call so app startup
/// stays fast and we don't open mpv unless the user actually plays something.
/// Wrapped in `Arc` so the event-pump thread can keep its own reference.
pub struct PlayerState {
    inner: Mutex<Option<Arc<Mpv>>>,
}

impl PlayerState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Lazily create the `Mpv` handle with our baseline config and start the
    /// event pump. Subsequent calls are no-ops.
    pub(crate) fn ensure_init(&self, app: &AppHandle) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        if guard.is_some() {
            return Ok(());
        }
        let mpv = Mpv::with_initializer(|init| {
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
        *guard = Some(mpv);
        Ok(())
    }

    /// Drop the `Mpv` handle. The event pump exits via `Event::Shutdown`
    /// when the underlying mpv context is destroyed.
    pub(crate) fn destroy(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        *guard = None;
        Ok(())
    }

    pub(crate) fn with_mpv<R>(
        &self,
        f: impl FnOnce(&Mpv) -> Result<R, libmpv2::Error>,
    ) -> Result<R, String> {
        let guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        let mpv = guard
            .as_ref()
            .ok_or_else(|| "mpv not initialised".to_string())?;
        f(mpv).map_err(|e| format!("mpv error: {:?}", e))
    }
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}
