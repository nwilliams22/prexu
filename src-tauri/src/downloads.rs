use futures_util::StreamExt;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::validate_server_url;

/// Process-shared download client (prexu-0szx.12): reqwest's connection
/// pool + TLS session only get reused when the `Client` itself is —
/// per-call `Client::new()` paid a fresh TCP+TLS handshake per download.
fn download_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("download HTTP client")
    })
}

/// Returns true when `downloaded` has reached or exceeded `total` AND `total`
/// is a known (non-zero) value. When `total == 0` (content-length absent and
/// no caller-supplied file_size) we never claim to be "at end" via the byte
/// comparison — completion is detected by stream exhaustion instead.
fn progress_at_end(downloaded: u64, total: u64) -> bool {
    total > 0 && downloaded >= total
}

/// Validate a path component (rating_key or file_name) that will be joined
/// onto the downloads directory. Rejects any value that could escape the
/// intended directory via path traversal or absolute paths.
///
/// Allowlist: printable ASCII excluding `/`, `\`, `:`, `*`, `?`, `"`, `<`,
/// `>`, `|`, and NUL. Also rejects `..` as a component, absolute paths, and
/// Windows drive-qualified paths (e.g. `C:foo`).
///
/// Returns `Ok(())` if the value is safe, or `Err` with a static description.
pub(crate) fn validate_path_component(value: &str) -> Result<(), &'static str> {
    if value.is_empty() {
        return Err("path component must not be empty");
    }
    // Reject NUL byte (can truncate OS path strings).
    if value.contains('\0') {
        return Err("path component contains NUL byte");
    }
    // Reject path separator characters.
    if value.contains('/') || value.contains('\\') {
        return Err("path component contains path separator");
    }
    // Reject Windows drive qualifiers like "C:" or "C:foo".
    // A colon in any position is sufficient — it's never valid in a bare name.
    if value.contains(':') {
        return Err("path component contains drive qualifier or colon");
    }
    // Reject UNC prefix "\\" — already caught above by the backslash check,
    // but be explicit for clarity. Reject lone "." and ".." traversal segments.
    if value == ".." || value == "." {
        return Err("path component is a traversal segment");
    }
    // Reject Windows shell-special characters that could be exploited via
    // later shell invocations or confuse file managers.
    for ch in ['*', '?', '"', '<', '>', '|'] {
        if value.contains(ch) {
            return Err("path component contains a forbidden character");
        }
    }
    Ok(())
}

/// Validate that a Plex `part_key` is a server-rooted absolute path before it
/// is concatenated onto `server_url` to build the (token-bearing) download URL.
///
/// A `part_key` that does not begin with a single `/` can redirect the
/// authenticated request to an attacker-controlled host — e.g. `@evil.com`
/// turns `server_url` into userinfo and `evil.com` into the host, and
/// `http://evil/…` is an absolute URL that overrides the host entirely. Both
/// would leak the `X-Plex-Token` off-server (SSRF). A leading `//` is a
/// protocol-relative / authority-injection vector.
///
/// Returns `Ok(())` if the value is a safe rooted path, or `Err` with a static
/// description (never echo the raw value — log-injection risk).
fn validate_part_key(part_key: &str) -> Result<(), &'static str> {
    if part_key.is_empty() {
        return Err("part_key must not be empty");
    }
    if !part_key.starts_with('/') {
        return Err("part_key must be a server-rooted path");
    }
    if part_key.starts_with("//") {
        return Err("part_key must not start with '//'");
    }
    // Control characters could split the HTTP request line / inject headers.
    if part_key
        .chars()
        .any(|c| c == '\0' || c == '\r' || c == '\n')
    {
        return Err("part_key contains a control character");
    }
    Ok(())
}

/// Manages active downloads with cancellation support.
///
/// `active` uses a `std::sync::Mutex` (not tokio's): every critical section is
/// a single map insert/remove/get with no `.await` held across the lock, and a
/// blocking lock lets the [`DownloadGuard`] `Drop` release the entry
/// synchronously on any failure/abort path.
pub struct DownloadManager {
    active: Arc<ActiveMap>,
    downloads_dir: Mutex<Option<PathBuf>>,
    queue: Arc<Queue>,
}

/// Shared map from an in-flight download's rating_key to its cancel `Sender`.
type ActiveMap = std::sync::Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>;

/// Atomically claim `rating_key` in the active-download map, rejecting a second
/// concurrent download of the same key. Two writers to one `.part` file
/// interleave bytes, and a blind insert would orphan the first download's
/// cancel `Sender` (its select loop then busy-spins on the closed watch
/// channel). The check-and-insert happens under a single lock with no `.await`
/// between, so it is race-free.
///
/// On rejection, logs a fixed message (never the raw rating_key — log-injection
/// risk) and returns an informative error.
fn try_claim_active(
    active: &ActiveMap,
    rating_key: &str,
    cancel_tx: tokio::sync::watch::Sender<bool>,
) -> Result<(), String> {
    let mut guard = active
        .lock()
        .map_err(|_| "download manager lock poisoned".to_string())?;
    if guard.contains_key(rating_key) {
        log::warn!("[downloads] rejected duplicate in-flight download for rating_key");
        return Err("A download for this item is already in progress".to_string());
    }
    guard.insert(rating_key.to_string(), cancel_tx);
    Ok(())
}

/// Native admission is authoritative even if several webview calls arrive together.
#[derive(Default)]
struct QueueState {
    waiting: VecDeque<String>,
    running: HashSet<String>,
    paused: HashSet<String>,
    pause_all: bool,
    limit: usize,
}
struct Queue {
    state: std::sync::Mutex<QueueState>,
    changed: tokio::sync::Notify,
}
impl Queue {
    fn new() -> Self {
        Self {
            state: std::sync::Mutex::new(QueueState {
                limit: 1,
                ..Default::default()
            }),
            changed: tokio::sync::Notify::new(),
        }
    }
    fn admit(&self, key: &str) -> bool {
        let mut s = self.state.lock().unwrap();
        if s.pause_all || s.paused.contains(key) || s.running.len() >= s.limit {
            return false;
        }
        if s.waiting.front().map(String::as_str) != Some(key) {
            return false;
        }
        s.waiting.pop_front();
        s.running.insert(key.to_string());
        self.changed.notify_waiters();
        true
    }
    fn is_paused(&self, key: &str) -> bool {
        let s = self.state.lock().unwrap();
        s.pause_all || s.paused.contains(key)
    }
    fn reorder(&self, keys: &[String]) {
        let mut s = self.state.lock().unwrap();
        let mut ordered = VecDeque::new();
        for key in keys {
            if let Some(index) = s.waiting.iter().position(|k| k == key) {
                ordered.push_back(s.waiting.remove(index).unwrap());
            }
        }
        ordered.append(&mut s.waiting);
        s.waiting = ordered;
        self.changed.notify_waiters();
    }
}

/// Release admission on every return/abort. Partial bytes survive failures and
/// process restarts; only an explicit cancel removes them.
struct DownloadGuard {
    active: Arc<ActiveMap>,
    rating_key: String,
    temp_path: PathBuf,
    queue: Arc<Queue>,
    remove_partial: bool,
}
impl Drop for DownloadGuard {
    fn drop(&mut self) {
        if self.remove_partial {
            let _ = std::fs::remove_file(&self.temp_path);
        }
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.rating_key);
        }
        if let Ok(mut s) = self.queue.state.lock() {
            s.waiting.retain(|key| key != &self.rating_key);
            s.running.remove(&self.rating_key);
            s.paused.remove(&self.rating_key);
        }
        self.queue.changed.notify_waiters();
    }
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            active: Arc::new(std::sync::Mutex::new(HashMap::new())),
            downloads_dir: Mutex::new(None),
            queue: Arc::new(Queue::new()),
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
    bytes_per_second: f64,
    eta_seconds: Option<u64>,
    status_message: Option<String>,
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
pub async fn get_downloads_dir(state: tauri::State<'_, DownloadManager>) -> Result<String, String> {
    let mut cached = state.downloads_dir.lock().await;
    if let Some(ref dir) = *cached {
        return Ok(dir.to_string_lossy().to_string());
    }
    let dir = resolve_downloads_dir().await?;
    *cached = Some(dir.clone());
    Ok(dir.to_string_lossy().to_string())
}

/// Download a media file from Plex to local storage.
// reason: tauri command; args map 1:1 to the frontend download invocation
#[allow(clippy::too_many_arguments)]
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

    // Guard against path traversal via attacker-influenced rating_key / file_name.
    // Log a warning on rejection but do NOT echo the raw value into the log
    // (log-injection risk); only log a fixed label for each parameter.
    if let Err(reason) = validate_path_component(&rating_key) {
        log::warn!(
            "[downloads] rejected download request: invalid rating_key — {}",
            reason
        );
        return Err(format!("Invalid rating_key: {}", reason));
    }
    if let Err(reason) = validate_path_component(&file_name) {
        log::warn!(
            "[downloads] rejected download request: invalid file_name — {}",
            reason
        );
        return Err(format!("Invalid file_name: {}", reason));
    }
    // Guard against SSRF: a non-rooted part_key could redirect the token-bearing
    // fetch to an attacker host. Log the reason only, never the raw value.
    if let Err(reason) = validate_part_key(&part_key) {
        log::warn!(
            "[downloads] rejected download request: invalid part_key — {}",
            reason
        );
        return Err(format!("Invalid part_key: {}", reason));
    }

    // Set up cancellation and atomically claim the rating_key (rejects a second
    // in-flight download of the same key — see `try_claim_active`).
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    try_claim_active(&state.active, &rating_key, cancel_tx)?;

    let mut cleanup = DownloadGuard {
        active: state.active.clone(),
        rating_key: rating_key.clone(),
        temp_path: PathBuf::new(),
        queue: state.queue.clone(),
        remove_partial: false,
    };
    state
        .queue
        .state
        .lock()
        .unwrap()
        .waiting
        .push_back(rating_key.clone());
    let downloads_dir = {
        let cached = state.downloads_dir.lock().await;
        match &*cached {
            Some(dir) => dir.clone(),
            None => resolve_downloads_dir().await?,
        }
    };
    let item_dir = downloads_dir.join(&rating_key);
    tokio::fs::create_dir_all(&item_dir)
        .await
        .map_err(|e| format!("Failed to create item directory: {}", e))?;

    let final_path = item_dir.join(&file_name);
    let temp_path = item_dir.join(format!("{}.part", &file_name));

    cleanup.temp_path = temp_path.clone();
    let emit = |bytes, total, status: &str, speed, message: Option<String>| {
        let _ = app.emit(
            "download-progress",
            DownloadProgress {
                rating_key: rating_key.clone(),
                bytes_downloaded: bytes,
                total_bytes: total,
                status: status.to_string(),
                error_message: None,
                bytes_per_second: speed,
                eta_seconds: eta(bytes, total, speed),
                status_message: message,
            },
        );
    };
    emit(0, file_size, "queued", 0.0, None);
    // Register notification before checking admission so release cannot be lost.
    loop {
        let notified = state.queue.changed.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if *cancel_rx.borrow() || state.queue.is_paused(&rating_key) {
            let paused = state.queue.is_paused(&rating_key);
            cleanup.remove_partial = !paused;
            let bytes = tokio::fs::metadata(&temp_path)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            emit(
                bytes,
                file_size,
                if paused { "paused" } else { "cancelled" },
                0.0,
                None,
            );
            return Ok(());
        }
        if state.queue.admit(&rating_key) {
            break;
        }
        tokio::select! { _ = &mut notified => {}, _ = cancel_rx.changed() => {} }
    }
    // Headers keep credentials out of URLs and redirects are disabled.
    let url = format!("{}{}", server_url, part_key);
    let outcome = transfer(
        &url,
        &token,
        &temp_path,
        &final_path,
        file_size,
        &mut cancel_rx,
        &emit,
    )
    .await;
    match outcome {
        Ok(Some(bytes)) => emit(bytes, bytes, "complete", 0.0, None),
        Ok(None) => {
            let paused = state.queue.is_paused(&rating_key);
            cleanup.remove_partial = !paused;
            let bytes = tokio::fs::metadata(&temp_path)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            emit(
                bytes,
                file_size,
                if paused { "paused" } else { "cancelled" },
                0.0,
                None,
            );
        }
        Err(error) => return Err(error),
    }
    Ok(())
}

fn eta(bytes: u64, total: u64, speed: f64) -> Option<u64> {
    (total > 0 && speed > 0.0).then(|| ((total.saturating_sub(bytes)) as f64 / speed).ceil() as u64)
}

/// Only append a 206 whose Content-Range starts at the actual on-disk length.
/// A 200 means Range was ignored: truncate and visibly restart from zero.
fn response_offset(
    status: reqwest::StatusCode,
    range: Option<&str>,
    offset: u64,
) -> Result<(u64, Option<u64>), String> {
    if status == reqwest::StatusCode::OK {
        return Ok((0, None));
    }
    if status != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("Download failed with HTTP {}", status));
    }
    let parsed = (|| {
        let value = range?.strip_prefix("bytes ")?;
        let (span, total) = value.split_once('/')?;
        let (start, end) = span.split_once('-')?;
        Some((
            start.parse::<u64>().ok()?,
            end.parse::<u64>().ok()?,
            total.parse::<u64>().ok()?,
        ))
    })();
    match parsed {
        Some((start, end, total)) if start == offset && end >= start && end < total => {
            Ok((offset, Some(total)))
        }
        _ => Err("Server returned an invalid resume range; partial file kept".into()),
    }
}

async fn transfer(
    url: &str,
    token: &str,
    temp_path: &std::path::Path,
    final_path: &std::path::Path,
    file_size: u64,
    cancel: &mut tokio::sync::watch::Receiver<bool>,
    emit: &impl Fn(u64, u64, &str, f64, Option<String>),
) -> Result<Option<u64>, String> {
    use tokio::io::AsyncWriteExt;
    let offset = match tokio::fs::metadata(temp_path).await {
        Ok(meta) => meta.len(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => 0,
        Err(e) => return Err(format!("Cannot inspect partial file: {}", e)),
    };
    let mut request = download_client()
        .get(url)
        .header("X-Plex-Token", token)
        .header("Accept-Encoding", "identity");
    if offset > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={}-", offset));
    }
    let mut response = tokio::select! {
        biased;
        _ = async { let _ = cancel.wait_for(|stop| *stop).await; } => return Ok(None),
        result = request.send() => result.map_err(|e| format!("Download request failed: {}", e.without_url()))?,
    };
    let range_rejected =
        response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && offset > 0;
    if range_rejected {
        // Handles a crash after the last byte but before rename, or a changed file.
        response = tokio::select! {
            biased;
            _ = async { let _ = cancel.wait_for(|stop| *stop).await; } => return Ok(None),
            result = download_client().get(url).header("X-Plex-Token", token).header("Accept-Encoding", "identity").send() =>
                result.map_err(|e| format!("Download restart failed: {}", e.without_url()))?,
        };
    }
    let (start, range_total) = response_offset(
        response.status(),
        response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok()),
        offset,
    )?;
    let total = range_total
        .or_else(|| response.content_length().map(|n| n + start))
        .unwrap_or(file_size);
    let message = (offset > 0 && start == 0).then(|| {
        if range_rejected {
            "Saved offset is no longer available; restarting from zero".to_string()
        } else {
            "Server does not support resume; restarting from zero".to_string()
        }
    });
    emit(start, total, "downloading", 0.0, message.clone());
    let mut file = tokio::io::BufWriter::with_capacity(
        256 * 1024,
        tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(start > 0)
            .truncate(start == 0)
            .open(temp_path)
            .await
            .map_err(|e| format!("Cannot open partial file: {}", e))?,
    );
    let mut stream = response.bytes_stream();
    let mut downloaded = start;
    let mut last_emit = start;
    let mut last_emit_at = std::time::Instant::now();
    let mut speed = 0.0;
    loop {
        tokio::select! {
            biased;
            _ = async { let _ = cancel.wait_for(|stop| *stop).await; } => {
                file.flush().await.map_err(|e| format!("Cannot save partial file: {}", e))?;
                return Ok(None);
            }
            chunk = stream.next() => match chunk {
                Some(Ok(bytes)) => {
                    file.write_all(&bytes).await.map_err(|e| format!("Download write failed: {}", e))?;
                    downloaded += bytes.len() as u64;
                    let elapsed = last_emit_at.elapsed().as_secs_f64();
                    if (downloaded - last_emit >= 512 * 1024 && elapsed >= 0.5) || (last_emit < total && progress_at_end(downloaded, total)) {
                        let sample = (downloaded - last_emit) as f64 / elapsed.max(0.001);
                        speed = if speed == 0.0 { sample } else { speed * 0.7 + sample * 0.3 };
                        emit(downloaded, total, "downloading", speed, message.clone());
                        last_emit = downloaded;
                        last_emit_at = std::time::Instant::now();
                    }
                }
                Some(Err(e)) => {
                    file.flush().await.map_err(|e| format!("Cannot save partial file: {}", e))?;
                    return Err(format!("Download stream failed: {}", e.without_url()));
                }
                None => break,
            }
        }
    }
    file.flush()
        .await
        .map_err(|e| format!("Download flush failed: {}", e))?;
    drop(file);
    if total > 0 && downloaded != total {
        return Err("Download ended before the complete file arrived; partial file kept".into());
    }
    tokio::fs::rename(temp_path, final_path)
        .await
        .map_err(|e| format!("Cannot finalize download: {}", e))?;
    Ok(Some(downloaded))
}

/// Queue mutations share one command so ordering and pause-all are atomic.
#[tauri::command]
pub async fn control_download_queue(
    action: String,
    rating_key: Option<String>,
    order: Option<Vec<String>>,
    limit: Option<usize>,
    state: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
    control_queue(
        &state,
        &action,
        rating_key.as_deref(),
        order.as_deref(),
        limit,
    )
}
fn control_queue(
    manager: &DownloadManager,
    action: &str,
    key: Option<&str>,
    order: Option<&[String]>,
    limit: Option<usize>,
) -> Result<(), String> {
    if action == "reorder" {
        manager.queue.reorder(order.ok_or("Missing order")?);
        return Ok(());
    }
    let mut s = manager.queue.state.lock().unwrap();
    match action {
        "limit" => {
            let n = limit.ok_or("Missing limit")?;
            if !(1..=3).contains(&n) {
                return Err("Concurrency must be between 1 and 3".into());
            }
            s.limit = n;
        }
        "resumeAll" => {
            s.pause_all = false;
            let active = manager.active.lock().unwrap();
            s.paused.retain(|key| active.contains_key(key));
        }
        "pause" | "pauseAll" => {
            let active = manager.active.lock().unwrap();
            if action == "pauseAll" {
                s.pause_all = true;
            } else {
                s.paused
                    .insert(key.ok_or("Missing rating key")?.to_string());
            }
            for (k, tx) in active.iter() {
                if action == "pauseAll" || Some(k.as_str()) == key {
                    s.paused.insert(k.clone());
                    let _ = tx.send(true);
                }
            }
        }
        _ => return Err("Unknown download queue action".into()),
    }
    manager.queue.changed.notify_waiters();
    Ok(())
}

/// Cancel an active download.
#[tauri::command]
pub async fn cancel_download(
    rating_key: String,
    state: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
    let active = state
        .active
        .lock()
        .map_err(|_| "download manager lock poisoned".to_string())?;
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
    delete_download_impl(&rating_key, &state).await
}

/// Testable core of [`delete_download`] (no `tauri::State` dependency).
async fn delete_download_impl(rating_key: &str, manager: &DownloadManager) -> Result<(), String> {
    // Guard against path traversal via attacker-influenced rating_key: without
    // this, `join("..")` / an absolute path escapes the downloads dir and
    // remove_dir_all would recursively delete an arbitrary directory. Log the
    // reason only, never the raw value (log-injection risk).
    if let Err(reason) = validate_path_component(rating_key) {
        log::warn!(
            "[downloads] rejected delete_download: invalid rating_key — {}",
            reason
        );
        return Err(format!("Invalid rating_key: {}", reason));
    }
    // Stop the writer before deleting its directory (including on Windows).
    loop {
        let notified = manager.queue.changed.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        let pending = {
            let active = manager.active.lock().unwrap();
            if let Some(tx) = active.get(rating_key) {
                let _ = tx.send(true);
                true
            } else {
                false
            }
        };
        if !pending {
            break;
        }
        notified.await;
    }
    let downloads_dir = {
        let cached = manager.downloads_dir.lock().await;
        match &*cached {
            Some(dir) => dir.clone(),
            None => resolve_downloads_dir().await?,
        }
    };
    let item_dir = downloads_dir.join(rating_key);
    if item_dir.exists() {
        tokio::fs::remove_dir_all(&item_dir)
            .await
            .map_err(|e| format!("Failed to delete download: {}", e))?;
        log::info!("[Download] Deleted: {}", rating_key);
    }
    Ok(())
}

/// Reveal the downloads directory in the OS file manager.
#[tauri::command]
pub async fn open_downloads_dir(state: tauri::State<'_, DownloadManager>) -> Result<(), String> {
    let dir = {
        let cached = state.downloads_dir.lock().await;
        match &*cached {
            Some(dir) => dir.clone(),
            None => resolve_downloads_dir().await?,
        }
    };
    log::info!("[Download] open_downloads_dir: {:?}", dir);

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer").arg(&dir).spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&dir).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&dir).spawn();

    result.map(|_| ()).map_err(|e| {
        log::error!("[Download] open_downloads_dir failed: {:?}", e);
        format!("Failed to open downloads folder: {}", e)
    })
}

/// Check if a local file exists for a given ratingKey and return its path.
#[tauri::command]
pub async fn get_local_file_path(
    rating_key: String,
    state: tauri::State<'_, DownloadManager>,
) -> Result<Option<String>, String> {
    get_local_file_path_impl(&rating_key, &state).await
}

/// Resolve a downloaded item for native playback without accepting a webview
/// file path. Canonical containment also rejects symlinks outside this item's
/// directory (or an item directory symlink outside the downloads root).
#[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos", test))]
pub(crate) async fn playback_file(
    rating_key: &str,
    manager: &DownloadManager,
) -> Result<String, String> {
    let missing = || "Downloaded file is missing or unavailable".to_string();
    let path = get_local_file_path_impl(rating_key, manager)
        .await?
        .ok_or_else(missing)?;
    let root = {
        let cached = manager.downloads_dir.lock().await;
        match &*cached {
            Some(dir) => dir.clone(),
            None => resolve_downloads_dir().await?,
        }
    };
    let root = tokio::fs::canonicalize(root).await.map_err(|_| missing())?;
    let item = root.join(rating_key);
    let canonical_item = tokio::fs::canonicalize(&item).await.map_err(|_| missing())?;
    let file = tokio::fs::canonicalize(path).await.map_err(|_| missing())?;
    if canonical_item != item
        || file.parent() != Some(canonical_item.as_path())
        || !file.is_file()
        || file.extension().is_some_and(|ext| ext == "part")
    {
        return Err(missing());
    }
    file.to_str().map(str::to_owned).ok_or_else(missing)
}

/// Testable core of [`get_local_file_path`] (no `tauri::State` dependency).
async fn get_local_file_path_impl(
    rating_key: &str,
    manager: &DownloadManager,
) -> Result<Option<String>, String> {
    // Guard against path traversal via attacker-influenced rating_key: without
    // this, `join("..")` / an absolute path escapes the downloads dir and could
    // enumerate/read files anywhere on disk. Log the reason only, never the raw
    // value (log-injection risk).
    if let Err(reason) = validate_path_component(rating_key) {
        log::warn!(
            "[downloads] rejected get_local_file_path: invalid rating_key — {}",
            reason
        );
        return Err(format!("Invalid rating_key: {}", reason));
    }
    let downloads_dir = {
        let cached = manager.downloads_dir.lock().await;
        match &*cached {
            Some(dir) => dir.clone(),
            None => resolve_downloads_dir().await?,
        }
    };
    let item_dir = downloads_dir.join(rating_key);
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

#[cfg(test)]
mod tests {
    use super::{control_queue, eta, response_offset, transfer};
    use super::{
        delete_download_impl, get_local_file_path_impl, progress_at_end, try_claim_active,
        validate_part_key, validate_path_component, ActiveMap, DownloadGuard, DownloadManager,
    };
    use crate::util::redact_url;
    use std::path::PathBuf;

    /// Create a unique, existing temp directory for a test (no `tempfile` dep,
    /// which would require touching the dependency lockfile).
    fn unique_temp_dir(tag: &str) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "prexu-test-{}-{}-{}-{}",
            tag,
            std::process::id(),
            nanos,
            n
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn unknown_total_never_signals_at_end() {
        // When total == 0 (content-length missing, file_size == 0) the gate
        // must never fire, even with downloaded == 0 (first chunk / empty body).
        assert!(!progress_at_end(0, 0));
        assert!(!progress_at_end(1024, 0));
        assert!(!progress_at_end(u64::MAX, 0));
    }

    #[test]
    fn known_total_signals_at_end_when_reached() {
        let total: u64 = 1_000_000;
        assert!(!progress_at_end(0, total));
        assert!(!progress_at_end(999_999, total));
        assert!(progress_at_end(1_000_000, total));
        // Overshooting (last chunk may push past total) still signals completion.
        assert!(progress_at_end(1_000_001, total));
    }

    #[test]
    fn known_total_of_one_byte_works() {
        assert!(!progress_at_end(0, 1));
        assert!(progress_at_end(1, 1));
    }

    // ── Token redaction in download errors ──

    /// The token that appears in the download URL must never surface in any
    /// string that flows to a log or to the webview (progress event / Err).
    #[test]
    fn redact_url_strips_token_from_download_url() {
        let url = "http://192.168.1.5:32400/library/parts/42/file.mkv?X-Plex-Token=s3cr3t";
        let out = redact_url(url);
        assert!(
            !out.contains("s3cr3t"),
            "token must not appear in redacted output"
        );
        assert!(
            out.contains("X-Plex-Token=***"),
            "redaction placeholder must be present"
        );
    }

    #[test]
    fn redact_url_handles_token_with_trailing_params() {
        // Plex sometimes appends extra query params after the token.
        let url = "http://h/p?quality=high&X-Plex-Token=abc123&format=mkv";
        let out = redact_url(url);
        assert!(!out.contains("abc123"));
        assert!(
            out.contains("&format=mkv"),
            "params after token must be preserved"
        );
    }

    #[test]
    fn redact_url_is_case_insensitive_on_param_name() {
        let url = "http://h/p?x-plex-token=SECRETVAL";
        let out = redact_url(url);
        assert!(
            !out.contains("SECRETVAL"),
            "token value must be redacted regardless of param case"
        );
    }

    #[test]
    fn redact_url_passes_through_url_without_token() {
        // Non-auth URLs (e.g. HLS segment without inline token) must be unchanged.
        let url = "http://192.168.1.5:32400/video/:/transcode/universal/session/1/segments.m3u8";
        assert_eq!(redact_url(url), url);
    }

    // ── Path-traversal validation ──

    #[test]
    fn valid_path_components_are_accepted() {
        // Typical rating_key values from Plex (numeric strings).
        assert!(validate_path_component("12345").is_ok());
        assert!(validate_path_component("98765432").is_ok());
        // Typical file names from Plex media.
        assert!(validate_path_component("Movie.Title.2024.mkv").is_ok());
        assert!(validate_path_component("episode-s01e02.mp4").is_ok());
        assert!(validate_path_component("show_name_720p.avi").is_ok());
        assert!(validate_path_component("file with spaces.mkv").is_ok());
    }

    #[test]
    fn dot_dot_traversal_is_rejected() {
        assert!(validate_path_component("..").is_err());
        // A single dot is also rejected.
        assert!(validate_path_component(".").is_err());
    }

    #[test]
    fn forward_slash_traversal_is_rejected() {
        assert!(validate_path_component("../secret").is_err());
        assert!(validate_path_component("foo/bar").is_err());
        assert!(validate_path_component("/etc/passwd").is_err());
    }

    #[test]
    fn backslash_traversal_is_rejected() {
        assert!(validate_path_component("..\\secret").is_err());
        assert!(validate_path_component("foo\\bar").is_err());
        assert!(validate_path_component("\\Windows\\System32").is_err());
    }

    #[test]
    fn absolute_path_is_rejected() {
        // Unix absolute path caught by the leading slash check.
        assert!(validate_path_component("/absolute/path").is_err());
        // Windows absolute path caught by the backslash check.
        assert!(validate_path_component("\\absolute\\path").is_err());
    }

    #[test]
    fn drive_qualified_path_is_rejected() {
        // Windows drive letters like "C:" or "C:foo" must be rejected.
        assert!(validate_path_component("C:").is_err());
        assert!(validate_path_component("C:foo").is_err());
        assert!(validate_path_component("C:\\Windows").is_err());
        assert!(validate_path_component("Z:relative").is_err());
    }

    #[test]
    fn nul_byte_is_rejected() {
        assert!(validate_path_component("file\0name").is_err());
        assert!(validate_path_component("\0").is_err());
    }

    #[test]
    fn empty_string_is_rejected() {
        assert!(validate_path_component("").is_err());
    }

    #[test]
    fn shell_special_characters_are_rejected() {
        assert!(validate_path_component("file*name").is_err());
        assert!(validate_path_component("file?name").is_err());
        assert!(validate_path_component("file\"name").is_err());
        assert!(validate_path_component("file<name").is_err());
        assert!(validate_path_component("file>name").is_err());
        assert!(validate_path_component("file|name").is_err());
    }

    // ── part_key host-pinning (SSRF) ──

    #[test]
    fn valid_part_key_is_accepted() {
        assert!(validate_part_key("/library/parts/12345/1600000000/file.mkv").is_ok());
        assert!(validate_part_key("/library/parts/1/file.mkv?download=1").is_ok());
    }

    #[test]
    fn part_key_without_leading_slash_is_rejected() {
        // Userinfo injection: `server_url + "@evil.com"` makes evil.com the host.
        assert!(validate_part_key("@evil.com/steal").is_err());
        // An absolute URL overrides the host entirely.
        assert!(validate_part_key("http://evil.com/steal").is_err());
        // A bare relative path is not server-rooted.
        assert!(validate_part_key("library/parts/1/file.mkv").is_err());
        assert!(validate_part_key("").is_err());
    }

    #[test]
    fn protocol_relative_part_key_is_rejected() {
        assert!(validate_part_key("//evil.com/steal").is_err());
    }

    #[test]
    fn part_key_with_control_chars_is_rejected() {
        assert!(validate_part_key("/library\r\nHost: evil").is_err());
        assert!(validate_part_key("/library\0/x").is_err());
    }

    // ── concurrent same-key rejection ──

    #[test]
    fn try_claim_active_rejects_duplicate_key() {
        let active: ActiveMap = std::sync::Mutex::new(std::collections::HashMap::new());
        let (tx1, _rx1) = tokio::sync::watch::channel(false);
        let (tx2, _rx2) = tokio::sync::watch::channel(false);
        // First claim of the key succeeds.
        assert!(try_claim_active(&active, "42", tx1).is_ok());
        // A second, concurrent claim of the SAME key is rejected — the first
        // download's cancel Sender must not be clobbered.
        assert!(try_claim_active(&active, "42", tx2).is_err());
        assert_eq!(active.lock().unwrap().len(), 1);
    }

    #[test]
    fn try_claim_active_allows_distinct_keys() {
        let active: ActiveMap = std::sync::Mutex::new(std::collections::HashMap::new());
        let (tx1, _rx1) = tokio::sync::watch::channel(false);
        let (tx2, _rx2) = tokio::sync::watch::channel(false);
        assert!(try_claim_active(&active, "1", tx1).is_ok());
        assert!(try_claim_active(&active, "2", tx2).is_ok());
        assert_eq!(active.lock().unwrap().len(), 2);
    }

    // ── error-path cleanup (RAII guard) ──

    #[test]
    fn download_guard_releases_map_entry_and_keeps_partial_on_drop() {
        let dir = unique_temp_dir("guard");
        let temp_path = dir.join("file.mkv.part");
        std::fs::write(&temp_path, b"partial bytes").unwrap();
        assert!(temp_path.exists());

        let active: std::sync::Arc<ActiveMap> =
            std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
        let (tx, _rx) = tokio::sync::watch::channel(false);
        active.lock().unwrap().insert("77".to_string(), tx);
        assert_eq!(active.lock().unwrap().len(), 1);

        // Simulate a failed / early-returning download: the guard drops at the
        // end of this scope, mirroring an early `return Err(…)`.
        {
            let _guard = DownloadGuard {
                active: active.clone(),
                rating_key: "77".to_string(),
                temp_path: temp_path.clone(),
                queue: std::sync::Arc::new(super::Queue::new()),
                remove_partial: false,
            };
        }

        assert!(
            active.lock().unwrap().is_empty(),
            "active-map entry (cancel Sender) must be released on failure"
        );
        assert!(
            temp_path.exists(),
            "partial file must survive failure for resume"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scheduler_order_limit_and_reorder() {
        let manager = DownloadManager::new();
        manager.queue.state.lock().unwrap().waiting = ["a", "b", "c", "d"].map(String::from).into();
        assert!(!manager.queue.admit("b"));
        assert!(manager.queue.admit("a"));
        assert!(!manager.queue.admit("b"));
        control_queue(&manager, "limit", None, None, Some(3)).unwrap();
        control_queue(
            &manager,
            "reorder",
            None,
            Some(&["c".into(), "b".into()]),
            None,
        )
        .unwrap();
        assert!(!manager.queue.admit("b"));
        assert!(manager.queue.admit("c"));
        assert!(manager.queue.admit("b"));
        assert!(!manager.queue.admit("d"));
        assert!(control_queue(&manager, "limit", None, None, Some(4)).is_err());
        manager.queue.state.lock().unwrap().running.remove("a");
        assert!(manager.queue.admit("d"));
    }

    #[test]
    fn pause_all_latches_running_stops_and_resume_all_reopens_admission() {
        let manager = DownloadManager::new();
        let (tx, rx) = tokio::sync::watch::channel(false);
        try_claim_active(&manager.active, "a", tx).unwrap();
        manager.queue.state.lock().unwrap().waiting = ["a", "b"].map(String::from).into();
        assert!(manager.queue.admit("a"));
        control_queue(&manager, "pauseAll", None, None, None).unwrap();
        assert!(*rx.borrow());
        assert!(!manager.queue.admit("b"));
        control_queue(&manager, "resumeAll", None, None, None).unwrap();
        assert!(
            manager.queue.is_paused("a"),
            "resume must not turn an acknowledged pause into cancel"
        );
        drop(DownloadGuard {
            active: manager.active.clone(),
            rating_key: "a".into(),
            temp_path: PathBuf::new(),
            queue: manager.queue.clone(),
            remove_partial: false,
        });
        assert!(manager.queue.admit("b"));
    }

    #[test]
    fn range_validation_rejects_wrong_offsets_and_reports_unknown_eta() {
        use reqwest::StatusCode;
        assert_eq!(
            response_offset(StatusCode::PARTIAL_CONTENT, Some("bytes 3-5/6"), 3).unwrap(),
            (3, Some(6))
        );
        assert!(response_offset(StatusCode::PARTIAL_CONTENT, Some("bytes 2-5/6"), 3).is_err());
        assert!(response_offset(StatusCode::PARTIAL_CONTENT, None, 3).is_err());
        assert_eq!(response_offset(StatusCode::OK, None, 3).unwrap(), (0, None));
        assert_eq!(eta(20, 100, 10.0), Some(8));
        assert_eq!(eta(20, 0, 10.0), None);
        assert_eq!(eta(20, 100, 0.0), None);
    }

    // Local synthetic HTTP fixtures contain no Plex data or credentials.
    fn fixture_server(
        response: &'static str,
        expected_range: bool,
    ) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/fixture", listener.local_addr().unwrap());
        let thread = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                socket.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            let request = String::from_utf8(request).unwrap().to_lowercase();
            assert_eq!(request.contains("range: bytes=3-"), expected_range);
            socket.write_all(response.as_bytes()).unwrap();
        });
        (url, thread)
    }

    #[tokio::test]
    async fn resume_after_restart_uses_disk_length_and_appends_exact_bytes() {
        let dir = unique_temp_dir("resume");
        let part = dir.join("movie.part");
        let final_path = dir.join("movie");
        std::fs::write(&part, b"abc").unwrap();
        // No manager state from the previous process is available.
        let (url, server) = fixture_server("HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 3-5/6\r\nConnection: close\r\n\r\ndef", true);
        let (_tx, mut rx) = tokio::sync::watch::channel(false);
        assert_eq!(
            transfer(
                &url,
                "",
                &part,
                &final_path,
                6,
                &mut rx,
                &|_, _, _, _, _| {}
            )
            .await
            .unwrap(),
            Some(6)
        );
        server.join().unwrap();
        assert_eq!(std::fs::read(&final_path).unwrap(), b"abcdef");
        assert!(!part.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn ignored_range_restarts_without_duplicate_bytes_and_emits_reason() {
        let dir = unique_temp_dir("restart");
        let part = dir.join("movie.part");
        let final_path = dir.join("movie");
        std::fs::write(&part, b"old").unwrap();
        let (url, server) = fixture_server(
            "HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabcdef",
            true,
        );
        let (_tx, mut rx) = tokio::sync::watch::channel(false);
        let messages = std::sync::Mutex::new(Vec::new());
        transfer(
            &url,
            "",
            &part,
            &final_path,
            6,
            &mut rx,
            &|_, _, _, _, message| {
                if let Some(m) = message {
                    messages.lock().unwrap().push(m);
                }
            },
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(std::fs::read(&final_path).unwrap(), b"abcdef");
        assert!(messages
            .lock()
            .unwrap()
            .iter()
            .any(|m| m.contains("restarting from zero")));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn pause_flushes_buffer_and_second_transfer_resumes() {
        use std::io::{Read, Write};
        let dir = unique_temp_dir("pause");
        let part = dir.join("movie.part");
        let final_path = dir.join("movie");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/fixture", listener.local_addr().unwrap());
        let (tx, mut rx) = tokio::sync::watch::channel(false);
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0; 2048];
            assert!(socket.read(&mut request).unwrap() > 0);
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nabc")
                .unwrap();
            // Keep the body open so cancellation, rather than EOF, ends the transfer.
            std::thread::sleep(std::time::Duration::from_millis(250));
            tx.send(true).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(100));
        });
        assert_eq!(
            transfer(
                &url,
                "",
                &part,
                &final_path,
                6,
                &mut rx,
                &|_, _, _, _, _| {}
            )
            .await
            .unwrap(),
            None
        );
        server.join().unwrap();
        assert_eq!(std::fs::read(&part).unwrap(), b"abc");
        let (url, server) = fixture_server("HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 3-5/6\r\nConnection: close\r\n\r\ndef", true);
        let (_tx, mut rx) = tokio::sync::watch::channel(false);
        transfer(
            &url,
            "",
            &part,
            &final_path,
            6,
            &mut rx,
            &|_, _, _, _, _| {},
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(std::fs::read(&final_path).unwrap(), b"abcdef");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn unavailable_saved_range_restarts_from_zero() {
        use std::io::{Read, Write};
        let dir = unique_temp_dir("range-416");
        let part = dir.join("movie.part");
        let final_path = dir.join("movie");
        std::fs::write(&part, b"obsolete").unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/fixture", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for first in [true, false] {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while !request.ends_with(b"\r\n\r\n") {
                    socket.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                }
                assert_eq!(
                    String::from_utf8(request)
                        .unwrap()
                        .to_lowercase()
                        .contains("range: bytes=8-"),
                    first
                );
                socket.write_all(if first {
                    b"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                } else { b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\nabcdef" }).unwrap();
            }
        });
        let (_tx, mut rx) = tokio::sync::watch::channel(false);
        transfer(
            &url,
            "",
            &part,
            &final_path,
            6,
            &mut rx,
            &|_, _, _, _, _| {},
        )
        .await
        .unwrap();
        server.join().unwrap();
        assert_eq!(std::fs::read(&final_path).unwrap(), b"abcdef");
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// Explicit opt-in: the only remote fixture this test permits is the named
    /// QA server's synthetic pattern. Credentials and connection URLs stay in memory.
    #[tokio::test]
    #[ignore = "requires PREXU_QA_PLEX_AUTH and the Prexu QA Test Server"]
    async fn qa_server_range_resume_matches_original() {
        let token = std::env::var("PREXU_QA_PLEX_AUTH").expect("QA credential required");
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap();
        let resources_text = client
            .get("https://plex.tv/api/v2/resources?includeHttps=1")
            .header("X-Plex-Client-Identifier", "prexu-download-tests")
            .header("X-Plex-Token", &token)
            .header("Accept", "application/json")
            .send()
            .await
            .unwrap_or_else(|_| panic!("QA discovery request"))
            .text()
            .await
            .unwrap_or_else(|_| panic!("QA discovery JSON"));
        let resources: serde_json::Value =
            serde_json::from_str(&resources_text).expect("QA resource JSON");
        let server = resources
            .as_array()
            .expect("Plex resource list; verify required client headers")
            .iter()
            .find(|r| r["name"] == "Prexu QA Test Server" && r["provides"] == "server")
            .expect("Named QA server");
        let credential = server["accessToken"]
            .as_str()
            .expect("QA server credential");
        let mut fixture = None;
        for connection in server["connections"].as_array().unwrap() {
            let Some(uri) = connection["uri"].as_str() else {
                continue;
            };
            let Ok(response) = client
                .get(format!("{}/library/metadata/2", uri))
                .header("X-Plex-Token", credential)
                .header("Accept", "application/json")
                .send()
                .await
            else {
                continue;
            };
            let Ok(body) = response.text().await else {
                continue;
            };
            let Ok(data) = serde_json::from_str::<serde_json::Value>(&body) else {
                continue;
            };
            let item = &data["MediaContainer"]["Metadata"][0];
            if item["title"] != "Prexu QA Pattern" || item["ratingKey"] != "2" {
                continue;
            }
            let part = &item["Media"][0]["Part"][0];
            fixture = Some((
                format!("{}{}", uri, part["key"].as_str().unwrap()),
                part["size"]
                    .as_u64()
                    .or_else(|| part["size"].as_str()?.parse().ok())
                    .expect("QA part size"),
            ));
            break;
        }
        let (url, size) = fixture.expect("Reachable synthetic QA fixture");
        let response = client
            .get(&url)
            .header("X-Plex-Token", credential)
            .header("Range", "bytes=0-1023")
            .send()
            .await
            .unwrap_or_else(|_| panic!("QA Range request"));
        assert_eq!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);
        let prefix = response
            .bytes()
            .await
            .unwrap_or_else(|_| panic!("QA prefix"));
        assert_eq!(prefix.len(), 1024);
        let dir = unique_temp_dir("qa-resume");
        let part = dir.join("fixture.part");
        let final_path = dir.join("fixture");
        std::fs::write(&part, &prefix).unwrap();
        let (_tx, mut rx) = tokio::sync::watch::channel(false);
        let result = transfer(
            &url,
            credential,
            &part,
            &final_path,
            size,
            &mut rx,
            &|_, _, _, _, _| {},
        )
        .await;
        // Do not render raw request failures: the assertion carries no URL or token.
        assert!(result.is_ok(), "QA resumed transfer succeeds");
        let original = client
            .get(&url)
            .header("X-Plex-Token", credential)
            .send()
            .await
            .unwrap_or_else(|_| panic!("QA original request"))
            .bytes()
            .await
            .unwrap_or_else(|_| panic!("QA original bytes"));
        let downloaded = std::fs::read(&final_path).unwrap();
        assert!(
            downloaded.as_slice() == original.as_ref(),
            "Resumed bytes equal original"
        );
        assert_eq!(downloaded.len() as u64, size);
        std::fs::remove_dir_all(dir).unwrap();
        println!(
            "QA server returned HTTP 206; restart resume matched all {} original bytes",
            size
        );
    }

    // ── path-traversal rejection at the sinks (with no fs mutation) ──

    #[tokio::test]
    async fn delete_download_rejects_traversal_and_does_not_mutate_fs() {
        let base = unique_temp_dir("del");
        let downloads = base.join("downloads");
        std::fs::create_dir_all(&downloads).unwrap();
        // A victim directory OUTSIDE the downloads dir that an unguarded
        // `join("../victim")` / absolute path would recursively delete.
        let victim = base.join("victim");
        std::fs::create_dir_all(&victim).unwrap();
        std::fs::write(victim.join("keep.txt"), b"important").unwrap();

        let manager = DownloadManager::new();
        *manager.downloads_dir.lock().await = Some(downloads.clone());

        assert!(
            delete_download_impl("../victim", &manager).await.is_err(),
            "'..' traversal rating_key must be rejected"
        );
        let victim_abs = victim.to_string_lossy().to_string();
        assert!(
            delete_download_impl(&victim_abs, &manager).await.is_err(),
            "absolute-path rating_key must be rejected"
        );

        assert!(
            victim.join("keep.txt").exists(),
            "delete_download must not escape the downloads dir and delete outside files"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn get_local_file_path_rejects_traversal() {
        let base = unique_temp_dir("glp");
        let downloads = base.join("downloads");
        std::fs::create_dir_all(&downloads).unwrap();
        let secret = base.join("secret");
        std::fs::create_dir_all(&secret).unwrap();
        std::fs::write(secret.join("passwd"), b"root:x:0:0").unwrap();

        let manager = DownloadManager::new();
        *manager.downloads_dir.lock().await = Some(downloads.clone());

        assert!(
            get_local_file_path_impl("../secret", &manager)
                .await
                .is_err(),
            "'..' traversal rating_key must be rejected, not enumerated"
        );
        let secret_abs = secret.to_string_lossy().to_string();
        assert!(
            get_local_file_path_impl(&secret_abs, &manager)
                .await
                .is_err(),
            "absolute-path rating_key must be rejected"
        );

        // A valid but non-existent key still returns Ok(None), not an error.
        assert!(matches!(
            get_local_file_path_impl("99999", &manager).await,
            Ok(None)
        ));

        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn playback_file_resolves_only_complete_downloads() {
        let base = unique_temp_dir("playback");
        let downloads = base.join("downloads");
        let item = downloads.join("123");
        std::fs::create_dir_all(&item).unwrap();
        let manager = DownloadManager::new();
        *manager.downloads_dir.lock().await = Some(downloads);
        assert!(super::playback_file("../secret", &manager).await.is_err());
        assert!(super::playback_file("missing", &manager).await.is_err());
        std::fs::write(item.join("video.part"), b"partial").unwrap();
        assert!(super::playback_file("123", &manager).await.is_err());
        let video = item.join("video with spaces.mp4");
        std::fs::write(&video, b"complete").unwrap();
        assert_eq!(
            super::playback_file("123", &manager).await.unwrap(),
            std::fs::canonicalize(&video).unwrap().to_str().unwrap(),
        );
        std::fs::remove_file(video).unwrap();
        assert!(super::playback_file("123", &manager).await.is_err());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn playback_file_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;
        let base = unique_temp_dir("playback-symlink");
        let downloads = base.join("downloads");
        let item = downloads.join("123");
        std::fs::create_dir_all(&item).unwrap();
        let secret = base.join("secret.mp4");
        std::fs::write(&secret, b"secret").unwrap();
        let manager = DownloadManager::new();
        *manager.downloads_dir.lock().await = Some(downloads.clone());
        symlink(&secret, item.join("video.mp4")).unwrap();
        assert!(super::playback_file("123", &manager).await.is_err());
        std::fs::remove_dir_all(&item).unwrap();
        symlink(&base, &item).unwrap();
        assert!(super::playback_file("123", &manager).await.is_err());
        std::fs::remove_dir_all(base).unwrap();
    }
}
