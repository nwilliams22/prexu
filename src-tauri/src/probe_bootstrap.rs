//! Filesystem preflight for debug probe runs. No application stores are opened.
use crate::probe_script;
use serde_json::Value;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

pub struct Prepared {
    pub script: Value,
    pub state_dir: PathBuf,
    pub events: File,
}

// Fixed codes only: OS errors can contain private paths.
type Result<T> = std::result::Result<T, &'static str>;

fn absolute(path: &Path) -> Result<()> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("invalid_probe_path");
    }
    Ok(())
}

fn fresh_directory(path: &Path) -> Result<PathBuf> {
    // create_dir, not create_dir_all: an existing directory or symlink is never
    // accepted, even if empty. The caller creates only the containing run dir.
    fs::create_dir(path).map_err(|_| "probe_directory_unavailable")?;
    fs::canonicalize(path).map_err(|_| "probe_directory_unavailable")
}

pub fn prepare(script_path: &Path, state_dir: &Path, output_dir: &Path) -> Result<Prepared> {
    for path in [script_path, state_dir, output_dir] {
        absolute(path)?;
    }
    // Reject overlap before creating anything. Canonical parent resolution also
    // detects aliases through symlinked ancestors.
    let resolved = |path: &Path| -> Result<PathBuf> {
        let parent = path.parent().ok_or("invalid_probe_path")?;
        let name = path.file_name().ok_or("invalid_probe_path")?;
        Ok(fs::canonicalize(parent)
            .map_err(|_| "probe_directory_unavailable")?
            .join(name))
    };
    let state_dir = resolved(state_dir)?;
    let output_dir = resolved(output_dir)?;
    if state_dir.starts_with(&output_dir) || output_dir.starts_with(&state_dir) {
        return Err("invalid_probe_path");
    }
    if !fs::metadata(script_path)
        .map_err(|_| "invalid_script")?
        .is_file()
    {
        return Err("invalid_script");
    }
    let file = File::open(script_path).map_err(|_| "invalid_script")?;
    if !file.metadata().map_err(|_| "invalid_script")?.is_file() {
        return Err("invalid_script");
    }
    let mut raw = Vec::new();
    file.take((probe_script::MAX_BYTES + 1) as u64)
        .read_to_end(&mut raw)
        .map_err(|_| "invalid_script")?;
    let script = probe_script::parse(&raw).map_err(|_| "invalid_script")?;
    let state_dir = fresh_directory(&state_dir)?;
    // Do not remove paths on failure: another process might have created files
    // there. A failed preflight consumes this run's fresh directories.
    let output_dir = fresh_directory(&output_dir)?;
    let events = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output_dir.join("events.jsonl"))
        .map_err(|_| "probe_output_unavailable")?;
    Ok(Prepared {
        script,
        state_dir,
        events,
    })
}
