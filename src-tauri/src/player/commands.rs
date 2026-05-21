//! Tauri commands exposing the native player to the React frontend.
//!
//! All commands wired through to libmpv (phase 1 steps 1.3, 1.4, 1.6 done).
//! Event-side reporting (time-pos, eof, …) lands with the event pump in 1.5.

use std::collections::HashMap;

use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(target_os = "windows")]
use tauri_plugin_store::StoreExt;

use super::PlayerState;

/// Path used for the pop-out player store. Kept separate from
/// `secure-store.json` (which holds auth tokens managed via the JS LazyStore)
/// so the Rust-side state and the frontend's secure data don't share a file
/// lock. Renamed from `mini-player.json` when the in-window minimize mode
/// landed alongside the floating pop-out mode; old files are not migrated —
/// existing users fall back to the defaults (bottom-right, 480x270) on first
/// pop-out after upgrade.
#[cfg(target_os = "windows")]
const POPOUT_STORE_PATH: &str = "popout-player.json";
#[cfg(target_os = "windows")]
const POPOUT_KEY_CORNER: &str = "popout.corner";
#[cfg(target_os = "windows")]
const POPOUT_KEY_SIZE: &str = "popout.size";

#[cfg(target_os = "windows")]
const POPOUT_DEFAULT_CORNER: &str = "bottom-right";
#[cfg(target_os = "windows")]
const POPOUT_DEFAULT_WIDTH: u32 = 480;
#[cfg(target_os = "windows")]
const POPOUT_DEFAULT_HEIGHT: u32 = 270;

#[tauri::command]
pub async fn player_load_url(
    url: String,
    headers: HashMap<String, String>,
    start_offset_ms: Option<u64>,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] load_url offset={}ms headers={}", start_offset_ms.unwrap_or(0), headers.len());
    state.ensure_init(&app)?;
    log::debug!("[player:cmd] load_url: ensure_init OK, sending loadfile");

    // mpv's `http-header-fields` takes a comma-separated list of "Name: Value"
    // entries. Plex headers (X-Plex-Token, X-Plex-Client-Identifier, …) don't
    // contain commas so naive joining is safe; if a value ever does contain a
    // comma we'd need to escape it as `\,` per the mpv string-list format.
    let header_str = headers
        .iter()
        .map(|(k, v)| format!("{}: {}", k, v))
        .collect::<Vec<_>>()
        .join(",");

    state.with_mpv(|mpv| {
        if !header_str.is_empty() {
            mpv.set_property("http-header-fields", header_str.as_str())?;
        }
        // 4th arg is comma-separated per-file options. `start=<seconds>` seeks
        // mpv to that offset on load (avoids a separate seek round-trip).
        let start_secs = start_offset_ms.map(|ms| ms as f64 / 1000.0).unwrap_or(0.0);
        let opts = format!("start={}", start_secs);
        mpv.command("loadfile", &[url.as_str(), "replace", "0", opts.as_str()])
    })
}

#[tauri::command]
pub async fn player_play(state: State<'_, PlayerState>) -> Result<(), String> {
    log::debug!("[player:cmd] play");
    state.with_mpv(|mpv| mpv.set_property("pause", false))
}

#[tauri::command]
pub async fn player_pause(state: State<'_, PlayerState>) -> Result<(), String> {
    log::debug!("[player:cmd] pause");
    state.with_mpv(|mpv| mpv.set_property("pause", true))
}

#[tauri::command]
pub async fn player_seek(
    seconds: f64,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] seek to {}s", seconds);
    state.with_mpv(|mpv| {
        let s = seconds.to_string();
        mpv.command("seek", &[s.as_str(), "absolute"])
    })
}

#[tauri::command]
pub async fn player_set_volume(
    vol: u16,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] set_volume {}", vol);
    state.with_mpv(|mpv| mpv.set_property("volume", vol as f64))
}

#[tauri::command]
pub async fn player_set_muted(
    muted: bool,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] set_muted {}", muted);
    state.with_mpv(|mpv| mpv.set_property("mute", muted))
}

#[tauri::command]
pub async fn player_set_audio_track(
    id: Option<i64>,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] set_audio_track {:?}", id);
    // mpv's `aid` accepts integer track ids OR the sentinel string "no".
    // libmpv2's set_property is monomorphic, so we branch at the call site.
    state.with_mpv(|mpv| match id {
        Some(track_id) => mpv.set_property("aid", track_id),
        None => mpv.set_property("aid", "no"),
    })
}

#[tauri::command]
pub async fn player_set_sub_track(
    id: Option<i64>,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] set_sub_track {:?}", id);
    state.with_mpv(|mpv| match id {
        Some(track_id) => mpv.set_property("sid", track_id),
        None => mpv.set_property("sid", "no"),
    })
}

/// Add an external subtitle file/URL (e.g. a Plex sidecar .srt) and select it.
/// mpv assigns the new track a fresh sid appended to the track list, leaving
/// existing embedded sid values stable. Pass the fully-qualified URL including
/// any auth tokens; mpv's HTTP fetch uses the same `http-header-fields` setup
/// as the main load.
#[tauri::command]
pub async fn player_load_external_sub(
    url: String,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    let preview = &url[..url.len().min(80)];
    log::info!("[player:cmd] load_external_sub url={}", preview);
    state.with_mpv(|mpv| mpv.command("sub-add", &[url.as_str(), "select"]))
}

#[tauri::command]
pub async fn player_set_audio_delay_ms(
    ms: i32,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] set_audio_delay {}ms", ms);
    // mpv's audio-delay is in seconds (f64), negatives allowed.
    let seconds = ms as f64 / 1000.0;
    state.with_mpv(|mpv| mpv.set_property("audio-delay", seconds))
}

/// libass subtitle style applied to text-format subs (SRT, VTT, ASS without
/// embedded styling). Mirrors the React `SubtitleStylePreferences` shape so
/// the same persisted prefs drive both libass on native and ::cue CSS on
/// HTML5. Sizes are mapped: `size` is a percentage (100 = mpv default 55pt),
/// `outline_width` is in pixels, `background_opacity` is 0..1 and combines
/// with `background_color` into mpv's `#RRGGBBAA` form.
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubStyle {
    pub size: f64,
    pub font_family: String,
    pub text_color: String,
    pub background_color: String,
    pub background_opacity: f64,
    pub outline_color: String,
    pub outline_width: f64,
    pub shadow_enabled: bool,
}

#[tauri::command]
pub async fn player_apply_sub_style(
    style: SubStyle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] apply_sub_style {:?}", style);
    let bg_alpha = (style.background_opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
    let bg_with_alpha = format!("{}{:02X}", style.background_color, bg_alpha);
    // mpv default sub-font-size is 55. Scale linearly with the user's
    // percentage so 100% matches mpv's out-of-the-box appearance.
    let font_size = 55.0_f64 * (style.size / 100.0);
    let shadow_offset = if style.shadow_enabled { 2.0 } else { 0.0 };
    state.with_mpv(|mpv| {
        mpv.set_property("sub-font", style.font_family.as_str())?;
        mpv.set_property("sub-font-size", font_size)?;
        mpv.set_property("sub-color", style.text_color.as_str())?;
        mpv.set_property("sub-border-color", style.outline_color.as_str())?;
        mpv.set_property("sub-border-size", style.outline_width)?;
        mpv.set_property("sub-back-color", bg_with_alpha.as_str())?;
        mpv.set_property("sub-shadow-offset", shadow_offset)?;
        Ok(())
    })
}

/// Audio filter-chain preset. Valid values: `"off"`, `"light"`, `"night"`.
///
/// The HLS/Web Audio path mirrors these presets via DynamicsCompressorNode in
/// `src/hooks/useAudioEnhancements.ts`. Keep the perceptual intent aligned —
/// see the NORMALIZATION_PRESETS comment in that file for the mapping notes.
#[tauri::command]
pub async fn player_set_af_chain(
    preset: String,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] set_af_chain preset={}", preset);
    let chain = match preset.as_str() {
        "off" => "",
        // light: gentle loudness normalization (LUFS -16) preserving dynamics
        // (LRA 11 LU). Transparent across mixed content; minimal coloration.
        "light" => "lavfi=[loudnorm=I=-16:TP=-1.5:LRA=11]",
        // night: moderate pre-compression (4:1, 50 ms release) followed by
        // loudness normalization (LUFS -18). Quiet dialogue stays audible
        // while loud action is tamed without pumping.
        "night" => "lavfi=[acompressor=threshold=-20dB:ratio=4:attack=5:release=50,loudnorm=I=-18]",
        other => return Err(format!("unknown af preset: {}", other)),
    };
    state.with_mpv(|mpv| mpv.set_property("af", chain))
}

#[tauri::command]
pub async fn player_unload(
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] unload");
    state.destroy(&app)
}

/// Toggle the Tauri main window's fullscreen state.
///
/// 1. Set a transition flag so the on_window_event listener skips
///    sync_geometry during the animated transition (avoids the rapid
///    SetWindowPos storm that crashes mpv's gpu-next vo).
/// 2. Toggle Tauri fullscreen.
/// 3. Wait for the transition to settle.
/// 4. Clear the flag, then dispatch a single explicit sync onto the
///    main thread (Win32 windows are thread-affine; cross-thread
///    SetWindowPos uses SendMessage and can be flaky during transient
///    states like fullscreen entry).
#[tauri::command]
pub async fn player_set_fullscreen(
    fullscreen: bool,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] set_fullscreen {}", fullscreen);
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    // Fast path: no mpv means nothing to sync. Used on Player unmount
    // after player_unload has torn down mpv — we just need the main
    // window out of fullscreen so the dashboard isn't stuck in it.
    // Skips the 350 ms transition wait and the geometry-sync closure
    // (both only exist to prevent mpv's D3D11 vo from crashing during
    // the resize storm; irrelevant when there's no mpv).
    if !state.is_initialised() {
        log::debug!("[player:cmd] set_fullscreen: no mpv, fast path");
        let fs_result = main
            .set_fullscreen(fullscreen)
            .map_err(|e| format!("set_fullscreen failed: {}", e));
        let actual_fs = main.is_fullscreen().unwrap_or(fullscreen);
        let _ = app.emit("player://fullscreen", actual_fs);
        return fs_result;
    }

    state.set_fullscreen_transition(true);
    let fs_result = main
        .set_fullscreen(fullscreen)
        .map_err(|e| format!("set_fullscreen failed: {}", e));

    // Dispatch the host geometry sync IMMEDIATELY on the main thread
    // (before the transition sleep) so the video catches up with the
    // overlay within a frame rather than lagging by the full 350 ms.
    // We use `apply_host_geometry` which bypasses the transition flag —
    // the flag stays set to suppress the Resized storm that fires during
    // Win11's animation (each Resized would otherwise trigger a D3D11
    // swapchain rebuild; 10+ in 300 ms reliably crashed mpv gpu-next,
    // per the comment on GEOMETRY_SYNC_MIN_INTERVAL). Fire-and-forget:
    // the main thread runs this on its next loop iteration.
    #[cfg(target_os = "windows")]
    {
        let app_for_sync = app.clone();
        let win_for_sync = main.clone();
        if let Err(e) = app.run_on_main_thread(move || {
            log::debug!("[player:cmd] set_fullscreen: early sync closure entered");
            let st = app_for_sync.state::<PlayerState>();
            match (win_for_sync.inner_position(), win_for_sync.inner_size()) {
                (Ok(pos), Ok(size)) => {
                    let (x, y, w, h) = (pos.x, pos.y, size.width as i32, size.height as i32);
                    log::info!("[player:cmd] set_fullscreen: early sync geometry ({},{},{}x{})", x, y, w, h);
                    st.apply_host_geometry(x, y, w, h);
                }
                _ => log::warn!("[player:cmd] set_fullscreen: failed to read geometry"),
            }
            let _ = win_for_sync.set_focus();
            log::debug!("[player:cmd] set_fullscreen: early sync closure done");
        }) {
            log::warn!("[player:cmd] set_fullscreen: early sync dispatch failed: {}", e);
        }
    }

    // Keep the transition flag set during Win11's animation to suppress
    // the Resized event burst. Clear afterwards so normal drag-resize
    // syncs work again. Still 350 ms — our video is no longer waiting on
    // this.
    log::debug!("[player:cmd] set_fullscreen: sleeping 350ms with flag set");
    tokio::time::sleep(std::time::Duration::from_millis(350)).await;
    state.set_fullscreen_transition(false);
    log::info!("[player:cmd] set_fullscreen: transition flag cleared");

    // Emit the authoritative fullscreen state back to the frontend so
    // React's isFullscreen stays in sync even when ESC or other OS gestures
    // exit fullscreen without going through toggleFullscreen().
    let actual_fs = main.is_fullscreen().unwrap_or(fullscreen);
    log::info!("[player:cmd] set_fullscreen: actual_fs={}, emitting", actual_fs);
    let _ = app.emit("player://fullscreen", actual_fs);

    fs_result
}

// ── Pop-out player commands (prexu-7il / Phase 4) ─────────────────────────
//
// Floating mini-window mode: shrinks the whole Tauri main window down to a
// corner of the user's current display, sets always-on-top, and resyncs the
// mpv host window. Distinct from the in-window "minimize" mode (prexu-7il.3)
// which keeps the main window full size but renders the player chrome in a
// small corner region of the WebView. The bugs prexu-cjo (maximize-while-
// popped-out) and prexu-buq (black border) belong to this mode.

/// Query the WORK AREA (desktop rect minus taskbar/docked toolbars) in
/// physical pixels for the monitor the given window currently lives on.
/// Uses `MonitorFromWindow` + `GetMonitorInfoW` so a pop-out triggered
/// from the secondary display lands on that secondary display, not the
/// primary one.
#[cfg(target_os = "windows")]
fn current_work_area(
    main: &tauri::WebviewWindow,
) -> Result<(i32, i32, i32, i32), String> {
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    let hwnd = main
        .hwnd()
        .map_err(|e| format!("get main hwnd failed: {}", e))?;
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info as *mut _).as_bool() {
            return Err("GetMonitorInfoW failed".to_string());
        }
        let r = info.rcWork;
        let x = r.left;
        let y = r.top;
        let w = r.right - r.left;
        let h = r.bottom - r.top;
        log::debug!(
            "[player:popout] current-monitor work area = ({},{},{}x{})",
            x, y, w, h
        );
        Ok((x, y, w, h))
    }
}

/// Load the persisted pop-out corner + size from the store, falling back to
/// the project defaults when no entry exists yet. Returns `(corner, width,
/// height)` ready to feed into `corner_origin`.
#[cfg(target_os = "windows")]
fn load_persisted_popout(app: &AppHandle) -> (String, u32, u32) {
    let mut corner = POPOUT_DEFAULT_CORNER.to_string();
    let mut width = POPOUT_DEFAULT_WIDTH;
    let mut height = POPOUT_DEFAULT_HEIGHT;
    if let Ok(store) = app.store(POPOUT_STORE_PATH) {
        if let Some(v) = store.get(POPOUT_KEY_CORNER) {
            if let Some(s) = v.as_str() {
                corner = s.to_string();
            }
        }
        if let Some(v) = store.get(POPOUT_KEY_SIZE) {
            if let (Some(w), Some(h)) = (
                v.get("width").and_then(|x| x.as_u64()),
                v.get("height").and_then(|x| x.as_u64()),
            ) {
                width = w as u32;
                height = h as u32;
            }
        }
    }
    log::debug!(
        "[player:popout] resolved persisted geometry corner={} size={}x{}",
        corner, width, height
    );
    (corner, width, height)
}

/// Read the Tauri main window's outer rect via Win32 `GetWindowRect` and
/// return `(x, y, width, height)`. We stash this on `enter_popout` and
/// re-apply it on `exit_popout` via `write_window_rect` so the round-trip
/// uses one coordinate system and the window snaps back to exactly where
/// it started (prexu-bm0).
///
/// We bypass Tauri's `WebviewWindow::outer_position` / `outer_size` here
/// because they go through tao, which on Win11 mixes GetWindowRect output
/// with logical/inner sizing math. Combined with Win11's invisible DWM
/// resize borders (`GetWindowRect` includes them but `set_size` does not
/// expect them), a stash via tao + restore via tao drifts by ~7 px per
/// cycle, growing the window each enter/exit. Going through pure Win32
/// removes the asymmetry — `GetWindowRect` and `SetWindowPos` operate
/// on the same outer rect that includes the invisible borders.
#[cfg(target_os = "windows")]
fn read_window_rect(
    main: &tauri::WebviewWindow,
) -> Result<(i32, i32, i32, i32), String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let hwnd = main
        .hwnd()
        .map_err(|e| format!("get main hwnd failed: {}", e))?;
    let mut rect = RECT::default();
    unsafe {
        GetWindowRect(hwnd, &mut rect as *mut _)
            .map_err(|e| format!("GetWindowRect failed: {:?}", e))?;
    }
    Ok((
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top,
    ))
}

/// Apply an outer rect to the Tauri main window via Win32 `SetWindowPos`.
/// Paired with `read_window_rect` to round-trip pre-popout geometry
/// exactly (prexu-bm0).
#[cfg(target_os = "windows")]
fn write_window_rect(
    main: &tauri::WebviewWindow,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };
    let hwnd = main
        .hwnd()
        .map_err(|e| format!("get main hwnd failed: {}", e))?;
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER,
        )
        .map_err(|e| format!("SetWindowPos failed: {:?}", e))
    }
}

/// Compute the (x, y) origin for a `(width, height)` window snapped to
/// `corner` of the work area `(wx, wy, ww, wh)`. Width/height are clamped
/// against the work-area dimensions so a too-large request still fits.
#[cfg(target_os = "windows")]
fn corner_origin(
    corner: &str,
    width: u32,
    height: u32,
    wx: i32,
    wy: i32,
    ww: i32,
    wh: i32,
) -> Result<(i32, i32, u32, u32), String> {
    let w = (width as i32).min(ww).max(1) as u32;
    let h = (height as i32).min(wh).max(1) as u32;
    let (x, y) = match corner {
        "top-left" => (wx, wy),
        "top-right" => (wx + ww - w as i32, wy),
        "bottom-left" => (wx, wy + wh - h as i32),
        "bottom-right" => (wx + ww - w as i32, wy + wh - h as i32),
        other => return Err(format!("unknown corner: {}", other)),
    };
    Ok((x, y, w, h))
}

/// Enter pop-out mode: resize+reposition the Tauri main window to a corner
/// of the current display's work area, set always-on-top, and resync the
/// mpv host window. The pre-pop-out outer geometry of the main window is
/// stashed in `PlayerState::pre_popout_geometry` for `player_exit_popout`
/// to restore.
///
/// All args are `Option` so the frontend can pass `undefined` to mean "use
/// the persisted geometry from `popout-player.json`". When the store is
/// empty (first run on this profile), `POPOUT_DEFAULT_*` are used. The hook
/// typically calls this with no args after the first session.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_enter_popout(
    corner: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    let (saved_corner, saved_w, saved_h) = load_persisted_popout(&app);
    let corner = corner.unwrap_or(saved_corner);
    let width = width.unwrap_or(saved_w);
    let height = height.unwrap_or(saved_h);
    log::info!(
        "[player:cmd] enter_popout corner={} size={}x{}",
        corner,
        width,
        height
    );
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    // Clear any minimize inset BEFORE doing any geometry work (prexu-wow).
    // Pop-out and minimize are mutually exclusive (7il.4 design); without
    // this, a frontend race between playerExitMinimize and playerEnterPopOut
    // can leave state.minimize=Some while we apply the popout geometry,
    // causing the SetWindowPos resize storm to read the stale inset and
    // shrink the host to the bottom-right corner of the new popout window.
    // Clearing here is authoritative — subsequent Resized events from the
    // window resize will all see minimize=None and skip apply_minimize_inset.
    if let Ok(mut mz) = state.minimize.lock() {
        if mz.is_some() {
            log::debug!("[player:popout] clearing leftover minimize inset on enter");
        }
        *mz = None;
    }

    let (wx, wy, ww, wh) = current_work_area(&main)?;
    let (x, y, w, h) = corner_origin(&corner, width, height, wx, wy, ww, wh)?;

    // Stash the current OUTER rect via Win32 GetWindowRect (prexu-bm0).
    // Captured + restored through the same Win32 API so the round-trip is
    // exact — Tauri's outer_size/outer_position go through tao which
    // disagrees with SetWindowPos by ~7 px due to Win11's invisible DWM
    // resize borders, causing the window to grow on each enter/exit cycle.
    match read_window_rect(&main) {
        Ok((rx, ry, rw, rh)) => {
            let stash = (rx, ry, rw as u32, rh as u32);
            if let Ok(mut g) = state.pre_popout_geometry.lock() {
                *g = Some(stash);
                log::debug!(
                    "[player:popout] stashed pre-popout outer geometry ({},{},{}x{}) via GetWindowRect",
                    stash.0, stash.1, stash.2, stash.3
                );
            }
        }
        Err(e) => log::warn!("[player:popout] read_window_rect for stash failed: {}", e),
    }

    // Apply window changes via Win32 SetWindowPos (matches GetWindowRect's
    // coordinate system; see read_window_rect doc). set_always_on_top stays
    // on Tauri because that API call also flips WS_EX_TOPMOST on the
    // WebView's ancestor chain, not just the main HWND. We leave the
    // window resizable (tauri.conf.json `resizable: true`) so the user can
    // grab the top-left corner of the floating window; the new size is
    // persisted in `player_exit_popout` so the next entry restores it.
    main.set_always_on_top(true)
        .map_err(|e| format!("set_always_on_top failed: {}", e))?;
    write_window_rect(&main, x, y, w as i32, h as i32)
        .map_err(|e| format!("popout geometry apply failed: {}", e))?;

    log::debug!(
        "[player:popout] resized main to ({},{},{}x{}); resynced host",
        x, y, w, h
    );

    // Resync the host immediately. The on_window_event listener will also
    // fire from the resize, but it goes through the throttle; an explicit
    // apply guarantees the video window is in place by the time the command
    // returns.
    if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
        state.apply_host_geometry(pos.x, pos.y, size.width as i32, size.height as i32);
    }

    // Mark the mpv host window topmost too. Tauri's set_always_on_top on
    // the main window only flips that flag for the WebView's HWND — the
    // host is a sibling top-level so it stays in the regular z-order,
    // letting other apps render between the always-on-top WebView and
    // the video underneath. Anchor below main inside the topmost group
    // so the WebView still overlays the video region.
    if let Ok(parent) = main.hwnd() {
        state.apply_host_topmost(true, Some(parent));
    } else {
        state.apply_host_topmost(true, None);
    }

    // Persist the chosen corner + size for next session. A failure here is
    // not fatal — the user can re-enter pop-out and we'll save again.
    match app.store(POPOUT_STORE_PATH) {
        Ok(store) => {
            store.set(POPOUT_KEY_CORNER, serde_json::Value::String(corner.clone()));
            store.set(
                POPOUT_KEY_SIZE,
                serde_json::json!({ "width": w, "height": h }),
            );
            if let Err(e) = store.save() {
                log::warn!("[player:popout] store save failed: {:?}", e);
            } else {
                log::debug!(
                    "[player:popout] persisted corner={} size={}x{}",
                    corner, w, h
                );
            }
        }
        Err(e) => log::warn!("[player:popout] store open failed: {:?}", e),
    }

    Ok(())
}

/// Exit pop-out mode: clear always-on-top and restore the main window to
/// the outer geometry stashed by `player_enter_popout`. If no stash exists
/// (e.g. exit called without a prior enter), this clears always-on-top and
/// returns Ok without resizing.
///
/// Persistence: BEFORE restoring, we read the main window's current outer
/// size and write it back to the store under `POPOUT_KEY_SIZE`. This is
/// how user-driven resizes (dragging the top-left corner while the pop-out
/// is open) round-trip across sessions — the next `player_enter_popout`
/// with no args reads this saved size via `load_persisted_popout`.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_exit_popout(
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] exit_popout");
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    // Capture the user's current size BEFORE restoring so any post-enter
    // resize is preserved. Read via Win32 GetWindowRect so the stored value
    // matches what SetWindowPos on a subsequent enter will receive (prexu-bm0).
    match read_window_rect(&main) {
        Ok((_, _, rw, rh)) => match app.store(POPOUT_STORE_PATH) {
            Ok(store) => {
                store.set(
                    POPOUT_KEY_SIZE,
                    serde_json::json!({ "width": rw, "height": rh }),
                );
                if let Err(e) = store.save() {
                    log::warn!("[player:popout] resize-on-exit save failed: {:?}", e);
                } else {
                    log::debug!(
                        "[player:popout] persisted resized size {}x{} on exit",
                        rw, rh
                    );
                }
            }
            Err(e) => log::warn!("[player:popout] resize-on-exit store open failed: {:?}", e),
        },
        Err(e) => log::warn!("[player:popout] resize-on-exit read failed: {}", e),
    }

    main.set_always_on_top(false)
        .map_err(|e| format!("set_always_on_top(false) failed: {}", e))?;

    // Clear topmost on the mpv host window AND re-anchor it below the
    // WebView (prexu-0c6). Passing Some(parent) here is load-bearing:
    // SetWindowPos(HWND_NOTOPMOST) alone leaves the host above normal-
    // z-order siblings, so after exit the host floats over the WebView
    // and the app becomes uninteractable. Anchoring below puts it back
    // in its correct place underneath the WebView pixels.
    let parent_hwnd = main.hwnd().ok();
    state.apply_host_topmost(false, parent_hwnd);

    let stash = state
        .pre_popout_geometry
        .lock()
        .ok()
        .and_then(|mut g| g.take());

    let Some((x, y, w, h)) = stash else {
        log::debug!("[player:popout] exit_popout: no stash, only cleared always-on-top");
        return Ok(());
    };

    write_window_rect(&main, x, y, w as i32, h as i32)
        .map_err(|e| format!("popout restore apply failed: {}", e))?;

    log::debug!(
        "[player:popout] restored main to ({},{},{}x{}) via SetWindowPos; resynced host",
        x, y, w, h
    );

    if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
        state.apply_host_geometry(pos.x, pos.y, size.width as i32, size.height as i32);
    }

    Ok(())
}

// ── In-window minimize commands (prexu-7il.2) ─────────────────────────────
//
// Keeps the Tauri main window full size and only constrains the mpv host
// to a small bottom-right inset of the WebView client area. The rest of
// the WebView remains interactive so the user can browse the Library,
// check cast/crew, etc. while the small video region keeps playing in the
// corner. The in-window chrome lands in prexu-7il.3; this just establishes
// the IPC + state-management seam.

#[cfg(target_os = "windows")]
const MINIMIZE_DEFAULT_PADDING: u32 = 16;

/// Enter minimize mode: store the (width, height, padding) of the desired
/// inset rect in PlayerState and force a host resync so the mpv window
/// shrinks to the bottom-right of the current WebView client area.
///
/// Mutual exclusion with pop-out is handled at the React button layer
/// (7il.4) so the IPC contract stays simple — this command itself does
/// not touch popout state. Calling it while popped-out will inset the
/// host within the small popout window's client rect, which is harmless
/// but not user-facing once the buttons coordinate things.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_enter_minimize(
    width: u32,
    height: u32,
    padding: Option<u32>,
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    let padding = padding.unwrap_or(MINIMIZE_DEFAULT_PADDING);
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    // DPI scaling (prexu-7a2). The frontend passes width/height/padding in
    // CSS (logical) pixels so the mini chrome and the AppLayout mask hole
    // are sized consistently across DPI scales. Tauri's inner_size /
    // inner_position are physical pixels, and our apply_minimize_inset
    // math runs in that physical-px space — so we scale up the CSS units
    // here once on entry. ScaleFactorChanged while minimized (rare cross-
    // monitor case) is not currently handled; the host would render at
    // the old DPI's pixel sizes until exit/re-enter.
    let scale = main.scale_factor().unwrap_or(1.0);
    let width_phys = ((width as f64) * scale).round() as u32;
    let height_phys = ((height as f64) * scale).round() as u32;
    let padding_phys = ((padding as f64) * scale).round() as u32;
    log::info!(
        "[player:cmd] enter_minimize size={}x{} padding={} scale={:.2} → physical {}x{} pad={}",
        width, height, padding, scale, width_phys, height_phys, padding_phys
    );

    if let Ok(mut mz) = state.minimize.lock() {
        *mz = Some((width_phys, height_phys, padding_phys));
    } else {
        return Err("minimize lock poisoned".to_string());
    }

    // Force resync now so the host shrinks immediately rather than waiting
    // for the next window event. apply_host_geometry honors the inset.
    if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
        state.apply_host_geometry(pos.x, pos.y, size.width as i32, size.height as i32);
    }
    Ok(())
}

/// Exit minimize mode: clear the inset and force a host resync so the
/// mpv window expands back to the full WebView client area.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_exit_minimize(
    app: AppHandle,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!("[player:cmd] exit_minimize");
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main webview window not found".to_string())?;

    if let Ok(mut mz) = state.minimize.lock() {
        *mz = None;
    } else {
        return Err("minimize lock poisoned".to_string());
    }

    if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
        state.apply_host_geometry(pos.x, pos.y, size.width as i32, size.height as i32);
    }
    Ok(())
}

// Non-Windows stubs so the command names exist for the JS bridge but the
// platform that hasn't been ported yet (macOS / Linux) returns a clear error
// instead of failing at the IPC layer with "command not found". Keeps the
// frontend code path uniform; cross-platform pop-out / minimize lands in
// prexu-efy (Phase 5 research).
#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn player_enter_minimize(
    _width: u32,
    _height: u32,
    _padding: Option<u32>,
) -> Result<(), String> {
    log::warn!("[player:cmd] enter_minimize called on non-Windows platform");
    Err("minimize mode is only supported on Windows in Phase 4".into())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn player_exit_minimize() -> Result<(), String> {
    log::warn!("[player:cmd] exit_minimize called on non-Windows platform");
    Err("minimize mode is only supported on Windows in Phase 4".into())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn player_enter_popout(
    _corner: Option<String>,
    _width: Option<u32>,
    _height: Option<u32>,
) -> Result<(), String> {
    log::warn!("[player:cmd] enter_popout called on non-Windows platform");
    Err("pop-out mode is only supported on Windows in Phase 4".into())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn player_exit_popout() -> Result<(), String> {
    log::warn!("[player:cmd] exit_popout called on non-Windows platform");
    Err("pop-out mode is only supported on Windows in Phase 4".into())
}
