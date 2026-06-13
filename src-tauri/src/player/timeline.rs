//! Rust-side close-time Plex timeline reporter.
//!
//! When the main window closes mid-playback the JS `unmount` cleanup is
//! unreliable during WebView teardown, so the frontend registers a
//! [`TimelineCtx`] once per playback (via `player_set_timeline_ctx`) and
//! clears it after its own route-exit report.  On `WindowEvent::CloseRequested`
//! [`PlayerState::report_stopped_on_close`] takes the context (one-shot) and
//! fires the final `state=stopped` timeline GET.
//!
//! HTTP logic lives here; network I/O runs on a spawned thread so the main
//! thread is not blocked during window close (prexu-bgz.9).

use std::time::Duration;

use super::CLOSE_REPORT_JOIN_BUDGET;

// ── Data types ───────────────────────────────────────────────────────────────

/// Connection + item details for the Rust-side close-time timeline report.
/// Mirrors the params the TS `reportTimeline` sends; the position comes from
/// mpv's `time-pos` at close time.  The token is held in memory only and is
/// never logged.
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineCtx {
    pub server_uri: String,
    pub token: String,
    pub rating_key: String,
    pub duration_ms: u64,
    pub client_id: String,
}

// ── Request builder ──────────────────────────────────────────────────────────

/// Pure helper: build the URL + query pairs for the final `state=stopped`
/// timeline GET.  Extracted from `report_stopped_on_close` so the network
/// thread captures only owned plain data (no `&self`) and the request shape
/// can be unit tested without a live server.  reqwest's `.query()` handles
/// percent-encoding of the values at send time.
pub(crate) fn stopped_report_request(
    ctx: &TimelineCtx,
    pos_ms: u64,
) -> (String, Vec<(String, String)>) {
    (
        format!("{}/:/timeline", ctx.server_uri),
        vec![
            ("ratingKey".to_string(), ctx.rating_key.clone()),
            (
                "key".to_string(),
                format!("/library/metadata/{}", ctx.rating_key),
            ),
            ("state".to_string(), "stopped".to_string()),
            ("time".to_string(), pos_ms.to_string()),
            ("duration".to_string(), ctx.duration_ms.to_string()),
            (
                "X-Plex-Client-Identifier".to_string(),
                ctx.client_id.clone(),
            ),
            ("X-Plex-Token".to_string(), ctx.token.clone()),
        ],
    )
}

// ── Network send ─────────────────────────────────────────────────────────────

/// Spawn a thread to fire the final `state=stopped` timeline GET and wait at
/// most [`CLOSE_REPORT_JOIN_BUDGET`] for it to complete.
///
/// `pos_ms` must be read by the caller before invoking this function —
/// mpv is torn down immediately after this returns, so the time-pos cannot
/// be read inside the spawned thread.
///
/// No-op (returns immediately) when `ctx` is `None`.
pub(crate) fn fire_stopped_report(ctx: Option<TimelineCtx>, pos_ms_opt: Option<u64>) {
    let (ctx, pos_ms) = match (ctx, pos_ms_opt) {
        (Some(c), Some(p)) => (c, p),
        _ => return,
    };
    log::info!(
        "[player] close report: state=stopped time={}ms ratingKey={}",
        pos_ms,
        ctx.rating_key
    );
    let (url, query) = stopped_report_request(&ctx, pos_ms);
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        // Moved into the closure so it drops when the send finishes
        // (or panics), unblocking the bounded recv_timeout below.
        let _completion_guard = tx;
        let client = match reqwest::blocking::Client::builder()
            .timeout(Duration::from_millis(1500))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                log::error!("[player] close report client build failed: {}", e);
                return;
            }
        };
        let result = client
            .get(url)
            .query(&query)
            .header("Accept", "application/json")
            .send();
        match result {
            Ok(resp) => log::info!("[player] close report sent, status {}", resp.status()),
            Err(e) => log::warn!("[player] close report failed: {}", e.without_url()),
        }
    });
    // Bounded join: Disconnected = sender dropped = thread finished.
    // Timeout = still in flight; proceed with close and let the thread
    // race process exit (best-effort — the report may be lost).
    match rx.recv_timeout(CLOSE_REPORT_JOIN_BUDGET) {
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => log::debug!(
            "[player] close report still in flight after {:?} — detaching",
            CLOSE_REPORT_JOIN_BUDGET
        ),
        _ => log::debug!("[player] close report thread finished within close budget"),
    }
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> TimelineCtx {
        TimelineCtx {
            server_uri: "https://server.example:32400".into(),
            token: "tok".into(),
            rating_key: "66324".into(),
            duration_ms: 1_244_200,
            client_id: "client-id".into(),
        }
    }

    #[test]
    fn stopped_report_request_builds_expected_url_and_query() {
        let (url, query) = stopped_report_request(&ctx(), 123_456);
        assert_eq!(url, "https://server.example:32400/:/timeline");
        let expected: Vec<(String, String)> = vec![
            ("ratingKey".into(), "66324".into()),
            ("key".into(), "/library/metadata/66324".into()),
            ("state".into(), "stopped".into()),
            ("time".into(), "123456".into()),
            ("duration".into(), "1244200".into()),
            ("X-Plex-Client-Identifier".into(), "client-id".into()),
            ("X-Plex-Token".into(), "tok".into()),
        ];
        assert_eq!(query, expected);
    }

    #[test]
    fn fire_stopped_report_is_noop_when_ctx_none() {
        // Should return immediately without spawning a thread.
        fire_stopped_report(None, None);
        fire_stopped_report(None, Some(0));
    }

    #[test]
    fn fire_stopped_report_is_noop_when_pos_none() {
        // ctx present but pos_ms_opt=None → still a no-op (can't have a
        // report without a position).
        fire_stopped_report(Some(ctx()), None);
    }
}
