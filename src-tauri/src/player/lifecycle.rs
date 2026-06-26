//! Player lifecycle helpers extracted from `mod.rs` (prexu-nlqf.8).
//!
//! These are the cohesive, self-contained steps of player init/teardown that
//! `PlayerState::ensure_init` and `PlayerState::destroy` orchestrate:
//!
//! - [`configure_mpv_properties`] — construct the `Mpv` handle with the baseline
//!   playback config (hwdec, vo, cache tuning, OSD off).
//! - [`spawn_teardown_task`] — background thread that joins the event pump and
//!   releases the final `Arc<Mpv>`.
//!
//! Extracting them keeps `mod.rs` focused on `PlayerState` orchestration and
//! state, and keeps each step independently readable. Behaviour and logging are
//! preserved byte-for-byte from the inline versions.

use std::sync::Arc;
use std::time::Instant;

use libmpv2::Mpv;
use tauri::AppHandle;

use super::Inner;

/// Construct the `Mpv` handle with our baseline playback config.
///
/// `wid` is the host HWND (as i64) mpv renders into — `Some` on Windows where a
/// native host window backs the player, `None` on other platforms. All other
/// properties (hwdec, vo, keep-open, OSD-off, cache tuning) are platform
/// independent and match the inline `ensure_init` config exactly.
///
/// `composition` (Path C3d) selects the render path:
///   - `false` (default): `vo=gpu-next` rendering into the host `wid` window.
///   - `true`: `vo=libmpv`, no `wid` — frames are pulled by a libmpv2
///     `RenderContext` on the video render thread and composited into the DComp
///     video visual. The `wid` argument is ignored in this mode.
/// Every other property (hwdec, keep-open, OSD, cursor, cache, af, subs) is
/// identical across both paths — only the video-output backend changes.
///
/// Splitting this out keeps the (long, comment-heavy) property block readable in
/// isolation; the perf-tuning rationale lives with the properties it explains.
pub(super) fn configure_mpv_properties(wid: Option<i64>, composition: bool) -> Result<Mpv, String> {
    Mpv::with_initializer(|init| {
        if composition {
            // Render-context path: mpv outputs through libmpv (no OS window).
            init.set_property("vo", "libmpv")?;
        } else {
            if let Some(wid) = wid {
                init.set_property("wid", wid)?;
            }
            init.set_property("vo", "gpu-next")?;
        }
        init.set_property("hwdec", "auto-safe")?;
        init.set_property("keep-open", "always")?;
        init.set_property("force-window", "no")?;
        init.set_property("volume-max", 200_i64)?;
        // Disable mpv's built-in OSD — we render our own UI in React.
        // Default osd-level=1 + osd-bar=yes draws a horizontal progress
        // bar in the middle of the video on every seek, which shows
        // through the transparent webview alongside our custom seek bar.
        init.set_property("osd-level", 0_i64)?;
        init.set_property("osd-bar", "no")?;
        // Never let mpv hide the OS cursor. mpv's `cursor-autohide` (default
        // 1000ms) calls ShowCursor(FALSE) on idle, driving the GLOBAL cursor
        // visibility counter negative. Under composition hosting (Path C) the
        // mpv host window never receives mouse moves, so it hides the cursor
        // once and never restores it — and our WebView2 SetCursor only sets the
        // cursor SHAPE, which cannot override ShowCursor visibility. The React
        // UI owns cursor show/hide (CSS `cursor: none`), so mpv must not touch it.
        init.set_property("cursor-autohide", "no")?;

        // ── Playback perf tuning ──
        // Bigger forward demuxer cache absorbs network hiccups on
        // remote Plex / mediocre Wi-Fi without re-buffering. Plex
        // direct-play streams over HTTP, so deeper read-ahead costs
        // only RAM, not CPU.
        //   - cache=yes              : explicit (default is already yes)
        //   - demuxer-readahead-secs : read 20s of video ahead
        //   - cache-secs             : keep 30s in the forward cache
        //   - cache-pause=no         : don't yank playback to paused
        //                              if the cache momentarily dips
        init.set_property("cache", "yes")?;
        init.set_property("demuxer-readahead-secs", 20_i64)?;
        init.set_property("cache-secs", 30_i64)?;
        init.set_property("cache-pause", "no")?;

        Ok(())
    })
    .map_err(|e| format!("mpv init failed: {:?}", e))
}

/// Spawn the background teardown thread for a taken `Inner`.
///
/// `destroy()` silences mpv synchronously (mute/pause/stop/quit) and then hands
/// `inner` to this thread so the slow parts run off the caller's await: joining
/// the event pump (which can take up to ~1s to break out of its
/// `wait_event(1.0)` loop after Shutdown) and dropping `Inner` — releasing the
/// final `Arc<Mpv>` and triggering `mpv_terminate_destroy` from the background.
///
/// `app` is retained for call-site symmetry; under composition hosting there is
/// no native host window to dispatch a teardown for.
#[allow(unused_variables)]
pub(super) fn spawn_teardown_task(mut inner: Inner, app: AppHandle) {
    std::thread::spawn(move || {
        if let Some(handle) = inner.event_pump.take() {
            log::info!("[player] destroy:bg joining event pump (unbounded)");
            let start = Instant::now();
            let _ = handle.join();
            log::info!(
                "[player] destroy:bg event pump joined in {}ms",
                start.elapsed().as_millis()
            );
        }
        log::info!(
            "[player] destroy:bg dropping Inner (Arc strong_count={})",
            Arc::strong_count(&inner.mpv)
        );
        // `inner` drops at end of closure. If pump released its Arc,
        // this is the last ref → mpv_terminate_destroy runs here.
    });
}
