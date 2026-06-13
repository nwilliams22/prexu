//! Geometry throttle, inset computation, and per-frame sync state.
//!
//! [`GeomState`] bundles the five geometry-related fields that were previously
//! separate `Mutex`es on [`super::PlayerState`]:
//!
//! - `last_sync`        — throttle clock (leading-edge 33 ms gate)
//! - `last_geometry`    — dedup cache: the last `(x,y,w,h)` we actually applied
//! - `pending_geometry` — trailing-edge stash for throttled events
//! - `minimize`         — optional mini-inset parameters (logical px)
//! - `scale_factor`     — DPI multiplier for logical→physical conversion
//!
//! By holding all five under **one** `Mutex<GeomState>`, the geometry hot
//! path requires exactly one lock acquisition per event, eliminating the
//! six-way lock-order hazard that existed when each field was locked
//! separately.  The only `try_lock` left in `mod.rs` is on `inner` (the mpv
//! handle), which guards against Win32 re-entrancy on `SetWindowPos` — that
//! lock has nothing to do with geometry state and is intentionally kept
//! separate.

use std::time::Instant;

use super::{MinimizeCorner, MinimizeState, GEOMETRY_SYNC_MIN_INTERVAL};

/// All geometry-throttle state bundled behind a single mutex.
///
/// Acquired once per `sync_geometry` / `sync_geometry_move` call;
/// the lock is dropped before `inner.try_lock()` calls `SetWindowPos`.
#[derive(Debug)]
pub(crate) struct GeomState {
    /// Instant of the last sync that actually ran (leading-edge throttle).
    /// Initialised to `now − GEOMETRY_SYNC_MIN_INTERVAL` so the very first
    /// event passes through without an extra sleep.
    pub(crate) last_sync: Instant,
    /// `(x, y, w, h)` in physical pixels of the last geometry we applied.
    /// `None` before any geometry has been applied.  Used to deduplicate
    /// identical back-to-back calls.
    pub(crate) last_geometry: Option<(i32, i32, i32, i32)>,
    /// Geometry stored by a throttled call so the trailing edge is never
    /// lost.  Consumed by `flush_pending_geometry` (or cleared by the next
    /// call that passes the throttle).
    pub(crate) pending_geometry: Option<(i32, i32, i32, i32)>,
    /// In-window minimize state in logical pixels.  `None` when not in
    /// minimize mode.  Applied by `apply_minimize_inset_inner` on every
    /// event.
    pub(crate) minimize: Option<MinimizeState>,
    /// DPI scale factor of the main window.  Updated from
    /// `ScaleFactorChanged` and `player_enter_minimize`.
    pub(crate) scale_factor: f64,
}

impl GeomState {
    pub(crate) fn new() -> Self {
        Self {
            last_sync: Instant::now()
                .checked_sub(GEOMETRY_SYNC_MIN_INTERVAL)
                .unwrap_or_else(Instant::now),
            last_geometry: None,
            pending_geometry: None,
            minimize: None,
            scale_factor: 1.0,
        }
    }
}

// ── Pure throttle decision ───────────────────────────────────────────────────

/// Returns `true` when the geometry sync should be THROTTLED (i.e. the
/// minimum interval has NOT elapsed since `last_sync`).
///
/// Pure function: no side-effects, fully unit-testable without a
/// `PlayerState`.
#[inline]
pub(crate) fn should_throttle(last_sync: Instant, now: Instant) -> bool {
    now.duration_since(last_sync) < GEOMETRY_SYNC_MIN_INTERVAL
}

// ── Minimize-inset math ──────────────────────────────────────────────────────

/// Apply the minimize inset inside an already-acquired `GeomState`.
///
/// Pass-through when `geom.minimize` is `None`.
#[cfg(target_os = "windows")]
pub(crate) fn apply_minimize_inset_inner(
    geom: &GeomState,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> (i32, i32, i32, i32) {
    match geom.minimize {
        Some(state) => super::compute_minimize_inset(state, geom.scale_factor, x, y, width, height),
        None => (x, y, width, height),
    }
}

// ── Pure geometry helpers ────────────────────────────────────────────────────

/// Pure helper: compute the corner-anchored physical-px inset for the mpv
/// host given a logical-px `MinimizeState`, a DPI scale factor, and the
/// physical-px Tauri inner rect.
///
/// Extracted so it can be unit tested without spinning up a real
/// `PlayerState` + Win32 host window.  Returns the host `(x, y, w, h)` in
/// physical pixels.
#[cfg(target_os = "windows")]
pub(crate) fn compute_minimize_inset(
    state: MinimizeState,
    scale: f64,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> (i32, i32, i32, i32) {
    let mw = ((state.width as f64) * scale).round() as i32;
    let mh = ((state.height as f64) * scale).round() as i32;
    let pad = ((state.padding as f64) * scale).round() as i32;
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

/// Pure helper: initial host geometry for `ensure_init`.  Returns the
/// mini-inset rect when a `MinimizeState` snapshot is present, otherwise
/// passes the full client rect through.
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

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    // ── Throttle pure function ───────────────────────────────────────────

    #[test]
    fn throttle_returns_true_when_interval_not_elapsed() {
        // last_sync = now → duration_since is ~0, well under the minimum.
        let last = Instant::now();
        let now = last; // same instant
        assert!(should_throttle(last, now));
    }

    #[test]
    fn throttle_returns_false_when_interval_elapsed() {
        // Simulate last_sync being further in the past than the minimum.
        let past = Instant::now()
            .checked_sub(GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1))
            .expect("checked_sub should succeed in tests");
        let now = Instant::now();
        assert!(!should_throttle(past, now));
    }

    #[test]
    fn throttle_returns_false_at_exact_boundary() {
        // Exactly at the boundary: duration_since == GEOMETRY_SYNC_MIN_INTERVAL.
        // `<` in `should_throttle` means this is NOT throttled.
        let past = Instant::now()
            .checked_sub(GEOMETRY_SYNC_MIN_INTERVAL)
            .expect("checked_sub should succeed");
        // Add a tiny epsilon so now is slightly after past + interval.
        let now = past + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_nanos(1);
        assert!(!should_throttle(past, now));
    }

    #[test]
    fn throttle_returns_true_just_inside_interval() {
        let past = Instant::now()
            .checked_sub(GEOMETRY_SYNC_MIN_INTERVAL - Duration::from_millis(1))
            .expect("checked_sub should succeed");
        let now = Instant::now();
        assert!(should_throttle(past, now));
    }

    // ── GeomState initialisation ─────────────────────────────────────────

    #[test]
    fn geom_state_new_passes_first_throttle_check() {
        // `new()` sets last_sync to now − interval, so the first sync
        // should always pass the throttle gate.
        let geom = GeomState::new();
        let now = Instant::now();
        assert!(!should_throttle(geom.last_sync, now));
    }

    #[test]
    fn geom_state_new_has_no_pending_or_last_geometry() {
        let geom = GeomState::new();
        assert!(geom.last_geometry.is_none());
        assert!(geom.pending_geometry.is_none());
        assert!(geom.minimize.is_none());
        assert!((geom.scale_factor - 1.0).abs() < f64::EPSILON);
    }

    // ── Minimize-inset math (Windows) ────────────────────────────────────

    #[cfg(target_os = "windows")]
    const DEFAULT: MinimizeState = MinimizeState {
        width: 360,
        height: 200,
        padding: 16,
        corner: MinimizeCorner::BottomRight,
    };

    #[cfg(target_os = "windows")]
    #[test]
    fn inset_at_scale_1_matches_legacy_physical_math() {
        let (x, y, w, h) = compute_minimize_inset(DEFAULT, 1.0, 0, 0, 1920, 1080);
        assert_eq!((x, y, w, h), (1544, 864, 360, 200));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn inset_rescales_at_125_pct_dpi() {
        let (x, y, w, h) = compute_minimize_inset(DEFAULT, 1.25, 0, 0, 2400, 1350);
        assert_eq!((x, y, w, h), (1930, 1080, 450, 250));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn inset_top_left_corner() {
        let state = MinimizeState {
            corner: MinimizeCorner::TopLeft,
            ..DEFAULT
        };
        let (x, y, w, h) = compute_minimize_inset(state, 1.0, 100, 50, 1920, 1080);
        assert_eq!((x, y, w, h), (116, 66, 360, 200));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn inset_bottom_left_corner() {
        let state = MinimizeState {
            corner: MinimizeCorner::BottomLeft,
            ..DEFAULT
        };
        let (x, y, w, h) = compute_minimize_inset(state, 1.0, 0, 0, 1920, 1080);
        // x = pad=16, y = 1080 - 200 - 16 = 864
        assert_eq!((x, y, w, h), (16, 864, 360, 200));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn inset_top_right_corner() {
        let state = MinimizeState {
            corner: MinimizeCorner::TopRight,
            ..DEFAULT
        };
        let (x, y, w, h) = compute_minimize_inset(state, 1.0, 0, 0, 1920, 1080);
        // x = 1920 - 360 - 16 = 1544, y = pad = 16
        assert_eq!((x, y, w, h), (1544, 16, 360, 200));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn inset_clamps_when_client_smaller_than_mini() {
        let (x, y, _w, _h) = compute_minimize_inset(DEFAULT, 1.0, 0, 0, 100, 100);
        assert_eq!((x, y), (0, 0));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn apply_minimize_inset_inner_passthrough_when_none() {
        let geom = GeomState::new(); // minimize = None
        let result = apply_minimize_inset_inner(&geom, 10, 20, 1920, 1080);
        assert_eq!(result, (10, 20, 1920, 1080));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn apply_minimize_inset_inner_applies_when_set() {
        let mut geom = GeomState::new();
        geom.minimize = Some(DEFAULT);
        geom.scale_factor = 1.0;
        let result = apply_minimize_inset_inner(&geom, 0, 0, 1920, 1080);
        let expected = compute_minimize_inset(DEFAULT, 1.0, 0, 0, 1920, 1080);
        assert_eq!(result, expected);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn initial_host_geometry_passthrough_when_no_minimize() {
        let (x, y, w, h) = initial_host_geometry(None, 1.0, 100, 50, 1920, 1080);
        assert_eq!((x, y, w, h), (100, 50, 1920, 1080));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn initial_host_geometry_applies_inset_when_present() {
        let snap = Some(DEFAULT);
        let got = initial_host_geometry(snap, 1.0, 0, 0, 1920, 1080);
        let expected = compute_minimize_inset(DEFAULT, 1.0, 0, 0, 1920, 1080);
        assert_eq!(got, expected);
        assert_eq!(got, (1544, 864, 360, 200));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn initial_host_geometry_inset_respects_dpi_scale() {
        let (_, _, w, h) = initial_host_geometry(Some(DEFAULT), 1.25, 0, 0, 2400, 1350);
        assert_eq!((w, h), (450, 250));
    }
}
