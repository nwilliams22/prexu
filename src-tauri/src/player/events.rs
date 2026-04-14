//! Event pump — drives a background thread that polls libmpv's event queue
//! and re-emits playback state changes to the frontend via `app.emit(...)`.
//!
//! Phase 1 placeholder. The thread, property observers, and emit calls are
//! wired in the FFI commit. Frontend event names reserved:
//!
//! - `player://time-pos`   — f64 current playback time in seconds (throttled to 4 Hz)
//! - `player://duration`   — f64 media duration in seconds
//! - `player://paused`     — bool
//! - `player://buffering`  — bool
//! - `player://eof`        — fired on end-of-file
//! - `player://error`      — string error message
//! - `player://tracks`     — JSON array of track descriptors
//! - `player://ready`      — fired once the file is loaded and decodable
