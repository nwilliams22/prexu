use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};
use futures_util::StreamExt;

use crate::validate_server_url;

/// Manages active downloads with cancellation support.
pub struct DownloadManager {
    active: Arc<Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>>,
    downloads_dir: Mutex<Option<PathBuf>>,
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            active: Arc::new(Mutex::new(HashMap::new())),
            downloads_dir: Mutex::new(None),
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    rating_key: String,
    bytes_downloaded: u64,
    total_bytes: u64,
    status: String,
    error_message: Option<String>,
}

/// Resolve the downloads directory, creating it if needed.
async fn resolve_downloads_dir() -> Result<PathBuf, String> {
    let base = dirs::video_dir()
        .or_else(dirs::data_local_dir)
        .ok_or("Cannot determine downloads directory")?;
    let dir = base.join("Prexu");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create downloads directory: {}", e))?;
    Ok(dir)
}

/// Get the downloads directory path.
#[tauri::command]
pub async fn get_downloads_dir(
    state: tauri::State<'_, DownloadManager>,
) -> Result<String, String> {
    let mut cached = state.downloads_dir.lock().await;
    if let Some(ref dir) = *cached {
        return Ok(dir.to_string_lossy().to_string());
    }
    let dir = resolve_downloads_dir().await?;
    *cached = Some(dir.clone());
    Ok(dir.to_string_lossy().to_string())
}

/// Download a media file from Plex to local storage.
#[tauri::command]
pub async fn download_media(
    app: AppHandle,
    server_url: String,
    token: String,
    rating_key: String,
    part_key: String,
    file_name: String,
    file_size: u64,
    state: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
    validate_server_url(&server_url)?;

    let downloads_dir = resolve_downloads_dir().await?;
    let item_dir = downloads_dir.join(&rating_key);
    tokio::fs::create_dir_all(&item_dir)
        .await
        .map_err(|e| format!("Failed to create item directory: {}", e))?;

    let final_path = item_dir.join(&file_name);
    let temp_path = item_dir.join(format!("{}.part", &file_name));

    // Set up cancellation
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    {
        let mut active = state.active.lock().await;
        active.insert(rating_key.clone(), cancel_tx);
    }

    // Build download URL
    let sep = if part_key.contains('?') { "&" } else { "?" };
    let url = format!("{}{}{}{}{}", server_url, part_key, sep, "X-Plex-Token=", token);

    let emit_progress = |bytes: u64, status: &str, err: Option<String>| {
        let _ = app.emit("download-progress", DownloadProgress {
            rating_key: rating_key.clone(),
            bytes_downloaded: bytes,
            total_bytes: file_size,
            status: status.to_string(),
            error_message: err,
        });
    };

    // Start streaming download
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        emit_progress(0, "error", Some(format!("HTTP {}", status)));
        return Err(format!("Download failed with HTTP {}", status));
    }

    let total = response.content_length().unwrap_or(file_size);
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;
    let emit_interval: u64 = 512 * 1024; // emit every 512KB

    use tokio::io::AsyncWriteExt;

    loop {
        tokio::select! {
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        file.write_all(&bytes).await.map_err(|e| {
                            format!("Failed to write to file: {}", e)
                        })?;
                        downloaded += bytes.len() as u64;

                        if downloaded - last_emit >= emit_interval || downloaded >= total {
                            emit_progress(downloaded, "downloading", None);
                            last_emit = downloaded;
                        }
                    }
                    Some(Err(e)) => {
                        drop(file);
                        let _ = tokio::fs::remove_file(&temp_path).await;
                        emit_progress(downloaded, "error", Some(e.to_string()));
                        let mut active = state.active.lock().await;
                        active.remove(&rating_key);
                        return Err(format!("Download error: {}", e));
                    }
                    None => break, // Stream complete
                }
            }
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    drop(file);
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    emit_progress(downloaded, "cancelled", None);
                    let mut active = state.active.lock().await;
                    active.remove(&rating_key);
                    return Ok(());
                }
            }
        }
    }

    // Flush and rename
    file.flush().await.map_err(|e| format!("Failed to flush file: {}", e))?;
    drop(file);
    tokio::fs::rename(&temp_path, &final_path)
        .await
        .map_err(|e| format!("Failed to finalize download: {}", e))?;

    emit_progress(total, "complete", None);

    let mut active = state.active.lock().await;
    active.remove(&rating_key);

    log::info!("[Download] Complete: {} -> {:?}", rating_key, final_path);
    Ok(())
}

/// Cancel an active download.
#[tauri::command]
pub async fn cancel_download(
    rating_key: String,
    state: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
    let active = state.active.lock().await;
    if let Some(tx) = active.get(&rating_key) {
        let _ = tx.send(true);
        log::info!("[Download] Cancelled: {}", rating_key);
    }
    Ok(())
}

/// Delete a downloaded file and its directory.
#[tauri::command]
pub async fn delete_download(
    rating_key: String,
    state: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
    let downloads_dir = {
        let cached = state.downloads_dir.lock().await;
        match &*cached {
            Some(dir) => dir.clone(),
            None => resolve_downloads_dir().await?,
        }
    };
    let item_dir = downloads_dir.join(&rating_key);
    if item_dir.exists() {
        tokio::fs::remove_dir_all(&item_dir)
            .await
            .map_err(|e| format!("Failed to delete download: {}", e))?;
        log::info!("[Download] Deleted: {}", rating_key);
    }
    Ok(())
}

/// Check if a local file exists for a given ratingKey and return its path.
#[tauri::command]
pub async fn get_local_file_path(
    rating_key: String,
    state: tauri::State<'_, DownloadManager>,
) -> Result<Option<String>, String> {
    let downloads_dir = {
        let cached = state.downloads_dir.lock().await;
        match &*cached {
            Some(dir) => dir.clone(),
            None => resolve_downloads_dir().await?,
        }
    };
    let item_dir = downloads_dir.join(&rating_key);
    if !item_dir.exists() {
        return Ok(None);
    }

    // Find the first non-.part file in the directory
    let mut entries = tokio::fs::read_dir(&item_dir)
        .await
        .map_err(|e| format!("Failed to read download directory: {}", e))?;

    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        if path.is_file() && !path.to_string_lossy().ends_with(".part") {
            return Ok(Some(path.to_string_lossy().to_string()));
        }
    }

    Ok(None)
}
