//! Event pump — drives a background thread that polls libmpv's event queue
//! and re-emits playback state changes to the frontend.
//!
//! Also owns `attach_window_handlers` (Windows-only), which wires the five
//! window-event concerns — move sync, resize/maximize-restore, DPI/scale,
//! focus reassert, and teardown — into the Tauri `WebviewWindow`'s
//! `on_window_event` callback. Extracted from `lib.rs::setup()` (prexu-bgz.30).
//!
//! Frontend event names:
//! - `player://time-pos`           f64 seconds (throttled to 4 Hz)
//! - `player://duration`           f64 seconds
//! - `player://paused`             bool
//! - `player://buffering`          bool
//! - `player://buffered`           f64 absolute seconds the demuxer has cached up to
//! - `player://eof`                () fired on end-of-file
//! - `player://error`              String error message
//! - `player://ready`              () fired once the file is loaded
//! - `player://host-window-ready`  () fired once the decoder has finished
//!   setup on a new file (post-PlaybackRestart), meaning mpv has actually
//!   rendered a frame into the host HWND. The frontend's
//!   useTransparentWindow defers body.player-transparent until this signal
//!   to avoid the cold-start flash (prexu-mto).

use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use libmpv2::events::{Event, EventContext, PropertyData};
use libmpv2::{Format, Mpv};
use tauri::{AppHandle, Emitter, Manager};

// ── Window handler (prexu-bgz.30) ────────────────────────────────────────────

/// Wire the five window-event concerns into `window`'s `on_window_event`
/// callback. Extracted from `lib.rs::setup()` to reduce the size of that
/// function.
///
/// Concerns wired:
/// 1. **Move sync** — `WindowEvent::Moved` → `sync_geometry_move` (no throttle)
/// 2. **Resize / maximize-restore** — `WindowEvent::Resized` →
///    snapped-rect tracking + `sync_geometry` + trailing-edge flush
///    (prexu-w9j, prexu-hhx). Window-state queries (`is_maximized`,
///    `is_fullscreen`, `is_minimized`) and geometry reads are batched once
///    per non-reapplying Resized event; the `reapplying_rect` re-entrant
///    path skips the geometry re-query entirely (prexu-bgz.23).
/// 3. **DPI / scale-factor** — `WindowEvent::ScaleFactorChanged` →
///    `set_scale_factor` + `sync_geometry`
/// 4. **Focus reassert** — `WindowEvent::Focused` →
///    `mark_focus_lost` / `reassert_host_on_focus` (prexu-5l5)
/// 5. **Teardown** — `WindowEvent::CloseRequested | Destroyed` →
///    `report_stopped_on_close` + `destroy` (prexu-50f)
/// Disable DWM maximize/minimize/restore transition animations on the main
/// window. The mpv host is a separate top-level window that can't ride the
/// chrome's ~250ms grow/shrink animation, so the two visibly mismatch during
/// it. Forcing transitions off makes the chrome snap instantly, matching the
/// host's immediate resize — no mismatch frame (prexu-hia9).
#[cfg(target_os = "windows")]
fn disable_window_transitions(window: &tauri::WebviewWindow) {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED,
    };
    let hwnd = match window.hwnd() {
        Ok(h) => h,
        Err(e) => {
            log::warn!("[window] disable_window_transitions: no hwnd: {}", e);
            return;
        }
    };
    // DWMWA_TRANSITIONS_FORCEDISABLED takes a BOOL (4-byte int); 1 = disable.
    let disable: i32 = 1;
    let res = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_TRANSITIONS_FORCEDISABLED,
            &disable as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<i32>() as u32,
        )
    };
    match res {
        Ok(()) => log::info!(
            "[window] DWM transitions force-disabled HWND={:?} (instant maximize/restore)",
            hwnd.0
        ),
        Err(e) => log::warn!("[window] DwmSetWindowAttribute failed: {:?}", e),
    }
}

#[cfg(target_os = "windows")]
pub fn attach_window_handlers(window: &tauri::WebviewWindow, app_handle: AppHandle) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use tauri::WindowEvent;

    // Snap maximize/restore (no animation) so chrome + mpv host stay in lockstep.
    disable_window_transitions(window);

    let win_clone = window.clone();
    // prexu-w9j: Windows leaves WINDOWPLACEMENT.rcNormalPosition
    // at the PRE-snap rect while a window is Aero-Snapped, so a
    // maximize→restore cycle on a snapped window restores to the
    // wrong (pre-snap) size — and tao doesn't track the snapped
    // rect as its restore target either. We remember the last
    // non-maximized / non-fullscreen / non-minimized rect and
    // re-apply it when the window is restored from maximize.
    let last_normal_rect: Arc<
        Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>>,
    > = Arc::new(Mutex::new(None));
    let was_maximized = Arc::new(AtomicBool::new(false));
    // Track fullscreen/minimized too so a maximize/restore/un-minimize state
    // transition can be detected and synced immediately (prexu-hia9).
    let was_fullscreen = Arc::new(AtomicBool::new(false));
    let was_minimized = Arc::new(AtomicBool::new(false));
    let reapplying_rect = Arc::new(AtomicBool::new(false));

    // Start the long-lived trailing-edge flusher task (prexu-bgz.24).
    // `start_flusher` is idempotent — subsequent calls on the same
    // `PlayerState` are no-ops, so it is safe to call here even if
    // `attach_window_handlers` were somehow called more than once.
    // Must be called BEFORE the `on_window_event` closure captures
    // `app_handle` by move, so we can still borrow it here.
    {
        let state = app_handle.state::<super::PlayerState>();
        state.start_flusher(app_handle.clone());
    }

    window.on_window_event(move |event| {
        let state = app_handle.state::<super::PlayerState>();
        match event {
            // Pure move (WM_MOVE / drag without resize) —
            // fast-path through sync_geometry_move which
            // skips the 50ms throttle. Position-only
            // SetWindowPos with SWP_NOSIZE doesn't
            // trigger mpv's swapchain rebuild, so we can
            // run at the full event rate without the
            // freeze that necessitates the throttle for
            // size changes (prexu-aqd). The trailing-
            // edge flush is not needed here either — we
            // are not dropping any events.
            WindowEvent::Moved(_) => {
                if let (Ok(pos), Ok(size)) =
                    (win_clone.inner_position(), win_clone.inner_size())
                {
                    log::trace!(
                        "[window] Moved to ({},{}), size={}x{}",
                        pos.x, pos.y, size.width, size.height
                    );
                    state.sync_geometry_move(
                        pos.x,
                        pos.y,
                        size.width as i32,
                        size.height as i32,
                    );
                }
            }
            // Resize (WM_SIZE — drag-resize, snap,
            // maximize/restore, fullscreen toggle). Goes
            // through the throttled sync_geometry path
            // because each SetWindowPos with size change
            // rebuilds mpv's D3D11 swapchain; 60Hz
            // rebuild bursts crash gpu-next vo. Throttle
            // + trailing-edge flush preserved.
            WindowEvent::Resized(_) => {
                // prexu-w9j: keep the snapped/normal rect as the
                // restore target so maximize→restore returns to it
                // instead of the OS's stale pre-snap rect. Guarded
                // by `reapplying_rect` so our own set_size/
                // set_position re-entrant WM_SIZE doesn't recurse.
                //
                // prexu-bgz.23: batch ALL window-state and geometry
                // queries into one block so they run AT MOST ONCE per
                // non-reapplying Resized event instead of up to five
                // separate syscalls. The `reapplying_rect=true` path
                // (our own SetWindowPos re-fired) skips sync_geometry
                // entirely because the size we just set is already
                // the correct target — a re-entrant sync would be
                // wasteful and could race with the reapplying flag.
                if reapplying_rect.load(Ordering::Relaxed) {
                    log::trace!("[window] Resized skipped — reapplying_rect (cache hit)");
                    return;
                }

                // Batch all window-state reads in one block.
                let maxed = win_clone.is_maximized().unwrap_or(false);
                let fs = win_clone.is_fullscreen().unwrap_or(false);
                let min = win_clone.is_minimized().unwrap_or(false);
                let inner_pos = win_clone.inner_position();
                let inner_sz = win_clone.inner_size();

                let was_max = was_maximized.swap(maxed, Ordering::Relaxed);
                // A discrete maximize / restore / fullscreen / un-minimize is a
                // one-shot state change, not a drag-resize burst — detect it so
                // the host can be synced immediately (prexu-hia9).
                let was_fs = was_fullscreen.swap(fs, Ordering::Relaxed);
                let was_min = was_minimized.swap(min, Ordering::Relaxed);
                let state_transition = maxed != was_max || fs != was_fs || min != was_min;
                if is_restore_from_maximize(was_max, maxed, fs, min) {
                    // Just un-maximized — the OS restored to the
                    // stale pre-snap rect. Re-apply our captured
                    // snapped/normal rect.
                    let target = *last_normal_rect.lock().unwrap();
                    if let Some((opos, isize)) = target {
                        reapplying_rect.store(true, Ordering::Relaxed);
                        let _ = win_clone
                            .set_size(tauri::Size::Physical(isize));
                        let _ = win_clone
                            .set_position(tauri::Position::Physical(opos));
                        reapplying_rect.store(false, Ordering::Relaxed);
                        log::info!(
                            "[window] restore-from-maximize: reapplied snapped rect ({},{} {}x{})",
                            opos.x, opos.y, isize.width, isize.height
                        );
                    }
                } else if is_normal_resize(maxed, fs, min) {
                    // Normal drag-resize or Aero-Snap — this is
                    // the size a future restore should return to.
                    // Reuse the already-queried outer_position +
                    // inner_size (batched above, prexu-bgz.23).
                    if let (Ok(pos), Ok(size)) = (win_clone.outer_position(), &inner_sz) {
                        *last_normal_rect.lock().unwrap() =
                            Some((pos, *size));
                    }
                }
                if let (Ok(pos), Ok(size)) = (inner_pos, inner_sz) {
                    log::trace!("[window] Resized to ({},{},{}x{})", pos.x, pos.y, size.width, size.height);
                    // Tell the frontend the OS-level WM_SIZE
                    // fired. AppLayout's resize hook listens
                    // for this and triggers a forced React
                    // commit + synchronous layout read, so
                    // dashboard content stays in lockstep
                    // with the new client area even when
                    // WebView2 batches its own resize event
                    // (prexu-uzk follow-up). Payload is the
                    // new (width, height) so the receiver
                    // can dedup against the last value.
                    let _ = app_handle.emit(
                        "window://resized",
                        (size.width, size.height),
                    );
                    // On a discrete maximize/restore/un-minimize, apply the new
                    // client rect immediately (throttle-bypassing) so the mpv
                    // host doesn't lag the chrome through the maximize
                    // animation. Skipped while minimized (host is hidden /
                    // zero-size). The throttled sync_geometry below then
                    // dedup-skips the identical rect. (prexu-hia9)
                    if state_transition && !min {
                        log::debug!(
                            "[window] state transition (max={} fs={} min={}) — immediate host sync",
                            maxed, fs, min
                        );
                        state.sync_geometry_now(
                            pos.x,
                            pos.y,
                            size.width as i32,
                            size.height as i32,
                        );
                    }
                    state.sync_geometry(
                        pos.x,
                        pos.y,
                        size.width as i32,
                        size.height as i32,
                    );
                    // Schedule a trailing-edge flush on the first
                    // event of a burst. A fast drag-resize whose
                    // final WM_SIZE lands inside the 50ms throttle
                    // window leaves the host stuck at stale
                    // geometry — sync_geometry stashes the final
                    // rect in pending, but no further event arrives
                    // to consume it. The worker sleeps the throttle
                    // window, then dispatches back to the main
                    // thread to apply whatever pending holds at
                    // that moment (which is always the most recent
                    // rect, since later events overwrite earlier
                    // ones). claim_trailing_schedule's atomic swap
                    // means subsequent events in the same burst
                    // don't double-spawn. (prexu-hhx)
                    // Wake the long-lived flusher task on the first event
                    // of a burst (prexu-bgz.24). `claim_trailing_schedule`'s
                    // atomic swap dedup is unchanged — only one `notify_one`
                    // fires per burst; subsequent events lose the race and
                    // skip this branch. The flusher task parks on
                    // `notified().await` between bursts (no spinning) and
                    // sleeps `GEOMETRY_SYNC_MIN_INTERVAL` before dispatching
                    // `flush_pending_geometry` to the main thread, exactly as
                    // the old per-burst `std::thread::spawn` did.
                    if state.claim_trailing_schedule() {
                        state.wake_flusher();
                    }
                }
            }
            // Cross-monitor DPI change: tao gives us the new
            // physical size directly to dodge a stale read.
            //
            // The destructured `scale_factor` is the NEW scale
            // for the monitor the window just landed on. We
            // push it into PlayerState BEFORE calling
            // sync_geometry so `apply_minimize_inset` sees
            // the new scale on the very first re-place
            // (prexu-buw). Without this, a minimized mini
            // player keeps using the old monitor's DPI for
            // its physical size and ends up wrong-sized at
            // the anchor corner.
            WindowEvent::ScaleFactorChanged {
                new_inner_size,
                scale_factor,
                ..
            } => {
                log::info!(
                    "[window] ScaleFactorChanged scale={:.3} new_size={}x{}",
                    scale_factor,
                    new_inner_size.width,
                    new_inner_size.height
                );
                state.set_scale_factor(*scale_factor);
                if let Ok(pos) = win_clone.inner_position() {
                    state.sync_geometry(
                        pos.x,
                        pos.y,
                        new_inner_size.width as i32,
                        new_inner_size.height as i32,
                    );
                }
            }
            // Focus-restore host reassert (prexu-5l5). When
            // the main Tauri window regains focus after
            // another app fully occluded Prexu, the mpv
            // host HWND can be left below the WebView in
            // z-order or with a stale DXGI swap chain that
            // never re-Presents — the user sees the player
            // chrome but the video region is transparent
            // through to whatever is behind. Affects every
            // player mode (full, fullscreen, popout, mini).
            //
            // Gated on `consume_focus_reassert` so the
            // reassert only fires after an actual out-
            // and-back focus cycle. Tauri emits Focused
            // (true) on click / mouse-enter as well, and
            // running the SetWindowPos chain on each one
            // disrupts WebView2 mouse capture (cursor
            // sticks on the host edge resize glyph). The
            // latch is set on Focused(false) below.
            WindowEvent::Focused(false) => {
                state.mark_focus_lost();
            }
            WindowEvent::Focused(true) => {
                if !state.consume_focus_reassert() {
                    return;
                }
                if let (Ok(pos), Ok(size), Ok(parent)) = (
                    win_clone.inner_position(),
                    win_clone.inner_size(),
                    win_clone.hwnd(),
                ) {
                    state.reassert_host_on_focus(
                        parent,
                        pos.x,
                        pos.y,
                        size.width as i32,
                        size.height as i32,
                    );
                }
            }
            // Tear down host window + mpv before Tauri's main
            // window goes away so DestroyWindow runs cleanly.
            WindowEvent::CloseRequested { .. }
            | WindowEvent::Destroyed => {
                log::info!("[window] CloseRequested/Destroyed — destroying player");
                // Final stopped timeline report BEFORE destroy —
                // needs the live mpv time-pos, and the JS
                // cleanup can't be relied on during webview
                // teardown (prexu-50f). One-shot: the ctx is
                // taken so the follow-up Destroyed is a no-op.
                state.report_stopped_on_close();
                let _ = state.destroy(&app_handle);
            }
            _ => {}
        }
    });
}

// ── Unit tests for pure window-state helpers (prexu-bgz.23) ─────────────────

/// Pure helper: given the current and previous maximized state plus fullscreen
/// and minimized flags, determine whether we are transitioning from maximized
/// to normal (i.e. a restore-from-maximize that requires re-applying the
/// snapped rect).
///
/// Factored out so it can be unit-tested without a live Win32 window.
#[cfg(target_os = "windows")]
pub(crate) fn is_restore_from_maximize(was_max: bool, maxed: bool, fs: bool, min: bool) -> bool {
    was_max && !maxed && !fs && !min
}

/// Pure helper: determine whether the current Resized event is a normal
/// drag-resize or Aero-Snap (i.e. the size we should remember as the
/// restore target). Returns true when the window is in no special state
/// (not maximized, not fullscreen, not minimized).
#[cfg(target_os = "windows")]
pub(crate) fn is_normal_resize(maxed: bool, fs: bool, min: bool) -> bool {
    !maxed && !fs && !min
}

// Reply user-data IDs keep PropertyChange dispatch cheap (no string compare).
const REPLY_TIME_POS: u64 = 1;
const REPLY_DURATION: u64 = 2;
const REPLY_PAUSE: u64 = 3;
const REPLY_BUFFERING: u64 = 4;
const REPLY_BUFFERED: u64 = 5;
const REPLY_EOF_REACHED: u64 = 6;

const TIME_POS_THROTTLE: Duration = Duration::from_millis(250); // 4 Hz
// `demuxer-cache-time` updates often during streaming; throttle to keep the
// SeekBar buffered indicator smooth without flooding the IPC channel.
const BUFFERED_THROTTLE: Duration = Duration::from_millis(500); // 2 Hz

// ── Pure decision helpers (no AppHandle / Mpv / emit dependency) ────────────

/// Returns `true` when enough time has elapsed since `last` to allow the next
/// throttled emit. Used for both time-pos (250 ms / 4 Hz) and buffered
/// (500 ms / 2 Hz). The caller is responsible for updating `last` on `true`.
fn should_emit_throttled(now: Instant, last: Instant, throttle: Duration) -> bool {
    now.duration_since(last) >= throttle
}

/// Returns `true` on the first PlaybackRestart per file — i.e. when
/// `hwdec_logged` is still `false`, meaning we have not yet emitted
/// `player://host-window-ready` for this file load. Subsequent PlaybackRestart
/// events (seeks) return `false` so the frontend only receives one
/// host-window-ready signal per file.
///
/// The caller sets `hwdec_logged = true` immediately after acting on `true`.
fn is_first_frame(hwdec_logged: bool) -> bool {
    !hwdec_logged
}

/// Returns `true` when the duration property should be logged at `info` level
/// (first non-zero arrival per file — the cold-start checkpoint) and the
/// `duration_logged` flag should be set. Subsequent arrivals are `debug`.
///
/// The caller sets `duration_logged = true` immediately after acting on `true`.
fn is_first_duration(duration_logged: bool, d: f64) -> bool {
    !duration_logged && d > 0.0
}

/// Returns `true` when the EOF true-edge should be forwarded to the frontend.
/// mpv emits both edges (false → true and true → false); only the rising edge
/// (reached == true) triggers `player://eof`.
fn should_emit_eof(reached: bool) -> bool {
    reached
}

/// Map an `EndFile` reason code to a human-readable label. Used for
/// diagnostic logging only. Matches libmpv's `mpv_end_file_reason` enum:
/// 0=EOF, 2=STOP, 3=QUIT, 4=ERROR, 5=REDIRECT.
fn end_file_reason_label(reason: u32) -> &'static str {
    match reason {
        0 => "EOF",
        2 => "STOP",
        3 => "QUIT",
        4 => "ERROR",
        5 => "REDIRECT",
        _ => "unknown",
    }
}


// ── Event pump ───────────────────────────────────────────────────────────────

pub(crate) fn spawn_event_pump(
    mpv: Arc<Mpv>,
    app: AppHandle,
) -> Result<thread::JoinHandle<()>, String> {
    thread::Builder::new()
        .name("mpv-event-pump".into())
        .spawn(move || run_pump(mpv, app))
        .map_err(|e| format!("Failed to spawn event thread: {}", e))
}

fn run_pump(mpv: Arc<Mpv>, app: AppHandle) {
    // A second EventContext sharing the underlying mpv handle. The one inside
    // Mpv requires &mut Mpv to poll, which we can't get through the Arc; this
    // separate context is `Send` and lives in this thread.
    let mut ev_ctx = EventContext::new(mpv.ctx);

    if let Err(e) = ev_ctx.observe_property("time-pos", Format::Double, REPLY_TIME_POS) {
        log::warn!("[player] observe time-pos failed: {:?}", e);
    }
    if let Err(e) = ev_ctx.observe_property("duration", Format::Double, REPLY_DURATION) {
        log::warn!("[player] observe duration failed: {:?}", e);
    }
    if let Err(e) = ev_ctx.observe_property("pause", Format::Flag, REPLY_PAUSE) {
        log::warn!("[player] observe pause failed: {:?}", e);
    }
    if let Err(e) = ev_ctx.observe_property("paused-for-cache", Format::Flag, REPLY_BUFFERING) {
        log::warn!("[player] observe buffering failed: {:?}", e);
    }
    // `demuxer-cache-time` is the absolute video time up to which the demuxer
    // has cached data. Matches HTML5 `video.buffered.end(...)` semantics so
    // the SeekBar buffered overlay code doesn't need to change shape.
    if let Err(e) = ev_ctx.observe_property("demuxer-cache-time", Format::Double, REPLY_BUFFERED) {
        log::warn!("[player] observe demuxer-cache-time failed: {:?}", e);
    }
    // `eof-reached` is the canonical end-of-file signal. With keep-open=always
    // mpv pauses at EOF instead of unloading the file, and in our config it
    // does NOT reliably fire the EndFile event for natural EOF (only for
    // explicit stop/quit). Observing this property gives us a deterministic
    // edge to drive PostPlay / queue advancement off.
    if let Err(e) = ev_ctx.observe_property("eof-reached", Format::Flag, REPLY_EOF_REACHED) {
        log::warn!("[player] observe eof-reached failed: {:?}", e);
    }

    log::info!("[player:events] pump started, properties observed");

    let mut last_time_pos = Instant::now()
        .checked_sub(TIME_POS_THROTTLE)
        .unwrap_or_else(Instant::now);
    let mut last_buffered = Instant::now()
        .checked_sub(BUFFERED_THROTTLE)
        .unwrap_or_else(Instant::now);

    let mut loop_iterations: u64 = 0;
    // Reset on each FileLoaded; logged once per file on the first
    // PlaybackRestart so we don't spam on every seek.
    let mut hwdec_logged = false;
    // Log the FIRST duration property arrival at info level so cold-start
    // traces show when the demuxer first parsed the stream headers (a
    // load-bearing checkpoint between loadfile and FileLoaded). Subsequent
    // duration changes (rare on VOD) drop back to debug.
    let mut duration_logged = false;
    loop {
        loop_iterations += 1;
        match ev_ctx.wait_event(1.0) {
            Some(Ok(event)) => {
                if dispatch(
                    &app,
                    &mpv,
                    event,
                    &mut last_time_pos,
                    &mut last_buffered,
                    &mut hwdec_logged,
                    &mut duration_logged,
                ) {
                    log::info!("[player:events] Shutdown received at iter #{}", loop_iterations);
                    break;
                }
            }
            Some(Err(e)) => {
                log::warn!("[player:events] mpv error: {:?}", e);
                let _ = app.emit("player://error", format!("{:?}", e));
            }
            None => {
                // Timeout — kept as a diagnostic for the case where the
                // pump fails to receive a Shutdown event after `quit` is
                // sent (the pump would log forever instead of breaking).
                // Throttled to ~once per minute (60 iters * 1.0s timeout)
                // so an idle warmup mpv doesn't flood the dev console
                // with thousands of lines.
                if loop_iterations % 60 == 0 {
                    log::debug!(
                        "[player:events] wait_event timeout (iter #{})",
                        loop_iterations
                    );
                }
            }
        }
    }
    log::info!("[player:events] pump exiting after {} iterations", loop_iterations);
}

/// Returns `true` when the loop should exit (shutdown).
fn dispatch(
    app: &AppHandle,
    mpv: &Mpv,
    event: Event<'_>,
    last_time_pos: &mut Instant,
    last_buffered: &mut Instant,
    hwdec_logged: &mut bool,
    duration_logged: &mut bool,
) -> bool {
    match event {
        Event::Shutdown => {
            log::info!("[player:events] Shutdown — exiting pump");
            return true;
        }
        Event::FileLoaded => {
            // video-codec / video-format are populated from the demuxer at
            // FileLoaded, so they're safe to read here. hwdec-current is NOT
            // — the decoder hasn't initialised yet and the property reports
            // PROPERTY_UNAVAILABLE. We log it on the first PlaybackRestart
            // (below) instead, which fires after the decoder is up.
            if let Ok(codec) = mpv.get_property::<String>("video-codec") {
                let pixfmt = mpv.get_property::<String>("video-format").unwrap_or_default();
                log::debug!("[player:events] video-codec={} video-format={}", codec, pixfmt);
            }
            *hwdec_logged = false;
            *duration_logged = false;
            log::info!("[player:events] FileLoaded → player://ready");
            let _ = app.emit("player://ready", ());
        }
        Event::PlaybackRestart => {
            // Fires after seeks AND after the decoder finishes its initial
            // setup on a new file. By this point hwdec-current reports the
            // selected backend ("d3d11va", "dxva2-copy", "no", etc.). Log
            // once per file so seeks don't spam.
            //
            // First PlaybackRestart per file is also our signal that mpv
            // has actually composited a frame into the host HWND. Emit
            // player://host-window-ready so the frontend's
            // useTransparentWindow stops deferring and applies the
            // transparent body class without exposing the OS desktop
            // (prexu-mto). Subsequent PlaybackRestart events (e.g. after
            // a seek) do not need to re-emit — the receiver only listens
            // once per session.
            if is_first_frame(*hwdec_logged) {
                let hwdec = mpv.get_property::<String>("hwdec-current")
                    .unwrap_or_else(|_| "<unavailable>".into());
                log::info!("[player:events] hwdec-current={} (playback-restart)", hwdec);
                *hwdec_logged = true;
                log::info!("[player:events] first frame ready → player://host-window-ready");
                let _ = app.emit("player://host-window-ready", ());
            }
        }
        Event::EndFile(reason) => {
            // EndFile is diagnostic-only. With keep-open=always mpv often
            // does NOT fire EndFile for natural EOF in our config (verified
            // empirically on Windows 11 + libmpv v0.41) — instead it just
            // pauses and flips the eof-reached property. We drive the
            // player://eof signal off that property (REPLY_EOF_REACHED)
            // which is fully deterministic. EndFile reason values: 0=EOF,
            // 2=STOP, 3=QUIT, 4=ERROR, 5=REDIRECT.
            log::debug!(
                "[player:events] EndFile(reason={}/{}) — diagnostic only",
                reason,
                end_file_reason_label(reason)
            );
        }
        Event::PropertyChange { change, reply_userdata, .. } => match (reply_userdata, change) {
            (REPLY_TIME_POS, PropertyData::Double(t)) => {
                let now = Instant::now();
                if should_emit_throttled(now, *last_time_pos, TIME_POS_THROTTLE) {
                    *last_time_pos = now;
                    log::trace!("[player:events] time-pos={:.1}", t);
                    let _ = app.emit("player://time-pos", t);
                }
            }
            (REPLY_DURATION, PropertyData::Double(d)) => {
                if is_first_duration(*duration_logged, d) {
                    // First non-zero duration = demuxer parsed the stream
                    // headers. Useful for attributing cold-start latency.
                    log::info!("[player:events] first duration={:.1} (stream opened)", d);
                    *duration_logged = true;
                } else {
                    log::debug!("[player:events] duration={:.1}", d);
                }
                let _ = app.emit("player://duration", d);
            }
            (REPLY_PAUSE, PropertyData::Flag(p)) => {
                log::debug!("[player:events] paused={}", p);
                let _ = app.emit("player://paused", p);
            }
            (REPLY_BUFFERING, PropertyData::Flag(b)) => {
                log::debug!("[player:events] buffering={}", b);
                let _ = app.emit("player://buffering", b);
            }
            (REPLY_BUFFERED, PropertyData::Double(b)) => {
                let now = Instant::now();
                if should_emit_throttled(now, *last_buffered, BUFFERED_THROTTLE) {
                    *last_buffered = now;
                    log::trace!("[player:events] buffered={:.1}", b);
                    let _ = app.emit("player://buffered", b);
                }
            }
            (REPLY_EOF_REACHED, PropertyData::Flag(reached)) => {
                // Treat the false→true edge as the natural end-of-file signal
                // (PostPlay overlay, timeline 'stopped' report, etc.). Observe
                // emits both edges; we only forward the true edge. mpv resets
                // eof-reached to false on a successful seek-back or new file
                // load, so the next playback can fire it again.
                if should_emit_eof(reached) {
                    log::debug!("[player:events] eof-reached=true → player://eof");
                    let _ = app.emit("player://eof", ());
                } else {
                    log::trace!("[player:events] eof-reached=false");
                }
            }
            _ => {}
        },
        _ => {}
    }
    false
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_restore_from_maximize (prexu-bgz.23) ──────────────────────────────

    #[cfg(target_os = "windows")]
    #[test]
    fn restore_from_maximize_true_when_was_max_and_now_normal() {
        assert!(is_restore_from_maximize(true, false, false, false));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn restore_from_maximize_false_when_still_maximized() {
        assert!(!is_restore_from_maximize(true, true, false, false));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn restore_from_maximize_false_when_transitioning_to_fullscreen() {
        // maximize → fullscreen toggle should NOT trigger a restore re-apply.
        assert!(!is_restore_from_maximize(true, false, true, false));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn restore_from_maximize_false_when_minimizing_while_maximized() {
        // Minimize from maximized: was_max=true, maxed=false, min=true.
        // Should NOT re-apply the snapped rect in this case.
        assert!(!is_restore_from_maximize(true, false, false, true));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn restore_from_maximize_false_when_was_not_maximized() {
        assert!(!is_restore_from_maximize(false, false, false, false));
    }

    // ── is_normal_resize (prexu-bgz.23) ──────────────────────────────────────

    #[cfg(target_os = "windows")]
    #[test]
    fn normal_resize_true_when_all_flags_false() {
        assert!(is_normal_resize(false, false, false));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normal_resize_false_when_maximized() {
        assert!(!is_normal_resize(true, false, false));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normal_resize_false_when_fullscreen() {
        assert!(!is_normal_resize(false, true, false));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normal_resize_false_when_minimized() {
        assert!(!is_normal_resize(false, false, true));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normal_resize_false_when_all_flags_true() {
        assert!(!is_normal_resize(true, true, true));
    }

    /// Map a REPLY_* user-data id to the corresponding frontend event name.
    /// Used to verify the routing table in tests without exposing the helper
    /// in the production binary (only tests need to enumerate it).
    fn reply_id_to_event_name(reply_userdata: u64) -> Option<&'static str> {
        match reply_userdata {
            REPLY_TIME_POS => Some("player://time-pos"),
            REPLY_DURATION => Some("player://duration"),
            REPLY_PAUSE => Some("player://paused"),
            REPLY_BUFFERING => Some("player://buffering"),
            REPLY_BUFFERED => Some("player://buffered"),
            REPLY_EOF_REACHED => Some("player://eof"),
            _ => None,
        }
    }

    // ── should_emit_throttled ────────────────────────────────────────────────

    #[test]
    fn throttle_gate_passes_when_elapsed_equals_throttle() {
        let throttle = TIME_POS_THROTTLE;
        let last = Instant::now()
            .checked_sub(throttle)
            .expect("checked_sub should not underflow");
        let now = last + throttle;
        assert!(should_emit_throttled(now, last, throttle));
    }

    #[test]
    fn throttle_gate_passes_when_elapsed_exceeds_throttle() {
        let throttle = TIME_POS_THROTTLE;
        let last = Instant::now()
            .checked_sub(throttle * 2)
            .expect("checked_sub should not underflow");
        let now = last + throttle * 2;
        assert!(should_emit_throttled(now, last, throttle));
    }

    #[test]
    fn throttle_gate_blocks_when_elapsed_just_under_throttle() {
        let throttle = TIME_POS_THROTTLE;
        let last = Instant::now()
            .checked_sub(throttle - Duration::from_millis(1))
            .expect("checked_sub should not underflow");
        let now = last + throttle - Duration::from_millis(1);
        assert!(!should_emit_throttled(now, last, throttle));
    }

    #[test]
    fn throttle_gate_blocks_when_elapsed_is_zero() {
        let now = Instant::now();
        assert!(!should_emit_throttled(now, now, TIME_POS_THROTTLE));
    }

    #[test]
    fn buffered_throttle_boundary_just_over() {
        let throttle = BUFFERED_THROTTLE;
        let last = Instant::now()
            .checked_sub(throttle + Duration::from_millis(1))
            .expect("checked_sub should not underflow");
        let now = last + throttle + Duration::from_millis(1);
        assert!(should_emit_throttled(now, last, throttle));
    }

    #[test]
    fn buffered_throttle_boundary_just_under() {
        let throttle = BUFFERED_THROTTLE;
        let last = Instant::now()
            .checked_sub(throttle - Duration::from_millis(1))
            .expect("checked_sub should not underflow");
        let now = last + throttle - Duration::from_millis(1);
        assert!(!should_emit_throttled(now, last, throttle));
    }

    // ── is_first_frame ───────────────────────────────────────────────────────

    #[test]
    fn first_frame_gate_true_when_hwdec_not_logged() {
        assert!(is_first_frame(false));
    }

    #[test]
    fn first_frame_gate_false_when_hwdec_already_logged() {
        assert!(!is_first_frame(true));
    }

    #[test]
    fn first_frame_gate_simulates_file_lifecycle() {
        // Simulate: FileLoaded resets flag → false, first PlaybackRestart →
        // true, subsequent PlaybackRestart (seek) → false.
        let mut hwdec_logged = false; // after FileLoaded reset
        assert!(is_first_frame(hwdec_logged), "first PlaybackRestart should pass");
        hwdec_logged = true;           // caller sets it after acting on true
        assert!(!is_first_frame(hwdec_logged), "seek PlaybackRestart should not pass");
    }

    // ── is_first_duration ────────────────────────────────────────────────────

    #[test]
    fn first_duration_false_when_d_is_zero() {
        assert!(!is_first_duration(false, 0.0));
    }

    #[test]
    fn first_duration_false_when_d_is_negative() {
        assert!(!is_first_duration(false, -1.0));
    }

    #[test]
    fn first_duration_true_on_first_positive_value() {
        assert!(is_first_duration(false, 3600.0));
    }

    #[test]
    fn first_duration_false_after_already_logged() {
        // Even with a positive d, once the flag is set the gate is closed.
        assert!(!is_first_duration(true, 3600.0));
    }

    #[test]
    fn first_duration_simulates_lifecycle() {
        let mut duration_logged = false;
        // d=0 arrives first (property observable before demuxer is ready)
        assert!(!is_first_duration(duration_logged, 0.0));
        // real duration arrives
        assert!(is_first_duration(duration_logged, 7200.0));
        duration_logged = true;
        // subsequent update (rare on VOD, but possible)
        assert!(!is_first_duration(duration_logged, 7201.0));
    }

    // ── should_emit_eof ──────────────────────────────────────────────────────

    #[test]
    fn eof_true_edge_emits() {
        assert!(should_emit_eof(true));
    }

    #[test]
    fn eof_false_edge_does_not_emit() {
        assert!(!should_emit_eof(false));
    }

    // ── end_file_reason_label ────────────────────────────────────────────────

    #[test]
    fn end_file_reason_known_codes() {
        assert_eq!(end_file_reason_label(0), "EOF");
        assert_eq!(end_file_reason_label(2), "STOP");
        assert_eq!(end_file_reason_label(3), "QUIT");
        assert_eq!(end_file_reason_label(4), "ERROR");
        assert_eq!(end_file_reason_label(5), "REDIRECT");
    }

    #[test]
    fn end_file_reason_unknown_code_returns_unknown() {
        assert_eq!(end_file_reason_label(99), "unknown");
        assert_eq!(end_file_reason_label(1), "unknown"); // gap in libmpv enum
    }

    // ── reply_id_to_event_name ───────────────────────────────────────────────

    #[test]
    fn reply_id_time_pos_maps_correctly() {
        assert_eq!(
            reply_id_to_event_name(REPLY_TIME_POS),
            Some("player://time-pos")
        );
    }

    #[test]
    fn reply_id_duration_maps_correctly() {
        assert_eq!(
            reply_id_to_event_name(REPLY_DURATION),
            Some("player://duration")
        );
    }

    #[test]
    fn reply_id_pause_maps_correctly() {
        assert_eq!(
            reply_id_to_event_name(REPLY_PAUSE),
            Some("player://paused")
        );
    }

    #[test]
    fn reply_id_buffering_maps_correctly() {
        assert_eq!(
            reply_id_to_event_name(REPLY_BUFFERING),
            Some("player://buffering")
        );
    }

    #[test]
    fn reply_id_buffered_maps_correctly() {
        assert_eq!(
            reply_id_to_event_name(REPLY_BUFFERED),
            Some("player://buffered")
        );
    }

    #[test]
    fn reply_id_eof_reached_maps_correctly() {
        assert_eq!(
            reply_id_to_event_name(REPLY_EOF_REACHED),
            Some("player://eof")
        );
    }

    #[test]
    fn reply_id_unknown_returns_none() {
        assert_eq!(reply_id_to_event_name(0), None);
        assert_eq!(reply_id_to_event_name(99), None);
        assert_eq!(reply_id_to_event_name(u64::MAX), None);
    }

    #[test]
    fn reply_id_all_six_known_ids_return_some() {
        let known = [
            REPLY_TIME_POS,
            REPLY_DURATION,
            REPLY_PAUSE,
            REPLY_BUFFERING,
            REPLY_BUFFERED,
            REPLY_EOF_REACHED,
        ];
        for id in known {
            assert!(
                reply_id_to_event_name(id).is_some(),
                "REPLY id {} should map to Some",
                id
            );
        }
    }
}
