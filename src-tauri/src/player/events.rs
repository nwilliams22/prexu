//! Event pump — drives a background thread that polls libmpv's event queue
//! and re-emits playback state changes to the frontend.
//!
//! Frontend event names:
//! - `player://time-pos`   f64 seconds (throttled to 4 Hz)
//! - `player://duration`   f64 seconds
//! - `player://paused`     bool
//! - `player://buffering`  bool
//! - `player://buffered`   f64 absolute seconds the demuxer has cached up to
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
const REPLY_BUFFERED: u64 = 5;
const REPLY_EOF_REACHED: u64 = 6;

const TIME_POS_THROTTLE: Duration = Duration::from_millis(250); // 4 Hz
// `demuxer-cache-time` updates often during streaming; throttle to keep the
// SeekBar buffered indicator smooth without flooding the IPC channel.
const BUFFERED_THROTTLE: Duration = Duration::from_millis(500); // 2 Hz

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
fn dispatch(
    app: &AppHandle,
    mpv: &Mpv,
    event: Event<'_>,
    last_time_pos: &mut Instant,
    last_buffered: &mut Instant,
    hwdec_logged: &mut bool,
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
            log::debug!("[player:events] FileLoaded → player://ready");
            let _ = app.emit("player://ready", ());
        }
        Event::PlaybackRestart => {
            // Fires after seeks AND after the decoder finishes its initial
            // setup on a new file. By this point hwdec-current reports the
            // selected backend ("d3d11va", "dxva2-copy", "no", etc.). Log
            // once per file so seeks don't spam.
            if !*hwdec_logged {
                let hwdec = mpv.get_property::<String>("hwdec-current")
                    .unwrap_or_else(|_| "<unavailable>".into());
                log::info!("[player:events] hwdec-current={} (playback-restart)", hwdec);
                *hwdec_logged = true;
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
            let r: u32 = reason as u32;
            log::debug!("[player:events] EndFile(reason={}) — diagnostic only", r);
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
            (REPLY_BUFFERED, PropertyData::Double(b)) => {
                let now = Instant::now();
                if now.duration_since(*last_buffered) >= BUFFERED_THROTTLE {
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
                if reached {
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
