use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};
use futures_util::StreamExt;

use crate::validate_server_url;

/// Process-shared download client (prexu-0szx.12): reqwest's connection
/// pool + TLS session only get reused when the `Client` itself is —
/// per-call `Client::new()` paid a fresh TCP+TLS handshake per download.
fn download_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
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
    if part_key.chars().any(|c| c == '\0' || c == '\r' || c == '\n') {
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

/// RAII guard that guarantees a download's active-map entry and its partial
/// `.part` temp file are cleaned up if `download_media` returns early for ANY
/// reason (request failure, non-2xx, write/flush/rename error, stream error,
/// or cancellation). Without it, an early `return Err(…)` before the manual
/// cleanup stranded the cancel `Sender` in the map forever and left the temp
/// file on disk.
///
/// Cleanup is synchronous (safe in `Drop`): a `std::sync::Mutex` lock plus a
/// best-effort `std::fs::remove_file`. The guard is declared *before* the file
/// handle, so at scope exit the `BufWriter`/`File` drops first (closing the fd)
/// and the temp file is removed afterwards — correct ordering on Windows.
struct DownloadGuard {
    active: Arc<ActiveMap>,
    rating_key: String,
    temp_path: PathBuf,
}

impl Drop for DownloadGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.rating_key);
        }
        // On the success path the temp file has already been renamed away, so
        // NotFound is expected and silent; only surface real removal errors.
        match std::fs::remove_file(&self.temp_path) {
            Ok(()) => log::debug!("[downloads] removed partial temp file on cleanup"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log::warn!("[downloads] failed to remove temp file on cleanup: {}", e),
        }
    }
}

impl DownloadManager {
    pub fn new() -> Self {
        Self {
            active: Arc::new(std::sync::Mutex::new(HashMap::new())),
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
        log::warn!("[downloads] rejected download request: invalid rating_key — {}", reason);
        return Err(format!("Invalid rating_key: {}", reason));
    }
    if let Err(reason) = validate_path_component(&file_name) {
        log::warn!("[downloads] rejected download request: invalid file_name — {}", reason);
        return Err(format!("Invalid file_name: {}", reason));
    }
    // Guard against SSRF: a non-rooted part_key could redirect the token-bearing
    // fetch to an attacker host. Log the reason only, never the raw value.
    if let Err(reason) = validate_part_key(&part_key) {
        log::warn!("[downloads] rejected download request: invalid part_key — {}", reason);
        return Err(format!("Invalid part_key: {}", reason));
    }

    let downloads_dir = resolve_downloads_dir().await?;
    let item_dir = downloads_dir.join(&rating_key);
    tokio::fs::create_dir_all(&item_dir)
        .await
        .map_err(|e| format!("Failed to create item directory: {}", e))?;

    let final_path = item_dir.join(&file_name);
    let temp_path = item_dir.join(format!("{}.part", &file_name));

    // Set up cancellation and atomically claim the rating_key (rejects a second
    // in-flight download of the same key — see `try_claim_active`).
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    try_claim_active(&state.active, &rating_key, cancel_tx)?;

    // From here on, any early return must release the active-map entry AND drop
    // the partial temp file. This RAII guard does both on scope exit, so the
    // error paths below only need to emit progress + return.
    let _cleanup = DownloadGuard {
        active: state.active.clone(),
        rating_key: rating_key.clone(),
        temp_path: temp_path.clone(),
    };

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
    let response = download_client()
        .get(&url)
        .send()
        .await
        // Strip the URL (contains X-Plex-Token) from reqwest's error before
        // returning it to the webview or logging it.
        .map_err(|e| format!("Download request failed: {}", e.without_url()))?;

    if !response.status().is_success() {
        let status = response.status();
        emit_progress(0, "error", Some(format!("HTTP {}", status)));
        return Err(format!("Download failed with HTTP {}", status));
    }

    let total = response.content_length().unwrap_or(file_size);
    let mut stream = response.bytes_stream();
    // BufWriter coalesces the per-HTTP-chunk write_all calls (each one is a
    // tokio blocking-pool dispatch) into 256 KiB file writes (prexu-0szx.12).
    // The post-loop flush() drains it before the rename; the error/cancel
    // paths drop it unflushed, which is fine — the temp file is deleted.
    let mut file = tokio::io::BufWriter::with_capacity(
        256 * 1024,
        tokio::fs::File::create(&temp_path)
            .await
            .map_err(|e| format!("Failed to create temp file: {}", e))?,
    );

    if total == 0 {
        log::debug!("[downloads] unknown total size for {} — content-length missing and file_size=0; in-loop 100% gate disabled", rating_key);
    }
    log::info!("[Download] Start: {} ({} bytes) -> {:?}", rating_key, total, temp_path);

    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;
    let mut last_emit_at = std::time::Instant::now();
    let emit_interval_bytes: u64 = 512 * 1024;
    // On LAN the 512KB byte gate alone fires hundreds of events/sec, which
    // floods the webview with state updates and starves UI interaction —
    // a wall-clock gate caps the rate regardless of throughput.
    const EMIT_INTERVAL_MS: u128 = 500;

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

                        let gates_open = downloaded - last_emit >= emit_interval_bytes
                            && last_emit_at.elapsed().as_millis() >= EMIT_INTERVAL_MS;
                        // Only use the `downloaded >= total` shortcut when total is
                        // known; with total == 0 (missing content-length + file_size)
                        // the condition would be true on every chunk, flooding the
                        // webview with events on each byte received.
                        let at_end = progress_at_end(downloaded, total);
                        if gates_open || at_end {
                            emit_progress(downloaded, "downloading", None);
                            last_emit = downloaded;
                            last_emit_at = std::time::Instant::now();
                        }
                    }
                    Some(Err(e)) => {
                        // Strip the URL (contains X-Plex-Token) before logging
                        // or forwarding to the webview via the progress event.
                        let safe_err = e.without_url();
                        log::error!("[downloads] stream error for {}: {:?}", rating_key, safe_err);
                        emit_progress(downloaded, "error", Some(safe_err.to_string()));
                        // _cleanup guard drops the map entry + temp file on return.
                        return Err(format!("Download error: {}", safe_err));
                    }
                    None => break, // Stream complete
                }
            }
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    emit_progress(downloaded, "cancelled", None);
                    // _cleanup guard drops the map entry + temp file on return.
                    return Ok(());
                }
            }
        }
    }

    // Flush and rename. Drop the writer first so the OS file handle is closed
    // before the rename (required on Windows).
    file.flush().await.map_err(|e| format!("Failed to flush file: {}", e))?;
    drop(file);
    tokio::fs::rename(&temp_path, &final_path)
        .await
        .map_err(|e| format!("Failed to finalize download: {}", e))?;

    // Emit final 100% exactly once. Use `downloaded` (actual bytes written)
    // rather than `total` so unknown-size downloads (total == 0) still report
    // the real byte count in the complete event.
    emit_progress(downloaded, "complete", None);

    // The _cleanup guard removes the active-map entry (and the now-renamed-away
    // temp file, which is a no-op) when it drops at end of scope.
    log::info!("[Download] Complete: {} -> {:?}", rating_key, final_path);
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
        log::warn!("[downloads] rejected delete_download: invalid rating_key — {}", reason);
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
pub async fn open_downloads_dir(
    state: tauri::State<'_, DownloadManager>,
) -> Result<(), String> {
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

    result
        .map(|_| ())
        .map_err(|e| {
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
        log::warn!("[downloads] rejected get_local_file_path: invalid rating_key — {}", reason);
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
    use super::{
        delete_download_impl, get_local_file_path_impl, progress_at_end, try_claim_active,
        validate_part_key, validate_path_component, ActiveMap, DownloadGuard, DownloadManager,
    };
    use crate::util::redact_url;

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
        let dir = std::env::temp_dir()
            .join(format!("prexu-test-{}-{}-{}-{}", tag, std::process::id(), nanos, n));
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
        assert!(!out.contains("s3cr3t"), "token must not appear in redacted output");
        assert!(out.contains("X-Plex-Token=***"), "redaction placeholder must be present");
    }

    #[test]
    fn redact_url_handles_token_with_trailing_params() {
        // Plex sometimes appends extra query params after the token.
        let url = "http://h/p?quality=high&X-Plex-Token=abc123&format=mkv";
        let out = redact_url(url);
        assert!(!out.contains("abc123"));
        assert!(out.contains("&format=mkv"), "params after token must be preserved");
    }

    #[test]
    fn redact_url_is_case_insensitive_on_param_name() {
        let url = "http://h/p?x-plex-token=SECRETVAL";
        let out = redact_url(url);
        assert!(!out.contains("SECRETVAL"), "token value must be redacted regardless of param case");
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
    fn download_guard_releases_map_entry_and_temp_file_on_drop() {
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
            };
        }

        assert!(
            active.lock().unwrap().is_empty(),
            "active-map entry (cancel Sender) must be released on failure"
        );
        assert!(!temp_path.exists(), "partial .part temp file must be removed on failure");

        let _ = std::fs::remove_dir_all(&dir);
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
            get_local_file_path_impl("../secret", &manager).await.is_err(),
            "'..' traversal rating_key must be rejected, not enumerated"
        );
        let secret_abs = secret.to_string_lossy().to_string();
        assert!(
            get_local_file_path_impl(&secret_abs, &manager).await.is_err(),
            "absolute-path rating_key must be rejected"
        );

        // A valid but non-existent key still returns Ok(None), not an error.
        assert!(matches!(
            get_local_file_path_impl("99999", &manager).await,
            Ok(None)
        ));

        let _ = std::fs::remove_dir_all(&base);
    }
}
