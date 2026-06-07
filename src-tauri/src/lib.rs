mod downloads;
mod player;

use tauri_plugin_log::{Target, TargetKind};
use tauri::{AppHandle, Manager};
use std::io::{BufRead, BufReader, Read as StdRead, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

// ── Local HTTP proxy for HLS streaming ──
//
// Runs a lightweight TCP server on 127.0.0.1 that proxies requests
// to the Plex server. hls.js makes normal HTTP requests to localhost,
// the proxy forwards them to Plex with authentication, and streams
// the response back over TCP. Zero IPC overhead for binary segment data.

struct ProxyState {
    port: Mutex<Option<u16>>,
    server_url: Arc<Mutex<String>>,
    token: Arc<Mutex<String>>,
    downloads_dir: Arc<Mutex<Option<String>>>,
}

impl ProxyState {
    fn new() -> Self {
        Self {
            port: Mutex::new(None),
            server_url: Arc::new(Mutex::new(String::new())),
            token: Arc::new(Mutex::new(String::new())),
            downloads_dir: Arc::new(Mutex::new(None)),
        }
    }
}

/// Show the main window. Called from the frontend once React has painted
/// its first frame (App.tsx useLayoutEffect). The window is created with
/// `visible: false` in tauri.conf.json so it stays hidden until content
/// has rendered, avoiding the "transparent window shows desktop pixels
/// before chrome paints" flash (prexu-vs5). Idempotent — calling on an
/// already-visible window is a no-op.
///
/// Also kicks off a one-shot mpv warmup (prexu-204): on first call, a
/// background thread invokes `PlayerState::ensure_init` so the hwdec
/// probe + DXGI swapchain build are paid here instead of on the user's
/// first Play. Idempotent via the underlying ensure_init mutex — if the
/// frontend ever invokes app_ready more than once, the second warmup
/// call short-circuits at the `guard.is_some()` check.
#[tauri::command]
fn app_ready(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        log::info!("[setup] app_ready — frontend signalled first paint; showing window");
        window.show().map_err(|e| format!("show failed: {e}"))?;
        let _ = window.set_focus();
    }

    // Warmup: pre-create host window + libmpv handle on a background
    // thread so the user's first Play skips the hwdec probe + VO
    // selection (~12 s observed on a cold Win11 boot). The handle stays
    // parked in PlayerState; player_load_url's ensure_init is a no-op
    // when it runs after warmup completes.
    #[cfg(target_os = "windows")]
    {
        let warmup_handle = app.clone();
        std::thread::spawn(move || {
            let start = std::time::Instant::now();
            let state = warmup_handle.state::<player::PlayerState>();
            log::info!("[player:warmup] starting (cold-start hwdec probe)");
            match state.ensure_init(&warmup_handle) {
                Ok(()) => log::info!(
                    "[player:warmup] complete in {} ms",
                    start.elapsed().as_millis()
                ),
                Err(e) => log::warn!(
                    "[player:warmup] failed after {} ms: {} — first Play will pay the init cost",
                    start.elapsed().as_millis(),
                    e
                ),
            }
        });
    }

    Ok(())
}

/// Validate that a server URL looks like a legitimate Plex server.
/// Accepts http/https URLs only — rejects file://, ftp://, etc.
pub fn validate_server_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("Invalid server URL: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("Unsupported URL scheme: {}", scheme)),
    }
    let host = parsed.host_str().ok_or("Server URL has no host")?;
    // Block well-known metadata endpoints (cloud provider SSRF targets)
    if host == "169.254.169.254" || host == "metadata.google.internal" {
        return Err("Blocked: cloud metadata endpoint".into());
    }
    Ok(())
}

/// Start (or reuse) the local HTTP proxy. Returns the port number.
/// Called from JS before HLS playback begins.
#[tauri::command]
fn start_proxy(
    server_url: String,
    token: String,
    state: tauri::State<'_, ProxyState>,
) -> Result<u16, String> {
    // Validate server URL before storing
    validate_server_url(&server_url)?;

    // Always update the server URL and token (user may switch servers)
    *state.server_url.lock().map_err(|e| format!("Lock poisoned: {}", e))? = server_url;
    *state.token.lock().map_err(|e| format!("Lock poisoned: {}", e))? = token;

    // If proxy is already running, reuse it
    let mut port_guard = state.port.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
    if let Some(port) = *port_guard {
        return Ok(port);
    }

    // Bind to a random available port on localhost
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind proxy: {}", e))?;
    let port = listener.local_addr()
        .map_err(|e| format!("Failed to get proxy address: {}", e))?.port();

    // Resolve downloads directory for local file serving
    {
        let mut dl_dir = state.downloads_dir.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        if dl_dir.is_none() {
            let base = dirs::video_dir()
                .or_else(dirs::data_local_dir);
            if let Some(base) = base {
                let dir = base.join("Prexu");
                let _ = std::fs::create_dir_all(&dir);
                *dl_dir = Some(dir.to_string_lossy().to_string());
            }
        }
    }

    let server_url_ref = state.server_url.clone();
    let token_ref = state.token.clone();
    let downloads_dir_ref = state.downloads_dir.clone();

    thread::spawn(move || {
        let client = match reqwest::blocking::Client::builder().build() {
            Ok(c) => c,
            Err(e) => {
                log::error!("[Proxy] Failed to build HTTP client: {}", e);
                return;
            }
        };

        for stream in listener.incoming().flatten() {
            let su = server_url_ref.lock().unwrap_or_else(|e| e.into_inner()).clone();
            let tk = token_ref.lock().unwrap_or_else(|e| e.into_inner()).clone();
            let dl = downloads_dir_ref.lock().unwrap_or_else(|e| e.into_inner()).clone();
            let client = client.clone();
            thread::spawn(move || {
                if let Err(e) = handle_proxy_request(stream, &su, &tk, &client, dl.as_deref()) {
                    log::error!("[Proxy] Request error: {}", e);
                }
            });
        }
    });

    *port_guard = Some(port);
    log::info!("[Proxy] Started on 127.0.0.1:{}", port);
    Ok(port)
}

fn handle_proxy_request(
    mut stream: TcpStream,
    server_url: &str,
    token: &str,
    client: &reqwest::blocking::Client,
    downloads_dir: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Set a read timeout so we don't hang on bad connections
    stream.set_read_timeout(Some(std::time::Duration::from_secs(10)))?;

    let reader = BufReader::new(&stream);
    let mut lines = reader.lines();

    // Parse request line: "GET /path/to/resource HTTP/1.1"
    let request_line = lines
        .next()
        .ok_or("No request line")??;
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        write_error(&mut stream, 400, "Bad Request")?;
        return Ok(());
    }
    let method = parts[0];
    let path = parts[1];

    // Read headers (capture Range header if present)
    let mut range_header: Option<String> = None;
    for line in &mut lines {
        let line = line?;
        if line.is_empty() {
            break;
        }
        if line.to_lowercase().starts_with("range:") {
            range_header = Some(line[6..].trim().to_string());
        }
    }

    // Handle CORS preflight
    if method == "OPTIONS" {
        let response = "HTTP/1.1 200 OK\r\n\
            Access-Control-Allow-Origin: https://tauri.localhost\r\n\
            Access-Control-Allow-Methods: GET, OPTIONS\r\n\
            Access-Control-Allow-Headers: Range, Content-Type\r\n\
            Content-Length: 0\r\n\
            \r\n";
        stream.write_all(response.as_bytes())?;
        return Ok(());
    }

    // Serve local downloaded files via /local/{ratingKey}
    if path.starts_with("/local/") {
        let rating_key = &path[7..]; // strip "/local/"
        if let Some(dl_dir) = downloads_dir {
            let item_dir = std::path::Path::new(dl_dir).join(rating_key);
            // Find the first non-.part file
            if let Ok(entries) = std::fs::read_dir(&item_dir) {
                for entry in entries.flatten() {
                    let file_path = entry.path();
                    if file_path.is_file() && !file_path.to_string_lossy().ends_with(".part") {
                        // Serve the local file
                        let mut file = std::fs::File::open(&file_path)?;
                        let metadata = file.metadata()?;
                        let file_size = metadata.len();
                        let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
                        let content_type = match ext {
                            "mp4" | "m4v" => "video/mp4",
                            "mkv" => "video/x-matroska",
                            "avi" => "video/x-msvideo",
                            "mov" => "video/quicktime",
                            _ => "application/octet-stream",
                        };

                        // Handle Range requests for seeking
                        if let Some(ref range) = range_header {
                            if let Some(start) = parse_range_start(range, file_size) {
                                let end = file_size - 1;
                                let length = end - start + 1;
                                use std::io::Seek;
                                file.seek(std::io::SeekFrom::Start(start))?;
                                let mut buf = vec![0u8; length as usize];
                                file.read_exact(&mut buf)?;
                                let header = format!(
                                    "HTTP/1.1 206 Partial Content\r\n\
                                     Content-Type: {}\r\n\
                                     Content-Length: {}\r\n\
                                     Content-Range: bytes {}-{}/{}\r\n\
                                     Accept-Ranges: bytes\r\n\
                                     Access-Control-Allow-Origin: https://tauri.localhost\r\n\
                                     Connection: close\r\n\r\n",
                                    content_type, length, start, end, file_size
                                );
                                stream.write_all(header.as_bytes())?;
                                stream.write_all(&buf)?;
                                stream.flush()?;
                                return Ok(());
                            }
                        }

                        // Full file response
                        let mut buf = Vec::with_capacity(file_size as usize);
                        file.read_to_end(&mut buf)?;
                        let header = format!(
                            "HTTP/1.1 200 OK\r\n\
                             Content-Type: {}\r\n\
                             Content-Length: {}\r\n\
                             Accept-Ranges: bytes\r\n\
                             Access-Control-Allow-Origin: https://tauri.localhost\r\n\
                             Connection: close\r\n\r\n",
                            content_type, file_size
                        );
                        stream.write_all(header.as_bytes())?;
                        stream.write_all(&buf)?;
                        stream.flush()?;
                        return Ok(());
                    }
                }
            }
            write_error(&mut stream, 404, "Downloaded file not found")?;
            return Ok(());
        }
        write_error(&mut stream, 404, "Downloads directory not configured")?;
        return Ok(());
    }

    // Build target URL: server_url + path (which includes query string)
    let target_url = if !path.contains("X-Plex-Token=") {
        let sep = if path.contains('?') { "&" } else { "?" };
        format!("{}{}{}{}{}", server_url, path, sep, "X-Plex-Token=", token)
    } else {
        format!("{}{}", server_url, path)
    };

    // Build the outgoing request
    let mut req = client.get(&target_url);
    if let Some(ref range) = range_header {
        req = req.header("Range", range.as_str());
    }

    // Execute the request to Plex
    let resp = req.send()?;

    let status = resp.status();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let content_range = resp
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let body = resp.bytes()?;

    // Write HTTP response back to the WebView
    let mut header = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: {}\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: https://tauri.localhost\r\n\
         Connection: close\r\n",
        status.as_u16(),
        status.canonical_reason().unwrap_or(""),
        content_type,
        body.len()
    );
    if let Some(cr) = content_range {
        header.push_str(&format!("Content-Range: {}\r\n", cr));
    }
    header.push_str("\r\n");

    stream.write_all(header.as_bytes())?;
    stream.write_all(&body)?;
    stream.flush()?;

    Ok(())
}

/// Parse the start byte from a Range header like "bytes=1234-"
fn parse_range_start(range: &str, file_size: u64) -> Option<u64> {
    let range = range.trim();
    if !range.starts_with("bytes=") {
        return None;
    }
    let spec = &range[6..];
    let parts: Vec<&str> = spec.split('-').collect();
    if parts.is_empty() {
        return None;
    }
    let start = parts[0].parse::<u64>().ok()?;
    if start >= file_size {
        return None;
    }
    Some(start)
}

fn write_error(
    stream: &mut TcpStream,
    status: u16,
    message: &str,
) -> Result<(), std::io::Error> {
    let response = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: text/plain\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: https://tauri.localhost\r\n\
         Connection: close\r\n\
         \r\n\
         {}",
        status, message, message.len(), message
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}

// ── App entry point ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ProxyState::new())
        .manage(downloads::DownloadManager::new())
        .manage(player::PlayerState::new())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // If a second instance is launched, focus the existing window
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        }))
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .level_for("app_lib::player", if cfg!(debug_assertions) {
                    log::LevelFilter::Trace
                } else {
                    log::LevelFilter::Debug
                })
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                .max_file_size(20_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            start_proxy,
            app_ready,
            downloads::get_downloads_dir,
            downloads::download_media,
            downloads::cancel_download,
            downloads::delete_download,
            downloads::get_local_file_path,
            player::commands::player_load_url,
            player::commands::player_play,
            player::commands::player_pause,
            player::commands::player_seek,
            player::commands::player_set_volume,
            player::commands::player_set_muted,
            player::commands::player_set_audio_track,
            player::commands::player_set_sub_track,
            player::commands::player_load_external_sub,
            player::commands::player_set_audio_delay_ms,
            player::commands::player_set_af_chain,
            player::commands::player_apply_sub_style,
            player::commands::player_unload,
            player::commands::player_stop,
            player::commands::player_set_fullscreen,
            player::commands::player_enter_popout,
            player::commands::player_exit_popout,
            player::commands::player_enter_minimize,
            player::commands::player_exit_minimize,
            player::commands::player_update_mini_geometry,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // Window is `visible: false` in tauri.conf.json. We do NOT
                // call window.show() here — the frontend invokes
                // app_ready once React has painted its first frame
                // (prexu-vs5). Without that handshake the user sees the
                // OS window frame appear over a transparent client area
                // for the duration of the WebView's HTML-parse + CSS
                // load + first React commit.
                //
                // Safety net: if the frontend never signals (broken
                // bundle, JS error before mount, etc.), show the window
                // after 3 s so the user isn't staring at nothing. The
                // common case lands in well under 500 ms.
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(3000));
                    if let Some(w) = app_handle.get_webview_window("main") {
                        if !w.is_visible().unwrap_or(true) {
                            log::warn!("[setup] safety-net show: frontend never invoked app_ready within 3 s");
                            let _ = w.show();
                        }
                    }
                });

                #[cfg(target_os = "windows")]
                {
                    let app_handle = app.handle().clone();
                    let win_clone = window.clone();
                    // prexu-w9j: Windows leaves WINDOWPLACEMENT.rcNormalPosition
                    // at the PRE-snap rect while a window is Aero-Snapped, so a
                    // maximize→restore cycle on a snapped window restores to the
                    // wrong (pre-snap) size — and tao doesn't track the snapped
                    // rect as its restore target either. We remember the last
                    // non-maximized / non-fullscreen / non-minimized rect and
                    // re-apply it when the window is restored from maximize.
                    let last_normal_rect: Arc<
                        Mutex<Option<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>>,
                    > = Arc::new(Mutex::new(None));
                    let was_maximized = Arc::new(AtomicBool::new(false));
                    let reapplying_rect = Arc::new(AtomicBool::new(false));
                    window.on_window_event(move |event| {
                        use tauri::WindowEvent;
                        let state = app_handle.state::<player::PlayerState>();
                        match event {
                            // Pure move (WM_MOVE / drag without resize) —
                            // fast-path through sync_geometry_move which
                            // skips the 50ms throttle. Position-only
                            // SetWindowPos with SWP_NOSIZE doesn't
                            // trigger mpv's swapchain rebuild, so we can
                            // run at the full event rate without the
                            // freeze that necessitates the throttle for
                            // size changes (prexu-aqd). The trailing-
                            // edge flush is not needed here either — we
                            // are not dropping any events.
                            WindowEvent::Moved(_) => {
                                if let (Ok(pos), Ok(size)) =
                                    (win_clone.inner_position(), win_clone.inner_size())
                                {
                                    log::trace!(
                                        "[window] Moved to ({},{}), size={}x{}",
                                        pos.x, pos.y, size.width, size.height
                                    );
                                    state.sync_geometry_move(
                                        pos.x,
                                        pos.y,
                                        size.width as i32,
                                        size.height as i32,
                                    );
                                }
                            }
                            // Resize (WM_SIZE — drag-resize, snap,
                            // maximize/restore, fullscreen toggle). Goes
                            // through the throttled sync_geometry path
                            // because each SetWindowPos with size change
                            // rebuilds mpv's D3D11 swapchain; 60Hz
                            // rebuild bursts crash gpu-next vo. Throttle
                            // + trailing-edge flush preserved.
                            WindowEvent::Resized(_) => {
                                // prexu-w9j: keep the snapped/normal rect as the
                                // restore target so maximize→restore returns to it
                                // instead of the OS's stale pre-snap rect. Guarded
                                // by `reapplying_rect` so our own set_size/
                                // set_position re-entrant WM_SIZE doesn't recurse.
                                if !reapplying_rect.load(Ordering::Relaxed) {
                                    let maxed = win_clone.is_maximized().unwrap_or(false);
                                    let fs = win_clone.is_fullscreen().unwrap_or(false);
                                    let min = win_clone.is_minimized().unwrap_or(false);
                                    let was_max = was_maximized.swap(maxed, Ordering::Relaxed);
                                    if was_max && !maxed && !fs && !min {
                                        // Just un-maximized — the OS restored to the
                                        // stale pre-snap rect. Re-apply our captured
                                        // snapped/normal rect.
                                        let target = *last_normal_rect.lock().unwrap();
                                        if let Some((opos, isize)) = target {
                                            reapplying_rect.store(true, Ordering::Relaxed);
                                            let _ = win_clone
                                                .set_size(tauri::Size::Physical(isize));
                                            let _ = win_clone
                                                .set_position(tauri::Position::Physical(opos));
                                            reapplying_rect.store(false, Ordering::Relaxed);
                                            log::info!(
                                                "[window] restore-from-maximize: reapplied snapped rect ({},{} {}x{})",
                                                opos.x, opos.y, isize.width, isize.height
                                            );
                                        }
                                    } else if !maxed && !fs && !min {
                                        // Normal drag-resize or Aero-Snap — this is
                                        // the size a future restore should return to.
                                        if let (Ok(opos), Ok(isize)) = (
                                            win_clone.outer_position(),
                                            win_clone.inner_size(),
                                        ) {
                                            *last_normal_rect.lock().unwrap() =
                                                Some((opos, isize));
                                        }
                                    }
                                }
                                if let (Ok(pos), Ok(size)) =
                                    (win_clone.inner_position(), win_clone.inner_size())
                                {
                                    log::trace!("[window] Resized to ({},{},{}x{})", pos.x, pos.y, size.width, size.height);
                                    // Tell the frontend the OS-level WM_SIZE
                                    // fired. AppLayout's resize hook listens
                                    // for this and triggers a forced React
                                    // commit + synchronous layout read, so
                                    // dashboard content stays in lockstep
                                    // with the new client area even when
                                    // WebView2 batches its own resize event
                                    // (prexu-uzk follow-up). Payload is the
                                    // new (width, height) so the receiver
                                    // can dedup against the last value.
                                    use tauri::Emitter;
                                    let _ = app_handle.emit(
                                        "window://resized",
                                        (size.width, size.height),
                                    );
                                    state.sync_geometry(
                                        pos.x,
                                        pos.y,
                                        size.width as i32,
                                        size.height as i32,
                                    );
                                    // Schedule a trailing-edge flush on the first
                                    // event of a burst. A fast drag-resize whose
                                    // final WM_SIZE lands inside the 50ms throttle
                                    // window leaves the host stuck at stale
                                    // geometry — sync_geometry stashes the final
                                    // rect in pending, but no further event arrives
                                    // to consume it. The worker sleeps the throttle
                                    // window, then dispatches back to the main
                                    // thread to apply whatever pending holds at
                                    // that moment (which is always the most recent
                                    // rect, since later events overwrite earlier
                                    // ones). claim_trailing_schedule's atomic swap
                                    // means subsequent events in the same burst
                                    // don't double-spawn. (prexu-hhx)
                                    if state.claim_trailing_schedule() {
                                        let ah_sleep = app_handle.clone();
                                        let ah_closure = app_handle.clone();
                                        std::thread::spawn(move || {
                                            std::thread::sleep(
                                                player::GEOMETRY_SYNC_MIN_INTERVAL,
                                            );
                                            if let Err(e) =
                                                ah_sleep.run_on_main_thread(move || {
                                                    let state = ah_closure
                                                        .state::<player::PlayerState>();
                                                    state.flush_pending_geometry();
                                                })
                                            {
                                                log::warn!(
                                                    "[player] trailing flush dispatch failed: {:?}",
                                                    e
                                                );
                                            }
                                        });
                                    }
                                }
                            }
                            // Cross-monitor DPI change: tao gives us the new
                            // physical size directly to dodge a stale read.
                            //
                            // The destructured `scale_factor` is the NEW scale
                            // for the monitor the window just landed on. We
                            // push it into PlayerState BEFORE calling
                            // sync_geometry so `apply_minimize_inset` sees
                            // the new scale on the very first re-place
                            // (prexu-buw). Without this, a minimized mini
                            // player keeps using the old monitor's DPI for
                            // its physical size and ends up wrong-sized at
                            // the anchor corner.
                            WindowEvent::ScaleFactorChanged {
                                new_inner_size,
                                scale_factor,
                                ..
                            } => {
                                log::info!(
                                    "[window] ScaleFactorChanged scale={:.3} new_size={}x{}",
                                    scale_factor,
                                    new_inner_size.width,
                                    new_inner_size.height
                                );
                                state.set_scale_factor(*scale_factor);
                                if let Ok(pos) = win_clone.inner_position() {
                                    state.sync_geometry(
                                        pos.x,
                                        pos.y,
                                        new_inner_size.width as i32,
                                        new_inner_size.height as i32,
                                    );
                                }
                            }
                            // Focus-restore host reassert (prexu-5l5). When
                            // the main Tauri window regains focus after
                            // another app fully occluded Prexu, the mpv
                            // host HWND can be left below the WebView in
                            // z-order or with a stale DXGI swap chain that
                            // never re-Presents — the user sees the player
                            // chrome but the video region is transparent
                            // through to whatever is behind. Affects every
                            // player mode (full, fullscreen, popout, mini).
                            //
                            // Gated on `consume_focus_reassert` so the
                            // reassert only fires after an actual out-
                            // and-back focus cycle. Tauri emits Focused
                            // (true) on click / mouse-enter as well, and
                            // running the SetWindowPos chain on each one
                            // disrupts WebView2 mouse capture (cursor
                            // sticks on the host edge resize glyph). The
                            // latch is set on Focused(false) below.
                            WindowEvent::Focused(false) => {
                                state.mark_focus_lost();
                            }
                            WindowEvent::Focused(true) => {
                                if !state.consume_focus_reassert() {
                                    return;
                                }
                                if let (Ok(pos), Ok(size), Ok(parent)) = (
                                    win_clone.inner_position(),
                                    win_clone.inner_size(),
                                    win_clone.hwnd(),
                                ) {
                                    state.reassert_host_on_focus(
                                        parent,
                                        pos.x,
                                        pos.y,
                                        size.width as i32,
                                        size.height as i32,
                                    );
                                }
                            }
                            // Tear down host window + mpv before Tauri's main
                            // window goes away so DestroyWindow runs cleanly.
                            WindowEvent::CloseRequested { .. }
                            | WindowEvent::Destroyed => {
                                log::info!("[window] CloseRequested/Destroyed — destroying player");
                                let _ = state.destroy(&app_handle);
                            }
                            _ => {}
                        }
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log::error!("Failed to run tauri application: {}", e);
        });
}
