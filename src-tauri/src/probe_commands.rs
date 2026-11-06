//! Debug-only IPC. Activation requires native preflight, never frontend flags.
use crate::probe_events::Events;
use serde::Deserialize;
use serde_json::Value;
use std::{fs::File, sync::Mutex};
use tauri::Manager;

pub type ProbeState = Mutex<Events<File>>;

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
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
    let state = window.try_state::<ProbeState>().ok_or("probe_disabled")?;
    let mut events = state.lock().map_err(|_| "marker_io")?;
    match request {
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
