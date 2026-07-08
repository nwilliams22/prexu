mod downloads;
// The native libmpv player compiles on Windows (wid/HWND + DirectComposition)
// and Linux (render API + GtkGLArea under the transparent WebKitWebView — see
// docs/adr-native-player-render-api.md, prexu-axj4.3). macOS and any other
// target omit it and use the HTML5 <video> engine, keeping libmpv out of their
// link line (see Cargo.toml per-target dependency tables + prexu-nesp).
#[cfg(any(target_os = "windows", target_os = "linux"))]
mod player;
mod util;

use tauri_plugin_log::{Target, TargetKind};
use tauri::{AppHandle, Manager};
use std::io::{BufRead, BufReader, Read as StdRead, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
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

    // Warmup: pre-create the libmpv handle on a background thread so the
    // user's first Play skips the hwdec probe + VO selection (~12 s
    // observed on a cold Win11 boot). The handle stays parked in
    // PlayerState; player_load_url's ensure_init is a no-op when it runs
    // after warmup completes.
    //
    // Linux (prexu-0szx.10): same win. ensure_init marshals the render-
    // context bind onto the GTK main thread internally (attach_mpv), so a
    // background warmup thread is safe; the warmed idle mpv renders
    // nothing (pump gate stays quiescent until a file loads) and the
    // first-frame reveal only arms at PlaybackRestart, so the loading
    // choreography is untouched.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
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
                    // Redact before logging: the error string may contain the
                    // target URL (including X-Plex-Token) from reqwest's Display.
                    log::error!("[Proxy] Request error: {}", crate::util::redact_url(&e.to_string()));
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
        // Zero-allocation case-insensitive prefix check; `get` (not slicing)
        // so a malformed multi-byte header line can't panic the connection
        // thread on a non-char-boundary.
        if line.get(..6).is_some_and(|p| p.eq_ignore_ascii_case("range:")) {
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
    if let Some(rating_key) = path.strip_prefix("/local/") {
        // Guard against path traversal: `join("..")` / an absolute rating_key
        // escapes the downloads dir and would read files anywhere on disk.
        // Reuse the same validator the download sinks use. Log the reason only,
        // never the raw value (log-injection risk).
        if let Err(reason) = crate::downloads::validate_path_component(rating_key) {
            log::warn!("[Proxy] rejected /local request: invalid rating_key — {}", reason);
            write_error(&mut stream, 400, "Bad Request")?;
            return Ok(());
        }
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

                        // Handle Range requests for seeking. Streamed with a
                        // fixed buffer (prexu-0szx.2): the old path ignored
                        // the requested end and read start→EOF into ONE Vec —
                        // a seek near the start of a multi-GB remux allocated
                        // gigabytes and could OOM the process.
                        if let Some(ref range) = range_header {
                            if let Some((start, end)) = parse_range(range, file_size) {
                                let length = end - start + 1;
                                use std::io::Seek;
                                file.seek(std::io::SeekFrom::Start(start))?;
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
                                stream_body(&mut file, &mut stream, Some(length))?;
                                stream.flush()?;
                                return Ok(());
                            }
                        }

                        // Full file response — streamed, never buffered whole.
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
                        stream_body(&mut file, &mut stream, Some(file_size))?;
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

    // Execute the request to Plex.
    // Strip the URL from any reqwest error before propagating — the URL
    // contains X-Plex-Token and must not appear in logs or error strings.
    let resp = req.send().map_err(|e| Box::new(e.without_url()) as Box<dyn std::error::Error>)?;

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

    // Relay the body as it downloads (prexu-0szx.2). The old code buffered
    // the ENTIRE upstream response (`resp.bytes()`) before writing a single
    // byte to the WebView — every HLS segment paid full-download latency
    // with zero download/upload overlap. `reqwest::blocking::Response`
    // implements `Read`, so we stream through a fixed buffer instead.
    //
    // Content-Length is forwarded from upstream when known; when Plex sends
    // a chunked/unsized body we omit it — every response already sends
    // `Connection: close`, so the body is validly EOF-delimited (HTTP/1.1).
    let content_length = resp.content_length();

    let mut header = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: {}\r\n\
         Access-Control-Allow-Origin: https://tauri.localhost\r\n\
         Connection: close\r\n",
        status.as_u16(),
        status.canonical_reason().unwrap_or(""),
        content_type,
    );
    if let Some(len) = content_length {
        header.push_str(&format!("Content-Length: {}\r\n", len));
    }
    if let Some(cr) = content_range {
        header.push_str(&format!("Content-Range: {}\r\n", cr));
    }
    header.push_str("\r\n");

    stream.write_all(header.as_bytes())?;
    let mut resp = resp;
    // An upstream read error past this point can only truncate the body —
    // the status line is already on the wire. With Content-Length present
    // the client detects the truncation; either way the connection closes.
    stream_body(&mut resp, &mut stream, None)?;
    stream.flush()?;

    Ok(())
}

/// Fixed relay-buffer size for [`stream_body`]. Large enough that a LAN-rate
/// media stream doesn't burn syscalls, small enough to be irrelevant next to
/// a single video segment.
const PROXY_STREAM_BUF: usize = 256 * 1024;

/// Copy `len` bytes (or until EOF when `len` is `None`) from `reader` to
/// `writer` through one fixed heap buffer. Returns the bytes copied. This is
/// the memory-bounded replacement for the whole-body `Vec` reads the proxy
/// used to do (prexu-0szx.2): peak memory is `PROXY_STREAM_BUF` regardless
/// of body size, and the first byte reaches the client immediately.
fn stream_body(
    reader: &mut dyn StdRead,
    writer: &mut dyn Write,
    len: Option<u64>,
) -> std::io::Result<u64> {
    let mut buf = vec![0u8; PROXY_STREAM_BUF];
    let mut copied: u64 = 0;
    loop {
        let want = match len {
            Some(l) => {
                let remaining = l.saturating_sub(copied);
                if remaining == 0 {
                    break;
                }
                buf.len().min(remaining as usize)
            }
            None => buf.len(),
        };
        let n = reader.read(&mut buf[..want])?;
        if n == 0 {
            break; // EOF (short read against `len` = truncated source; caller's Content-Length exposes it)
        }
        writer.write_all(&buf[..n])?;
        copied += n as u64;
    }
    Ok(copied)
}

/// Parse a Range header (`bytes=S-E`, `bytes=S-`, or suffix `bytes=-N`)
/// against `file_size`. Returns the INCLUSIVE `(start, end)` byte pair, with
/// `end` clamped to the last byte, or `None` when unparseable/unsatisfiable
/// (caller then serves the full file as 200). Replaces the old
/// `parse_range_start`, which ignored the requested end entirely — the
/// response always ran to EOF no matter what the client asked for.
fn parse_range(range: &str, file_size: u64) -> Option<(u64, u64)> {
    let range = range.trim();
    let spec = range.strip_prefix("bytes=")?;
    let (start_s, end_s) = spec.split_once('-')?;
    if start_s.is_empty() {
        // Suffix form: last N bytes.
        let n = end_s.parse::<u64>().ok()?;
        if n == 0 || file_size == 0 {
            return None;
        }
        let start = file_size.saturating_sub(n);
        return Some((start, file_size - 1));
    }
    let start = start_s.parse::<u64>().ok()?;
    if start >= file_size {
        return None;
    }
    let end = if end_s.is_empty() {
        file_size - 1
    } else {
        end_s.parse::<u64>().ok()?.min(file_size - 1)
    };
    if end < start {
        return None;
    }
    Some((start, end))
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
    // Linux/Wayland: we previously force-set WEBKIT_DISABLE_DMABUF_RENDERER=1
    // here (prexu-z5mz: webkit2gtk's DMABUF renderer crashed at webview creation
    // on Wayland/NVIDIA — "Error 71 (Protocol error)"). That force is REMOVED
    // for the native player (prexu-axj4.3): WebKitGTK's fallback (non-DMABUF)
    // renderer does not clear a TRANSPARENT webview's retained composite, so
    // every repaint re-blends onto stale pixels — video/controls progressively
    // darken to black within seconds and "hidden" chrome lingers as ghost
    // pixels. With the DMABUF renderer enabled the transparent webview
    // composites correctly over the mpv GtkGLArea (verified on the z5mz box
    // itself: webkit2gtk 2.52.3 + NVIDIA 595.71.05 no longer crash — flat
    // luminance over 60 s, source-accurate brightness). Users on stacks where
    // the old crash persists can still export WEBKIT_DISABLE_DMABUF_RENDERER=1
    // (the env var is respected by WebKit directly), at the cost of the
    // native-player compositing defect — the HTML5 engine remains the fallback.

    // Security (Path C3d): drop CWD/PATH from the process DLL search order
    // before anything loads a third-party DLL — defeats DLL planting/sideloading
    // for ANGLE and every other dynamically-loaded module. Keeps app dir +
    // System32 so libmpv/WebView2 still resolve.
    #[cfg(target_os = "windows")]
    player::angle_loader::harden_dll_search_path();

    // Path C3c (prexu-60mz.3): composition hosting is unconditional on Windows.
    // Must run BEFORE the config `main` window is built (inside Builder::run
    // below), on this same main thread, so the vendored-wry opt-in is consumed
    // by that window's webview. The DComp tree is then attached in `.setup()`
    // once the HWND exists.
    #[cfg(target_os = "windows")]
    player::composition_host::request_hosting();

    // Linux native player (prexu-axj4.3): opt the main webview into a
    // TRANSPARENT background at creation time via the vendored-wry fork. Same
    // placement discipline as the Windows request_hosting() above: must run on
    // this thread before the config `main` window (and its webview) is built
    // inside Builder::run. Creation-time is the load-bearing call — it fixes
    // the WebKitWebView's compositing/opaque-region state before the widget
    // realizes, so GTK composites the webview OVER the mpv GtkGLArea with true
    // alpha instead of re-blending a stale opaque-retained surface
    // (progressive video dimming). The TOPLEVEL window stays transparent:false
    // (tauri.linux.conf.json — Wayland-bleed, prexu-duna); only the webview
    // WIDGET goes transparent.
    #[cfg(target_os = "linux")]
    wry::set_pending_webview_transparency(true);

    let builder = tauri::Builder::default()
        .manage(ProxyState::new())
        .manage(downloads::DownloadManager::new())
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
        .plugin(tauri_plugin_updater::Builder::default().build());

    // PlayerState owns the libmpv handle — managed on Windows and Linux.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.manage(player::PlayerState::new());

    // The player_* commands exist on Windows (native libmpv player) and Linux
    // (render-API player, prexu-axj4.3). macOS and other targets omit them so
    // the player module — and therefore libmpv — need not compile there. The
    // frontend gates invocation on the native-player probe, so other platforms
    // never call these.
    #[cfg(target_os = "windows")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        start_proxy,
        app_ready,
        downloads::get_downloads_dir,
        downloads::open_downloads_dir,
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
        player::commands::player_set_timeline_context,
        player::commands::player_clear_timeline_context,
        player::commands::player_unload,
        player::commands::player_stop,
        player::commands::player_set_fullscreen,
        player::commands::player_engine_status,
        player::commands::player_enter_popout,
        player::commands::player_exit_popout,
        player::commands::player_enter_minimize,
        player::commands::player_exit_minimize,
        player::commands::player_update_mini_geometry,
    ]);
    // Linux native player (prexu-axj4.3): the render-API player exposes the same
    // playback command surface as Windows, plus the in-window minimize commands
    // (prexu-axj4.5 — implemented via mpv's video-margin-ratio-* properties,
    // no separate host window to reposition; see `player::linux_compositor`
    // and `player::commands::minimize`) and the pop-out commands
    // (prexu-axj4.10 — main-window morph via Tauri/GTK ops; X11 full parity,
    // Wayland floats without placement/keep-above, see `commands::popout`).
    // Fullscreen maps to a plain Tauri window toggle (no host geometry).
    // `player_engine_status` + `player://engine-failed` are the
    // HTML5-fallback probe contract with the TS side.
    #[cfg(target_os = "linux")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        start_proxy,
        app_ready,
        downloads::get_downloads_dir,
        downloads::open_downloads_dir,
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
        player::commands::player_set_timeline_context,
        player::commands::player_clear_timeline_context,
        player::commands::player_unload,
        player::commands::player_stop,
        player::commands::player_set_fullscreen,
        player::commands::player_engine_status,
        player::commands::player_enter_popout,
        player::commands::player_exit_popout,
        player::commands::player_enter_minimize,
        player::commands::player_exit_minimize,
        player::commands::player_update_mini_geometry,
    ]);
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        start_proxy,
        app_ready,
        downloads::get_downloads_dir,
        downloads::open_downloads_dir,
        downloads::download_media,
        downloads::cancel_download,
        downloads::delete_download,
        downloads::get_local_file_path,
    ]);

    builder
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

                // Linux native player (prexu-axj4.3): reparent wry's webview
                // under a GtkOverlay with an mpv-render GtkGLArea beneath it,
                // and make the webview background transparent so the video shows
                // through. Runs here on the GTK main thread (setup hook), before
                // any playback. Failures fall back to HTML5 (engine-failed).
                #[cfg(target_os = "linux")]
                {
                    player::linux_compositor::install(&window, app.handle().clone());

                    // Close-time Plex timeline report (prexu-50f), same as the
                    // Windows path: on window close mid-playback the JS unmount
                    // cleanup is unreliable, so Rust fires the final
                    // `state=stopped` report from the live mpv position. mpv is
                    // still alive at CloseRequested (fires before teardown).
                    let report_handle = app.handle().clone();
                    window.on_window_event(move |event| {
                        if matches!(
                            event,
                            tauri::WindowEvent::CloseRequested { .. }
                                | tauri::WindowEvent::Destroyed
                        ) {
                            report_handle
                                .state::<player::PlayerState>()
                                .report_stopped_on_close();
                        }
                    });
                }

                #[cfg(target_os = "windows")]
                {
                    let app_handle = app.handle().clone();
                    // Wire the five window-event concerns (move sync,
                    // resize/maximize-restore, DPI/scale, focus reassert,
                    // teardown) via the extracted handler (prexu-bgz.30).
                    player::events::attach_window_handlers(&window, app_handle);

                    // Path C3c: attach the DComp tree to the (already
                    // composition-hosted) main webview. HWND is passed as isize
                    // because the with_webview closure must be Send (HWND is not).
                    match window.hwnd() {
                        Ok(hwnd) => {
                            let hwnd_isize = hwnd.0 as isize;
                            let res = window.with_webview(move |pw| {
                                let hwnd =
                                    windows::Win32::Foundation::HWND(hwnd_isize as *mut _);
                                let controller = pw.controller();
                                if let Err(e) =
                                    player::composition_host::install(hwnd, &controller)
                                {
                                    log::error!("[player:comp] install failed: {:?}", e);
                                }
                            });
                            if let Err(e) = res {
                                log::error!("[player:comp] with_webview failed: {:?}", e);
                            }
                        }
                        Err(e) => log::error!("[player:comp] main hwnd unavailable: {:?}", e),
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log::error!("Failed to run tauri application: {}", e);
        });
}

// ── Proxy helper tests (pure — no sockets, no files) ─────────────────────────

#[cfg(test)]
mod proxy_tests {
    use super::{parse_range, stream_body};

    // parse_range — the (start, end) contract against a 1000-byte file.

    #[test]
    fn range_open_ended_runs_to_last_byte() {
        assert_eq!(parse_range("bytes=200-", 1000), Some((200, 999)));
    }

    #[test]
    fn range_explicit_end_is_honored_not_eof() {
        // The prexu-0szx.2 defect: the old parser ignored the end entirely.
        assert_eq!(parse_range("bytes=200-499", 1000), Some((200, 499)));
    }

    #[test]
    fn range_end_clamped_to_file_size() {
        assert_eq!(parse_range("bytes=200-5000", 1000), Some((200, 999)));
    }

    #[test]
    fn range_suffix_serves_last_n_bytes() {
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        // Suffix larger than the file = whole file.
        assert_eq!(parse_range("bytes=-5000", 1000), Some((0, 999)));
    }

    #[test]
    fn range_unsatisfiable_or_malformed_is_none() {
        assert_eq!(parse_range("bytes=1000-", 1000), None); // start == size
        assert_eq!(parse_range("bytes=500-200", 1000), None); // end < start
        assert_eq!(parse_range("bytes=-0", 1000), None); // empty suffix
        assert_eq!(parse_range("bytes=-", 1000), None);
        assert_eq!(parse_range("items=0-", 1000), None); // wrong unit
        assert_eq!(parse_range("bytes=abc-", 1000), None);
        assert_eq!(parse_range("bytes=-5", 0), None); // empty file
    }

    #[test]
    fn range_first_and_last_single_bytes() {
        assert_eq!(parse_range("bytes=0-0", 1000), Some((0, 0)));
        assert_eq!(parse_range("bytes=999-999", 1000), Some((999, 999)));
    }

    // stream_body — bounded-copy contract.

    #[test]
    fn stream_body_caps_at_len() {
        let src = vec![7u8; 4096];
        let mut out = Vec::new();
        let copied = stream_body(&mut src.as_slice(), &mut out, Some(1000)).unwrap();
        assert_eq!(copied, 1000);
        assert_eq!(out.len(), 1000);
    }

    #[test]
    fn stream_body_stops_at_eof_before_len() {
        // Truncated source: copies what exists, reports the short count.
        let src = vec![7u8; 300];
        let mut out = Vec::new();
        let copied = stream_body(&mut src.as_slice(), &mut out, Some(1000)).unwrap();
        assert_eq!(copied, 300);
    }

    #[test]
    fn stream_body_none_copies_to_eof() {
        // Spans multiple buffer fills (buffer is 256 KiB).
        let src = vec![0u8; 600 * 1024];
        let mut out = Vec::new();
        let copied = stream_body(&mut src.as_slice(), &mut out, None).unwrap();
        assert_eq!(copied, 600 * 1024);
        assert_eq!(out.len(), 600 * 1024);
    }

    #[test]
    fn stream_body_empty_source_is_zero() {
        let mut out = Vec::new();
        assert_eq!(stream_body(&mut (&[] as &[u8]), &mut out, None).unwrap(), 0);
    }
}
