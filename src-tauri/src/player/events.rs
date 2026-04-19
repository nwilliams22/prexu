//! Event pump — drives a background thread that polls libmpv's event queue
//! and re-emits playback state changes to the frontend.
//!
//! Frontend event names:
//! - `player://time-pos`   f64 seconds (throttled to 4 Hz)
//! - `player://duration`   f64 seconds
//! - `player://paused`     bool
//! - `player://buffering`  bool
//! - `player://eof`        () fired on end-of-file
//! - `player://error`      String error message
//! - `player://ready`      () fired once the file is loaded

use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use libmpv2::events::{Event, EventContext, PropertyData};
use libmpv2::{Format, Mpv};
use tauri::{AppHandle, Emitter};

// Reply user-data IDs keep PropertyChange dispatch cheap (no string compare).
const REPLY_TIME_POS: u64 = 1;
const REPLY_DURATION: u64 = 2;
const REPLY_PAUSE: u64 = 3;
const REPLY_BUFFERING: u64 = 4;

const TIME_POS_THROTTLE: Duration = Duration::from_millis(250); // 4 Hz

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

    log::info!("[player:events] pump started, properties observed");

    // Keep the Arc alive for the lifetime of this thread so mpv outlives us.
    let _mpv_keepalive = mpv;

    let mut last_time_pos = Instant::now()
        .checked_sub(TIME_POS_THROTTLE)
        .unwrap_or_else(Instant::now);

    let mut loop_iterations: u64 = 0;
    loop {
        loop_iterations += 1;
        match ev_ctx.wait_event(1.0) {
            Some(Ok(event)) => {
                if dispatch(&app, event, &mut last_time_pos) {
                    log::info!("[player:events] Shutdown received at iter #{}", loop_iterations);
                    break;
                }
            }
            Some(Err(e)) => {
                log::warn!("[player:events] mpv error: {:?}", e);
                let _ = app.emit("player://error", format!("{:?}", e));
            }
            None => {
                // Timeout — log at info level occasionally so we can see
                // whether the pump is stuck on wait_event after a quit
                // should have fired Shutdown.
                if loop_iterations % 3 == 0 {
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
fn dispatch(app: &AppHandle, event: Event<'_>, last_time_pos: &mut Instant) -> bool {
    match event {
        Event::Shutdown => {
            log::info!("[player:events] Shutdown — exiting pump");
            return true;
        }
        Event::FileLoaded => {
            log::debug!("[player:events] FileLoaded → player://ready");
            let _ = app.emit("player://ready", ());
        }
        Event::EndFile(_reason) => {
            log::debug!("[player:events] EndFile → player://eof");
            let _ = app.emit("player://eof", ());
        }
        Event::PropertyChange { change, reply_userdata, .. } => match (reply_userdata, change) {
            (REPLY_TIME_POS, PropertyData::Double(t)) => {
                let now = Instant::now();
                if now.duration_since(*last_time_pos) >= TIME_POS_THROTTLE {
                    *last_time_pos = now;
                    log::trace!("[player:events] time-pos={:.1}", t);
                    let _ = app.emit("player://time-pos", t);
                }
            }
            (REPLY_DURATION, PropertyData::Double(d)) => {
                log::debug!("[player:events] duration={:.1}", d);
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
            _ => {}
        },
        _ => {}
    }
    false
}
