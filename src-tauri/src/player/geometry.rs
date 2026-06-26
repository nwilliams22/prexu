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

// ── Pure sync planning ─────────────────────────────────────────────────────

/// What `sync_geometry` should do after consulting `GeomState`. Computed
/// while holding the `geom` lock; the caller drops the lock BEFORE acting
/// on `Apply` (the freeze-critical invariant — the host `SetWindowPos`
/// must never run while `geom` is held).
#[cfg(target_os = "windows")]
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum SyncPlan {
    /// Minimum interval has not elapsed; args stashed in `pending_geometry`.
    Throttled,
    /// Resolved rect equals `last_geometry`; nothing to apply.
    Deduped,
    /// Apply this physical-px rect via `host.set_geometry`.
    Apply(i32, i32, i32, i32),
}

/// Pure decision half of `PlayerState::sync_geometry`. Mutates `GeomState`
/// (`last_sync` / `pending_geometry` / `last_geometry`) exactly as the
/// production path does and returns the resulting [`SyncPlan`].
#[cfg(target_os = "windows")]
pub(crate) fn plan_sync(
    g: &mut GeomState,
    now: Instant,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> SyncPlan {
    if should_throttle(g.last_sync, now) {
        // Throttled — store as pending so the trailing edge is never lost.
        g.pending_geometry = Some((x, y, width, height));
        return SyncPlan::Throttled;
    }
    g.last_sync = now;
    // The current args are the freshest geometry; clear any stale pending.
    g.pending_geometry = None;
    let (ax, ay, aw, ah) = apply_minimize_inset_inner(g, x, y, width, height);
    let new = (ax, ay, aw, ah);
    if g.last_geometry == Some(new) {
        return SyncPlan::Deduped;
    }
    g.last_geometry = Some(new);
    SyncPlan::Apply(ax, ay, aw, ah)
}

/// Force-apply variant for discrete window-state transitions
/// (maximize / restore / fullscreen toggle). These are one-shot events, not
/// continuous drag-resize bursts, so the throttle that protects against
/// swapchain-rebuild storms must NOT defer them — waiting for the throttle
/// (or the DWM-animation-delayed `WM_SIZE`) is what makes the mpv host visibly
/// lag the chrome on maximize. Skips the throttle gate but still updates
/// `last_sync` (re-arming the throttle for any follow-up burst) and dedups
/// against `last_geometry` so an already-correct host isn't re-set.
#[cfg(target_os = "windows")]
pub(crate) fn plan_sync_immediate(
    g: &mut GeomState,
    now: Instant,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> SyncPlan {
    g.last_sync = now;
    g.pending_geometry = None;
    let (ax, ay, aw, ah) = apply_minimize_inset_inner(g, x, y, width, height);
    let new = (ax, ay, aw, ah);
    if g.last_geometry == Some(new) {
        return SyncPlan::Deduped;
    }
    g.last_geometry = Some(new);
    SyncPlan::Apply(ax, ay, aw, ah)
}

/// What `sync_geometry_move` should do with a `WindowEvent::Moved`.
///
/// A `Moved` usually means a pure drag (position changes, size constant) — the
/// fast `set_position` (`SWP_NOSIZE`) path that avoids an mpv swapchain rebuild
/// per frame. But Windows also fires `Moved` as part of a maximize / restore /
/// Aero-snap, where the SIZE changes too; treating that as position-only leaves
/// the host stuck at the old size until the trailing `Resized` lands (the
/// visible maximize lag — prexu-hia9). When the resolved size differs from
/// `last_geometry`, plan a full `set_geometry` instead.
#[cfg(target_os = "windows")]
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum MovePlan {
    /// Pure reposition (size unchanged). `write_back` updates `last_geometry`
    /// position after a successful `set_position`, reusing the known size.
    Move {
        ax: i32,
        ay: i32,
        write_back: Option<(i32, i32, i32, i32)>,
    },
    /// The move carried a size change (maximize/restore/snap, or a top-left /
    /// corner drag-resize). Signal only: the caller delegates to the throttled
    /// `sync_geometry` path so a one-shot maximize applies immediately (gate
    /// open) while a continuous corner-resize is still coalesced to ~30 Hz
    /// (avoiding the mpv swapchain-rebuild storm the throttle guards against).
    Resize,
}

/// Pure decision half of `PlayerState::sync_geometry_move`. Does NOT mutate
/// `GeomState` — the caller applies the resulting `last_geometry` write only
/// after a successful host call (mirroring production). `None` = dedup-skip.
#[cfg(target_os = "windows")]
pub(crate) fn plan_move(
    g: &GeomState,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Option<MovePlan> {
    let (ax, ay, aw, ah) = apply_minimize_inset_inner(g, x, y, width, height);
    match g.last_geometry {
        Some((lx, ly, lw, lh)) => {
            if aw != lw || ah != lh {
                // Size changed — this "move" is really a maximize/restore/snap.
                Some(MovePlan::Resize)
            } else if lx == ax && ly == ay {
                None
            } else {
                Some(MovePlan::Move {
                    ax,
                    ay,
                    write_back: Some((ax, ay, lw, lh)),
                })
            }
        }
        // No prior geometry: can't know the size, so just reposition.
        None => Some(MovePlan::Move { ax, ay, write_back: None }),
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

    // ── Sync engine driven against a recording fake host ─────────────────
    //
    // These exercise the full throttle / dedup / trailing-flush / move
    // orchestration without a live Win32 window. `drive_sync` / `drive_move`
    // replicate the production lock-free sequence in `PlayerState`
    // (`mod.rs`): consult the pure planner, drop the (notional) geom lock,
    // then act on the host. The recording host captures the exact
    // `SetWindowPos`-equivalent calls and their order.

    #[cfg(target_os = "windows")]
    use std::cell::RefCell;

    #[cfg(target_os = "windows")]
    #[derive(Debug, PartialEq, Eq, Clone, Copy)]
    enum HostCall {
        SetGeometry(i32, i32, i32, i32),
        SetPosition(i32, i32),
    }

    #[cfg(target_os = "windows")]
    struct RecordingHost {
        calls: RefCell<Vec<HostCall>>,
        /// When true, every host op returns Err — used to prove the move
        /// write-back is gated on host success.
        fail: bool,
    }

    #[cfg(target_os = "windows")]
    impl RecordingHost {
        fn new() -> Self {
            Self { calls: RefCell::new(Vec::new()), fail: false }
        }
        fn failing() -> Self {
            Self { calls: RefCell::new(Vec::new()), fail: true }
        }
        fn calls(&self) -> Vec<HostCall> {
            self.calls.borrow().clone()
        }
    }

    #[cfg(target_os = "windows")]
    impl RecordingHost {
        fn set_geometry(&self, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
            self.calls.borrow_mut().push(HostCall::SetGeometry(x, y, w, h));
            if self.fail { Err("forced".into()) } else { Ok(()) }
        }
        fn set_position(&self, x: i32, y: i32) -> Result<(), String> {
            self.calls.borrow_mut().push(HostCall::SetPosition(x, y));
            if self.fail { Err("forced".into()) } else { Ok(()) }
        }
    }

    /// Mirror of `PlayerState::sync_geometry`'s lock-free sequence: plan
    /// under the (notional) lock, then act on the host only for `Apply`.
    #[cfg(target_os = "windows")]
    fn drive_sync(
        g: &mut GeomState,
        host: &RecordingHost,
        now: Instant,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
    ) {
        if let SyncPlan::Apply(ax, ay, aw, ah) = plan_sync(g, now, x, y, w, h) {
            let _ = host.set_geometry(ax, ay, aw, ah);
        }
    }

    /// Mirror of `PlayerState::sync_geometry_move`: plan, then either
    /// reposition-only (Move) or delegate a size-changing move to the throttled
    /// sync path (Resize), exactly as production does. `now` is only consulted
    /// on the Resize delegation.
    #[cfg(target_os = "windows")]
    fn drive_move(
        g: &mut GeomState,
        host: &RecordingHost,
        now: Instant,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
    ) {
        match plan_move(g, x, y, w, h) {
            Some(MovePlan::Move { ax, ay, write_back }) => {
                if host.set_position(ax, ay).is_ok() {
                    if let Some(wb) = write_back {
                        g.last_geometry = Some(wb);
                    }
                }
            }
            Some(MovePlan::Resize) => {
                // Production delegates to the throttled sync_geometry.
                drive_sync(g, host, now, x, y, w, h);
            }
            None => {}
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn sync_first_event_applies_to_host() {
        let mut g = GeomState::new();
        let host = RecordingHost::new();
        let now = g.last_sync + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1);
        drive_sync(&mut g, &host, now, 0, 0, 800, 600);
        assert_eq!(host.calls(), vec![HostCall::SetGeometry(0, 0, 800, 600)]);
        assert_eq!(g.last_geometry, Some((0, 0, 800, 600)));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn sync_throttles_rapid_second_event() {
        let mut g = GeomState::new();
        let host = RecordingHost::new();
        let base = g.last_sync + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1);
        drive_sync(&mut g, &host, base, 0, 0, 800, 600);
        // Second event 5ms later — well inside the throttle window.
        drive_sync(&mut g, &host, base + Duration::from_millis(5), 0, 0, 801, 600);
        // Only the first event reached the host; the second is pending.
        assert_eq!(host.calls(), vec![HostCall::SetGeometry(0, 0, 800, 600)]);
        assert_eq!(g.pending_geometry, Some((0, 0, 801, 600)));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn trailing_flush_applies_pending_after_interval() {
        let mut g = GeomState::new();
        let host = RecordingHost::new();
        let base = g.last_sync + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1);
        drive_sync(&mut g, &host, base, 0, 0, 800, 600);
        drive_sync(&mut g, &host, base + Duration::from_millis(5), 0, 0, 801, 600); // throttled
        let pending = g.pending_geometry.expect("final rect stashed as pending");
        // The flusher fires one interval later and re-drives the pending rect.
        let flush_now = base + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(2);
        drive_sync(&mut g, &host, flush_now, pending.0, pending.1, pending.2, pending.3);
        assert_eq!(
            host.calls(),
            vec![
                HostCall::SetGeometry(0, 0, 800, 600),
                HostCall::SetGeometry(0, 0, 801, 600),
            ]
        );
        assert!(g.pending_geometry.is_none());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn sync_dedup_skips_identical_rect() {
        let mut g = GeomState::new();
        let host = RecordingHost::new();
        let t0 = g.last_sync + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1);
        drive_sync(&mut g, &host, t0, 10, 20, 800, 600);
        // Same rect, one interval later (passes throttle) — must dedup-skip.
        let t1 = t0 + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1);
        drive_sync(&mut g, &host, t1, 10, 20, 800, 600);
        assert_eq!(host.calls(), vec![HostCall::SetGeometry(10, 20, 800, 600)]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn sync_minimized_applies_inset_region() {
        let mut g = GeomState::new();
        g.minimize = Some(DEFAULT);
        g.scale_factor = 1.0;
        let host = RecordingHost::new();
        let now = g.last_sync + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1);
        drive_sync(&mut g, &host, now, 0, 0, 1920, 1080);
        // Host receives the mini-corner inset rect, not the full client rect.
        let expected = compute_minimize_inset(DEFAULT, 1.0, 0, 0, 1920, 1080);
        assert_eq!(
            host.calls(),
            vec![HostCall::SetGeometry(expected.0, expected.1, expected.2, expected.3)]
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn move_applies_inset_position_and_writes_back() {
        let mut g = GeomState::new();
        // Seed a prior applied geometry so the move has a size to preserve.
        g.last_geometry = Some((0, 0, 800, 600));
        let now = g.last_sync + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1);
        let host = RecordingHost::new();
        drive_move(&mut g, &host, now, 30, 40, 800, 600);
        assert_eq!(host.calls(), vec![HostCall::SetPosition(30, 40)]);
        // Position updated, size preserved for the next resize dedup.
        assert_eq!(g.last_geometry, Some((30, 40, 800, 600)));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn move_dedup_skips_same_position() {
        let mut g = GeomState::new();
        g.last_geometry = Some((30, 40, 800, 600));
        let now = g.last_sync + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1);
        let host = RecordingHost::new();
        drive_move(&mut g, &host, now, 30, 40, 800, 600);
        assert!(host.calls().is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn move_with_size_change_applies_full_geometry() {
        // A `Moved` that also changes size (maximize/restore) must
        // set_geometry, not just set_position — otherwise the host lags at the
        // old size until the trailing Resized lands (prexu-hia9).
        let mut g = GeomState::new();
        g.last_geometry = Some((1603, -2129, 1918, 2128)); // restored window
        let now = g.last_sync + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1);
        let host = RecordingHost::new();
        drive_move(&mut g, &host, now, 1602, -2137, 3840, 2137); // maximize
        // Delegates to the throttled sync path; one-shot maximize passes the
        // gate and applies the full rect at once (not a position-only move).
        assert_eq!(host.calls(), vec![HostCall::SetGeometry(1602, -2137, 3840, 2137)]);
        assert_eq!(g.last_geometry, Some((1602, -2137, 3840, 2137)));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn move_write_back_gated_on_host_success() {
        let mut g = GeomState::new();
        g.last_geometry = Some((0, 0, 800, 600));
        let now = g.last_sync + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1);
        let host = RecordingHost::failing();
        drive_move(&mut g, &host, now, 30, 40, 800, 600);
        // The host op was attempted but failed — last_geometry must NOT move.
        assert_eq!(host.calls(), vec![HostCall::SetPosition(30, 40)]);
        assert_eq!(g.last_geometry, Some((0, 0, 800, 600)));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn plan_sync_immediate_applies_inside_throttle_window() {
        let mut g = GeomState::new();
        let host = RecordingHost::new();
        let base = g.last_sync + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1);
        // First normal sync establishes last_sync = base.
        drive_sync(&mut g, &host, base, 0, 0, 800, 600);
        // A maximize 5ms later would be THROTTLED by plan_sync, but the
        // immediate variant applies it now (state transition).
        let plan = plan_sync_immediate(&mut g, base + Duration::from_millis(5), 0, -10, 2560, 1392);
        assert_eq!(plan, SyncPlan::Apply(0, -10, 2560, 1392));
        assert_eq!(g.last_geometry, Some((0, -10, 2560, 1392)));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn plan_sync_immediate_dedups_when_already_applied() {
        let mut g = GeomState::new();
        g.last_geometry = Some((0, 0, 2560, 1392));
        let now = g.last_sync + Duration::from_millis(1);
        let plan = plan_sync_immediate(&mut g, now, 0, 0, 2560, 1392);
        assert_eq!(plan, SyncPlan::Deduped);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn plan_sync_reports_throttled_then_deduped() {
        let mut g = GeomState::new();
        let t0 = g.last_sync + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1);
        assert_eq!(plan_sync(&mut g, t0, 0, 0, 800, 600), SyncPlan::Apply(0, 0, 800, 600));
        assert_eq!(
            plan_sync(&mut g, t0 + Duration::from_millis(1), 0, 0, 900, 600),
            SyncPlan::Throttled
        );
        let t1 = t0 + GEOMETRY_SYNC_MIN_INTERVAL + Duration::from_millis(1);
        assert_eq!(plan_sync(&mut g, t1, 0, 0, 800, 600), SyncPlan::Deduped);
    }
}
