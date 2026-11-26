//! Copy/verify/commit migration. The source stays authoritative until the
//! location record has been atomically replaced; cleanup happens only afterward.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

fn location_record() -> Result<PathBuf, String> {
    Ok(dirs::config_dir()
        .ok_or("Cannot find configuration directory")?
        .join("prexu")
        .join("download-location.json"))
}

pub(crate) fn configured_directory() -> Result<PathBuf, String> {
    let record = location_record()?;
    match fs::read(&record) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|_| "Invalid saved download location".into())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(dirs::video_dir()
            .or_else(dirs::data_local_dir)
            .ok_or("Cannot determine downloads directory")?
            .join("Prexu")),
        Err(e) => Err(format!("Cannot read download location: {e}")),
    }
}

fn validate_destination(source: &Path, destination: &Path) -> Result<PathBuf, String> {
    if !destination.is_absolute() {
        return Err("Choose an absolute folder path".into());
    }
    let destination = destination
        .canonicalize()
        .map_err(|_| "Choose an existing folder")?;
    let source = source.canonicalize().map_err(|e| e.to_string())?;
    if !destination.is_dir() || destination.parent().is_none() {
        return Err("Choose a folder other than the filesystem root".into());
    }
    if destination.starts_with(&source) || source.starts_with(&destination) {
        return Err("The new folder must be separate from the current download folder".into());
    }
    if fs::read_dir(&destination)
        .map_err(|e| e.to_string())?
        .next()
        .is_some()
    {
        return Err("Choose an empty folder to avoid overwriting files".into());
    }
    Ok(destination)
}

fn inventory(root: &Path, relative: &Path, files: &mut Vec<(PathBuf, u64)>) -> Result<(), String> {
    for entry in fs::read_dir(root.join(relative)).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        let path = relative.join(entry.file_name());
        if kind.is_symlink() {
            return Err("Downloads contain a symbolic link; move refused".into());
        }
        if kind.is_dir() {
            inventory(root, &path, files)?;
        } else if kind.is_file() {
            files.push((path, entry.metadata().map_err(|e| e.to_string())?.len()));
        } else {
            return Err("Downloads contain an unsupported file type".into());
        }
    }
    Ok(())
}

fn verify(source: &Path, copy: &Path) -> Result<(), String> {
    let mut source = File::open(source).map_err(|e| e.to_string())?;
    let mut copy = File::open(copy).map_err(|e| e.to_string())?;
    if source.metadata().map_err(|e| e.to_string())?.len()
        != copy.metadata().map_err(|e| e.to_string())?.len()
    {
        return Err("Copy verification failed".into());
    }
    let mut a = [0; 64 * 1024];
    let mut b = [0; 64 * 1024];
    loop {
        let n = source.read(&mut a).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        copy.read_exact(&mut b[..n]).map_err(|e| e.to_string())?;
        if a[..n] != b[..n] {
            return Err("Copy verification failed".into());
        }
    }
    Ok(())
}

#[cfg(unix)]
fn sync_directories(path: &Path) -> std::io::Result<()> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            sync_directories(&entry.path())?;
        }
    }
    File::open(path)?.sync_all()
}

// A private staging directory avoids merging with, overwriting, or deleting
// unrelated destination contents on rollback.
fn migrate(
    source: &Path,
    destination: &Path,
    record: &Path,
    mut progress: impl FnMut(u64, u64),
    mut before_verify: impl FnMut(&Path) -> Result<(), String>,
) -> Result<PathBuf, String> {
    let destination = validate_destination(source, destination)?;
    let mut files = Vec::new();
    inventory(source, Path::new(""), &mut files)?;
    let total = files.iter().map(|(_, len)| len).sum::<u64>();
    if fs2::available_space(&destination).map_err(|e| e.to_string())? < total {
        return Err("Not enough free space in the selected folder".into());
    }
    // Keep an app-owned child as the committed root. A failed/crashed migration
    // is never mistaken for a successful one by the saved location record.
    let target = destination.join("Prexu");
    fs::create_dir(&target).map_err(|e| format!("Cannot create download folder: {e}"))?;
    let copied = (|| {
        let mut done = 0;
        let mut last_progress = std::time::Instant::now();
        progress(done, total);
        for (relative, _) in &files {
            let path = target.join(relative);
            fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            let mut input = File::open(source.join(relative)).map_err(|e| e.to_string())?;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map_err(|e| e.to_string())?;
            let mut buffer = vec![0; 1024 * 1024];
            loop {
                let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
                done += n as u64;
                if last_progress.elapsed() >= std::time::Duration::from_millis(100) {
                    progress(done, total);
                    last_progress = std::time::Instant::now();
                }
            }
            output.sync_all().map_err(|e| e.to_string())?;
            before_verify(&path)?;
            verify(&source.join(relative), &path)?;
        }
        progress(done, total);
        #[cfg(unix)]
        {
            sync_directories(&target).map_err(|e| e.to_string())?;
            File::open(&destination)
                .and_then(|f| f.sync_all())
                .map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(record.parent().ok_or("Invalid location record")?)
            .map_err(|e| e.to_string())?;
        let temporary = record.with_extension("pending");
        let bytes = serde_json::to_vec(&target).map_err(|e| e.to_string())?;
        let mut output = File::create(&temporary).map_err(|e| e.to_string())?;
        output
            .write_all(&bytes)
            .and_then(|_| output.sync_all())
            .map_err(|e| e.to_string())?;
        fs::rename(&temporary, record).map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })();
    if let Err(error) = copied {
        let _ = fs::remove_dir_all(&target);
        return Err(error);
    }
    // If persistence cannot be made durable, keep the source as a recovery copy.
    #[cfg(unix)]
    if File::open(record.parent().unwrap())
        .and_then(|f| f.sync_all())
        .is_err()
    {
        log::warn!("[downloads:move] location durability unavailable; source copies retained");
        return Ok(target);
    }
    // Only delete inventoried, verified files. Unexpected files in the old
    // directory are left alone. Cleanup failure retains a harmless extra copy.
    for (relative, _) in files {
        if fs::remove_file(source.join(relative)).is_err() {
            log::warn!("[downloads:move] old copy retained after successful migration");
        }
    }
    Ok(target)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveProgress {
    copied_bytes: u64,
    total_bytes: u64,
}

#[tauri::command]
pub async fn choose_downloads_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app
        .dialog()
        .file()
        .set_title("Choose an empty folder for downloads")
        .blocking_pick_folder();
    folder
        .map(|p| {
            p.into_path()
                .map(|p| p.to_string_lossy().into_owned())
                .map_err(|e| e.to_string())
        })
        .transpose()
}

#[tauri::command]
pub async fn move_downloads_folder(
    app: tauri::AppHandle,
    destination: String,
    state: tauri::State<'_, super::DownloadManager>,
) -> Result<String, String> {
    use tauri::{Emitter, Manager};
    if state.moving.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Err("A download move is already running".into());
    }
    struct Reset<'a>(&'a std::sync::atomic::AtomicBool);
    impl Drop for Reset<'_> {
        fn drop(&mut self) {
            self.0.store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let _reset = Reset(&state.moving);
    let source = {
        let cached = state.downloads_dir.lock().await;
        match &*cached {
            Some(path) => path.clone(),
            None => super::resolve_downloads_dir().await?,
        }
    };
    // Refuse invalid paths before interrupting transfers.
    validate_destination(&source, Path::new(&destination))?;
    super::control_queue(&state, "pauseAll", None, None, None)?;
    let _exclusive =
        tokio::time::timeout(std::time::Duration::from_secs(30), state.filesystem.write())
            .await
            .map_err(|_| "Downloads did not pause in time; try again when they have stopped")?;
    let record = location_record()?;
    let events = app.clone();
    log::info!("[downloads:move] copying paused downloads");
    let target = tauri::async_runtime::spawn_blocking(move || {
        migrate(
            &source,
            Path::new(&destination),
            &record,
            |copied_bytes, total_bytes| {
                let _ = events.emit(
                    "download-move-progress",
                    MoveProgress {
                        copied_bytes,
                        total_bytes,
                    },
                );
            },
            |_| Ok(()),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    *state.downloads_dir.lock().await = Some(target.clone());
    *app.state::<crate::ProxyState>()
        .downloads_dir
        .lock()
        .map_err(|e| e.to_string())? = Some(target.to_string_lossy().into_owned());
    log::info!("[downloads:move] committed verified copies; downloads remain paused");
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(name: &str) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "prexu-move-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let source = root.join("old");
        let destination = root.join("new");
        fs::create_dir_all(source.join("17")).unwrap();
        fs::create_dir_all(&destination).unwrap();
        fs::write(source.join("17/movie.mp4"), b"fixture bytes").unwrap();
        fs::write(source.join("17/next.mp4.part"), b"partial").unwrap();
        let record = root.join("location.json");
        (root, source, destination, record)
    }
    #[tokio::test]
    async fn move_pause_stops_writer_before_exclusive_access_and_refuses_resume() {
        let manager = super::super::DownloadManager::new();
        let reader = manager.filesystem.read().await;
        let (tx, mut rx) = tokio::sync::watch::channel(false);
        manager.active.lock().unwrap().insert("17".into(), tx);
        manager
            .moving
            .store(true, std::sync::atomic::Ordering::SeqCst);
        super::super::control_queue(&manager, "pauseAll", None, None, None).unwrap();
        rx.changed().await.unwrap();
        assert!(*rx.borrow());
        assert!(manager.filesystem.try_write().is_err());
        assert!(super::super::control_queue(&manager, "resumeAll", None, None, None).is_err());
        drop(reader);
        assert!(manager.filesystem.try_write().is_ok());
        assert!(manager.queue.is_paused("17"));
    }

    #[test]
    fn move_verifies_complete_and_partial_files_and_persists_location() {
        let (root, source, destination, record) = fixture("success");
        let mut progress = Vec::new();
        let target = migrate(
            &source,
            &destination,
            &record,
            |n, t| progress.push((n, t)),
            |_| Ok(()),
        )
        .unwrap();
        assert_eq!(
            fs::read(target.join("17/movie.mp4")).unwrap(),
            b"fixture bytes"
        );
        assert_eq!(
            fs::read(target.join("17/next.mp4.part")).unwrap(),
            b"partial"
        );
        assert!(!source.join("17/movie.mp4").exists());
        assert_eq!(
            serde_json::from_slice::<PathBuf>(&fs::read(record).unwrap()).unwrap(),
            target
        );
        assert_eq!(progress.last(), Some(&(20, 20)));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn corrupt_copy_rolls_back_without_removing_source_or_changing_record() {
        let (root, source, destination, record) = fixture("corrupt");
        fs::write(&record, b"original record").unwrap();
        assert!(migrate(
            &source,
            &destination,
            &record,
            |_, _| {},
            |path| {
                fs::write(path, b"bad").unwrap();
                Ok(())
            }
        )
        .is_err());
        assert_eq!(
            fs::read(source.join("17/movie.mp4")).unwrap(),
            b"fixture bytes"
        );
        assert_eq!(fs::read(record).unwrap(), b"original record");
        assert!(!destination.join("Prexu").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn record_failure_rolls_back_all_copies() {
        let (root, source, destination, record) = fixture("record");
        fs::create_dir(&record).unwrap();
        assert!(migrate(&source, &destination, &record, |_, _| {}, |_| Ok(())).is_err());
        assert!(source.join("17/movie.mp4").exists());
        assert!(source.join("17/next.mp4.part").exists());
        assert!(!destination.join("Prexu").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_relative_missing_nested_parent_and_nonempty_paths() {
        let (root, source, destination, _) = fixture("paths");
        for path in [
            PathBuf::from("relative"),
            root.join("missing"),
            source.clone(),
            source.join("17"),
            root.clone(),
            source.join("17/movie.mp4"),
        ] {
            assert!(validate_destination(&source, &path).is_err(), "{path:?}");
        }
        fs::write(destination.join("unrelated"), b"keep").unwrap();
        assert!(validate_destination(&source, &destination).is_err());
        assert_eq!(fs::read(destination.join("unrelated")).unwrap(), b"keep");
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn refuses_source_symlinks() {
        let (root, source, destination, record) = fixture("symlink");
        std::os::unix::fs::symlink(&record, source.join("link")).unwrap();
        assert!(migrate(&source, &destination, &record, |_, _| {}, |_| Ok(())).is_err());
        assert!(source.join("17/movie.mp4").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
