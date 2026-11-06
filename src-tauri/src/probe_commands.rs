//! Debug-only IPC. Activation requires native preflight, never frontend flags.
use crate::probe_events::Events;
use serde::Deserialize;
use serde_json::Value;
use std::{fs::File, sync::Mutex};
use tauri::Manager;

pub struct FixturePort(pub u16);

pub type ProbeState = Mutex<Events<File>>;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Bootstrap,
    Ready,
    Begin { id: String },
    End { id: String, observed: Value },
    Fail { code: String },
    Cleanup,
    Finish { clean: bool },
}

#[tauri::command]
pub fn probe_driver(
    window: tauri::WebviewWindow,
    request: Request,
) -> Result<Option<Value>, &'static str> {
    if window.label() != "main" {
        return Err("probe_disabled");
    }
    // Bootstrap is read-only and precedes React/auth initialization. Only native
    // startup can install this port, and its host is fixed rather than supplied.
    if matches!(request, Request::Bootstrap) {
        return Ok(window.try_state::<FixturePort>().map(
            |port| serde_json::json!({"fixtureUrl": format!("http://127.0.0.1:{}", port.0)}),
        ));
    }
    let state = window.try_state::<ProbeState>().ok_or("probe_disabled")?;
    let mut events = state.lock().map_err(|_| "marker_io")?;
    match request {
        Request::Bootstrap => unreachable!(),
        Request::Ready => return events.ready().map(Some),
        Request::Begin { id } => events.begin(&id)?,
        Request::End { id, observed } => events.end(&id, observed)?,
        Request::Fail { code } => events.fail(&code)?,
        Request::Cleanup => events.cleanup()?,
        Request::Finish { clean } => {
            let passed = events.finish(clean)?;
            // Terminal output is flushed before requesting normal Tauri shutdown.
            window.app_handle().exit(if passed { 0 } else { 1 });
        }
    }
    Ok(None)
}
