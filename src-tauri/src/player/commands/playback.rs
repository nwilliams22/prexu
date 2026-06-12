//! Tauri commands exposing the native player to the React frontend.

use std::collections::HashMap;

use tauri::{AppHandle, State};

use crate::player::{PlayerState, TimelineCtx};

/// Quote one argument for libmpv2's `command()`. The crate joins args with
/// spaces into a single flat command string (mpv_command_string), so a file
/// path containing spaces gets split into bogus extra arguments and mpv
/// rejects the command with MPV_ERROR_INVALID_PARAMETER (-4). mpv's flat
/// syntax accepts double-quoted arguments with JSON/C-style escaping.
fn mpv_quote(arg: &str) -> String {
    let escaped = arg.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{}\"", escaped)
}

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
        mpv.command("loadfile", &[mpv_quote(&url).as_str(), "replace", "0", opts.as_str()])?;
        // Belt-and-braces unpause (prexu-7fe.1). stop_playback ALSO sets
        // pause=false before its `stop` command, but in retest logs the
        // first post-EOF handoff sometimes left mpv paused — the pre-stop
        // pause-change either wasn't observed or got coalesced with the
        // stop's state wipe, so the new file inherited pause=true and sat
        // there until the user manually clicked play. Setting pause=false
        // here, AFTER loadfile, applies to the new file's live playback
        // engine context. Idempotent on cold start (pause is already
        // false) and on autoplay handoff (pause was just cleared).
        mpv.set_property("pause", false)
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
    state.with_mpv(|mpv| mpv.command("sub-add", &[mpv_quote(&url).as_str(), "select"]))
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

/// libass wants a single font family name, but the frontend sends a CSS
/// font-family list ("'Courier New', monospace") shared with the HTML5
/// ::cue path. A list (or a quoted name) fails libass's DirectWrite lookup
/// and silently falls back to the default font — take the first entry,
/// strip quotes, and map the CSS generic families to fonts that actually
/// exist on Windows.
fn css_font_to_family(css: &str) -> String {
    let first = css.split(',').next().unwrap_or(css).trim();
    let name = first.trim_matches(|c| c == '\'' || c == '"').trim();
    match name.to_ascii_lowercase().as_str() {
        // mpv's own sub-font default — reproduces the stock look.
        "sans-serif" => "sans-serif".to_string(),
        "serif" => "Times New Roman".to_string(),
        "monospace" => "Consolas".to_string(),
        _ => name.to_string(),
    }
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
    let font = css_font_to_family(&style.font_family);
    log::debug!("[player:cmd] sub-font resolved '{}' -> '{}'", style.font_family, font);
    state.with_mpv(|mpv| {
        mpv.set_property("sub-font", font.as_str())?;
        mpv.set_property("sub-font-size", font_size)?;
        mpv.set_property("sub-color", style.text_color.as_str())?;
        mpv.set_property("sub-border-color", style.outline_color.as_str())?;
        mpv.set_property("sub-border-size", style.outline_width)?;
        mpv.set_property("sub-back-color", bg_with_alpha.as_str())?;
        mpv.set_property("sub-shadow-offset", shadow_offset)?;
        Ok(())
    })
}

/// Register the close-time timeline report context for the current playback
/// (prexu-50f). Rust fires the final `state=stopped` report from this if the
/// window closes before the JS cleanup can run. Token intentionally not
/// logged.
#[tauri::command]
pub async fn player_set_timeline_context(
    ctx: TimelineCtx,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::info!(
        "[player:cmd] set_timeline_context ratingKey={} durationMs={}",
        ctx.rating_key,
        ctx.duration_ms
    );
    state.set_timeline_ctx(Some(ctx));
    Ok(())
}

/// Clear the close-time report context — called after the frontend has sent
/// its own route-exit stopped report so Rust doesn't send a stale duplicate
/// at a later window close.
#[tauri::command]
pub async fn player_clear_timeline_context(
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    log::debug!("[player:cmd] clear_timeline_context");
    state.set_timeline_ctx(None);
    Ok(())
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

/// Soft stop — clear mpv's current file but keep the mpv handle + host
/// window alive for the next `loadfile`. Drives the per-episode handoff
/// path so React's `[ratingKey]` effect cleanup no longer destroys mpv
/// every time the user advances to the next episode (prexu-7fe).
///
/// Episode handoff cost before this: ~1s destroy (event pump join + mpv
/// terminate + HostWindow drop) + new ensure_init (~50ms HostWindow
/// create + 12s hwdec probe on first run, ~100ms otherwise) + DXGI swap
/// chain rebuild. After: ~ms mute + mpv `stop` + loadfile on the same
/// instance.
///
/// `player_unload` (full destroy) is still the right call on actual
/// player-route unmount (back to dashboard, navigation away). TS keeps
/// that path; only the per-episode cleanup switched to `player_stop`.
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn player_stop(state: State<'_, PlayerState>) -> Result<(), String> {
    log::info!("[player:cmd] stop");
    state.stop_playback()
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn player_stop() -> Result<(), String> {
    log::warn!("[player:cmd] stop called on non-Windows platform");
    Err("native player not supported on this platform".into())
}

#[cfg(test)]
mod tests {
    use super::{css_font_to_family, mpv_quote};

    #[test]
    fn takes_first_family_and_strips_quotes() {
        assert_eq!(css_font_to_family("'Courier New', monospace"), "Courier New");
        assert_eq!(css_font_to_family("\"Georgia\", serif"), "Georgia");
        assert_eq!(css_font_to_family("Verdana, sans-serif"), "Verdana");
        assert_eq!(css_font_to_family("Arial, sans-serif"), "Arial");
    }

    #[test]
    fn maps_css_generics_to_windows_fonts() {
        assert_eq!(css_font_to_family("sans-serif"), "sans-serif");
        assert_eq!(css_font_to_family("serif"), "Times New Roman");
        assert_eq!(css_font_to_family("monospace"), "Consolas");
    }

    #[test]
    fn passes_plain_names_through() {
        assert_eq!(css_font_to_family("Verdana"), "Verdana");
        assert_eq!(css_font_to_family("  Segoe UI  "), "Segoe UI");
    }

    #[test]
    fn quotes_paths_with_spaces() {
        assert_eq!(
            mpv_quote(r"C:\Videos\A Good Girls Guide S02E06.mkv"),
            r#""C:\\Videos\\A Good Girls Guide S02E06.mkv""#
        );
    }

    #[test]
    fn escapes_embedded_quotes() {
        assert_eq!(mpv_quote(r#"a"b"#), r#""a\"b""#);
    }

    #[test]
    fn leaves_urls_intact_inside_quotes() {
        assert_eq!(
            mpv_quote("https://example.com/library/parts/1/file.mkv?X-Plex-Token=t"),
            "\"https://example.com/library/parts/1/file.mkv?X-Plex-Token=t\""
        );
    }
}
