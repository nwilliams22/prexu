//! Tauri commands exposing the native player to the React frontend.
//!
//! All commands wired through to libmpv (phase 1 steps 1.3, 1.4, 1.6 done).
//! Event-side reporting (time-pos, eof, …) lands with the event pump in 1.5.

use std::collections::HashMap;

use tauri::{AppHandle, State};

use crate::player::PlayerState;

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
