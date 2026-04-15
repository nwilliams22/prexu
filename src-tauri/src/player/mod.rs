//! Native libmpv-backed player (Windows-first).
//!
//! Phase 1 step 1.3 — real `libmpv2::Mpv` handle, init+destroy. Other commands
//! still stub until step 1.4+.

pub mod commands;
pub mod events;

use std::sync::Mutex;

use libmpv2::Mpv;

/// Managed state container holding the mpv handle.
///
/// `Mpv` is created lazily on the first `ensure_init` call so app startup
/// stays fast and we don't open mpv unless the user actually plays something.
pub struct PlayerState {
    inner: Mutex<Option<Mpv>>,
}

impl PlayerState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Lazily create the `Mpv` handle with our baseline config. Subsequent
    /// calls are no-ops.
    pub(crate) fn ensure_init(&self) -> Result<(), String> {
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
        *guard = Some(mpv);
        Ok(())
    }

    /// Drop the `Mpv` handle. Safe to call when not initialised.
    pub(crate) fn destroy(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        *guard = None;
        Ok(())
    }

    #[allow(dead_code)] // used by future commands (1.4+)
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
