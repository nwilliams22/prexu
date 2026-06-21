//! Player lifecycle helpers extracted from `mod.rs` (prexu-nlqf.8).
//!
//! These are the cohesive, self-contained steps of player init/teardown that
//! `PlayerState::ensure_init` and `PlayerState::destroy` orchestrate:
//!
//! - [`create_host_window`] — build the native mpv host HWND on the Tauri main
//!   thread (Windows-only).
//! - [`configure_mpv_properties`] — construct the `Mpv` handle with the baseline
//!   playback config (hwdec, vo, cache tuning, OSD off).
//! - [`spawn_teardown_task`] — background thread that joins the event pump,
//!   drops the host on the main thread, and releases the final `Arc<Mpv>`.
//!
//! Extracting them keeps `mod.rs` focused on `PlayerState` orchestration and
//! state, and keeps each step independently readable. Behaviour and logging are
//! preserved byte-for-byte from the inline versions.

use std::sync::Arc;
use std::time::Instant;

use libmpv2::Mpv;
use tauri::AppHandle;

#[cfg(target_os = "windows")]
use tauri::Manager;

#[cfg(target_os = "windows")]
use super::host_window;
#[cfg(target_os = "windows")]
use super::initial_host_geometry;
#[cfg(target_os = "windows")]
use super::MinimizeState;

use super::Inner;

/// Create the native mpv host window on the Tauri MAIN THREAD and apply its
/// initial geometry / visibility / z-order.
///
/// Win32 windows are thread-affine: a window's WndProc runs on the thread that
/// called CreateWindow. SetWindowPos from another thread does a cross-thread
/// SendMessage and waits for the owner to pump messages. Tauri's main thread
/// pumps Win32 messages; tokio worker threads (which run `#[tauri::command]
/// async fn`) do not. If the host were created on a tokio worker, the Tauri
/// main thread's on_window_event → sync_geometry → SetWindowPos would block
/// indefinitely (proven by log at 2026-04-19 23:12:30 where the main-thread
/// closure hung inside set_geometry, freezing IPC so that a subsequent
/// back-click's player_unload never reached the backend while mpv kept playing
/// audio).
///
/// Called from `ensure_init` on a tokio worker (async command); the main thread
/// is alive and will service the queued closure, so blocking on `rx.recv` is
/// safe. `minimize_snapshot` / `scale_snapshot` are pre-captured so the
/// `'static + Send` closure can compute the mini-inset rect without `&self`.
#[cfg(target_os = "windows")]
pub(super) fn create_host_window(
    app: &AppHandle,
    minimize_snapshot: Option<MinimizeState>,
    scale_snapshot: f64,
) -> Result<host_window::HostWindow, String> {
    let app_for_spawn = app.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let result: Result<host_window::HostWindow, String> = (|| {
            let main = app_for_spawn
                .get_webview_window("main")
                .ok_or_else(|| "main webview window not found".to_string())?;
            let parent = main
                .hwnd()
                .map_err(|e| format!("Failed to get main HWND: {}", e))?;
            // Path A spike (prexu-ga3x.1): PREXU_MPV_CHILD swaps the shipping
            // WS_POPUP sibling for a real WS_CHILD of the main window, so mpv
            // joins the main window's DWM surface (Alt+Tab/WGC capture test).
            let spike_child = std::env::var_os("PREXU_MPV_CHILD").is_some();
            let host = if spike_child {
                log::warn!("[player:host] PREXU_MPV_CHILD set — WS_CHILD spike mode (controls hidden by airspace; capture-test only)");
                host_window::HostWindow::create_child(parent)?
            } else {
                host_window::HostWindow::create(parent)?
            };
            log::info!("[player:host] created on main, parent={:?}, child={}", parent.0, host.is_child());

            if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
                let (gx, gy, gw, gh) = initial_host_geometry(
                    minimize_snapshot,
                    scale_snapshot,
                    pos.x,
                    pos.y,
                    size.width as i32,
                    size.height as i32,
                );
                let _ = host.set_geometry(gx, gy, gw, gh);
                log::debug!(
                    "[player] initial geometry sync to ({},{},{}x{}){}",
                    gx, gy, gw, gh,
                    if minimize_snapshot.is_some() { " (mini-inset)" } else { "" }
                );
            }
            let _ = host.set_visible(true);
            log::debug!("[player:host] set visible");
            if host.is_child() {
                // Spike: force the child above wry's webview sibling so mpv
                // pixels are actually visible (covers controls by design).
                if let Err(e) = host.raise_to_top() {
                    log::warn!("[player:host] raise_to_top failed: {}", e);
                }
            }
            // Re-anchor z-order below main. SW_SHOWNA shouldn't
            // raise it, but this is belt-and-suspenders to ensure
            // the host never covers the WebView.
            if let Err(e) = host.anchor_below(parent) {
                log::warn!("[player:host] anchor_below failed: {}", e);
            } else {
                log::debug!("[player:host] anchored below parent");
            }
            Ok(host)
        })();
        let _ = tx.send(result);
    })
    .map_err(|e| format!("run_on_main_thread for host create failed: {:?}", e))?;
    rx.recv()
        .map_err(|e| format!("host create channel recv failed: {}", e))?
}

/// Construct the `Mpv` handle with our baseline playback config.
///
/// `wid` is the host HWND (as i64) mpv renders into — `Some` on Windows where a
/// native host window backs the player, `None` on other platforms. All other
/// properties (hwdec, vo, keep-open, OSD-off, cache tuning) are platform
/// independent and match the inline `ensure_init` config exactly.
///
/// Splitting this out keeps the (long, comment-heavy) property block readable in
/// isolation; the perf-tuning rationale lives with the properties it explains.
pub(super) fn configure_mpv_properties(wid: Option<i64>) -> Result<Mpv, String> {
    Mpv::with_initializer(|init| {
        if let Some(wid) = wid {
            init.set_property("wid", wid)?;
        }
        init.set_property("hwdec", "auto-safe")?;
        init.set_property("vo", "gpu-next")?;
        init.set_property("keep-open", "always")?;
        init.set_property("force-window", "no")?;
        init.set_property("volume-max", 200_i64)?;
        // Disable mpv's built-in OSD — we render our own UI in React.
        // Default osd-level=1 + osd-bar=yes draws a horizontal progress
        // bar in the middle of the video on every seek, which shows
        // through the transparent webview alongside our custom seek bar.
        init.set_property("osd-level", 0_i64)?;
        init.set_property("osd-bar", "no")?;

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
/// `inner` to this thread so the slow parts run off the caller's await:
/// joining the event pump (which can take up to ~1s to break out of its
/// `wait_event(1.0)` loop after Shutdown), dispatching the `HostWindow` drop
/// back to the main thread (DestroyWindow is thread-affine), and dropping
/// `Inner` — releasing the final `Arc<Mpv>` and triggering
/// `mpv_terminate_destroy` from the background.
///
/// `HostWindow` is `unsafe impl Send` (host_window.rs), so moving `inner` into
/// the thread is sound; its drop is re-dispatched to the main thread.
///
/// `app` is only used on Windows (to dispatch the host drop); on other
/// platforms there is no native host window to tear down.
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))]
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
        #[cfg(target_os = "windows")]
        if let Some(host) = inner.host.take() {
            log::info!("[player] destroy:bg dispatching host drop to main thread");
            if let Err(e) = app.run_on_main_thread(move || {
                drop(host);
                log::info!("[player:host] dropped on main thread");
            }) {
                log::warn!(
                    "[player] destroy:bg run_on_main_thread for host drop failed: {:?} (host leaked)",
                    e
                );
            }
        }
        log::info!(
            "[player] destroy:bg dropping Inner (Arc strong_count={})",
            Arc::strong_count(&inner.mpv)
        );
        // `inner` drops at end of closure. If pump released its Arc,
        // this is the last ref → mpv_terminate_destroy runs here.
    });
}
