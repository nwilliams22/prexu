//! Native libmpv-backed player (Windows-first).
//!
//! Phase 1 scaffold — holds the shape of the module. The actual libmpv FFI
//! is wired in a follow-up commit once the `libmpv2` crate is added and the
//! dev machine has `libmpv-dev` available.

pub mod commands;
pub mod events;

use std::sync::Mutex;

/// Managed state container holding the mpv handle + any shared resources.
/// Currently a placeholder; the real `libmpv2::Mpv` instance lands with the
/// FFI wiring commit.
pub struct PlayerState {
    inner: Mutex<PlayerInner>,
}

#[derive(Default)]
struct PlayerInner {
    initialized: bool,
}

impl PlayerState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(PlayerInner::default()),
        }
    }

    #[allow(dead_code)] // used once FFI lands
    pub(crate) fn mark_initialized(&self) -> Result<(), String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|e| format!("Lock poisoned: {}", e))?;
        guard.initialized = true;
        Ok(())
    }

    #[allow(dead_code)] // used once FFI lands
    pub(crate) fn is_initialized(&self) -> bool {
        self.inner
            .lock()
            .map(|g| g.initialized)
            .unwrap_or(false)
    }
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}
