//! Read-only native observations. Never return media paths or mpv errors.
use libmpv2::Mpv;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub initialized: bool,
    pub idle: bool,
    pub fixture_matches: bool,
    pub position_ms: Option<f64>,
    pub paused: Option<bool>,
    pub audio_track: Option<i64>,
    pub subtitle_track: Option<i64>,
    pub playback_rate: Option<f64>,
    pub muted: Option<bool>,
    pub audio_delay: Option<f64>,
    pub subtitle_scale: Option<f64>,
}

impl Snapshot {
    pub fn absent() -> Self {
        Self {
            initialized: false,
            idle: true,
            fixture_matches: false,
            position_ms: None,
            paused: None,
            audio_track: None,
            subtitle_track: None,
            playback_rate: None,
            muted: None,
            audio_delay: None,
            subtitle_scale: None,
        }
    }
}

/// Caller retains the sampled handle for the duration of these property reads.
/// Missing properties stay unknown; they must never become successful defaults.
/// The caller must observe an absent player before dispatching a new play. This
/// is a live sample, not a load acknowledgement or proof of visible output.
pub fn sample(mpv: &Mpv, expected_path: &str) -> Snapshot {
    let idle = mpv.get_property::<bool>("idle-active").unwrap_or(false);
    let fixture_matches = !idle
        && mpv
            .get_property::<String>("path")
            .is_ok_and(|path| path.split('?').next() == Some(expected_path));
    let position_ms = mpv
        .get_property::<f64>("time-pos")
        .ok()
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|seconds| seconds * 1000.0);
    let subtitle_track = match mpv.get_property::<String>("sid").ok().as_deref() {
        Some("no") => Some(0),
        Some(value) => value.parse::<i64>().ok().filter(|id| *id > 0),
        None => None,
    };
    Snapshot {
        initialized: true,
        idle,
        fixture_matches,
        position_ms,
        paused: mpv.get_property::<bool>("pause").ok(),
        audio_track: mpv.get_property::<i64>("aid").ok().filter(|id| *id > 0),
        subtitle_track,
        playback_rate: mpv.get_property::<f64>("speed").ok(),
        muted: mpv.get_property::<bool>("mute").ok(),
        audio_delay: mpv.get_property::<f64>("audio-delay").ok(),
        subtitle_scale: mpv.get_property::<f64>("sub-scale").ok(),
    }
}
