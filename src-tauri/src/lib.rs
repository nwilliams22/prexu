mod downloads;

use tauri_plugin_log::{Target, TargetKind};
use tauri::Manager;
use std::io::{BufRead, BufReader, Read as StdRead, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

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
                .level(log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                .max_file_size(5_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            start_proxy,
            downloads::get_downloads_dir,
            downloads::download_media,
            downloads::cancel_download,
            downloads::delete_download,
            downloads::get_local_file_path,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.show().unwrap_or_default();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log::error!("Failed to run tauri application: {}", e);
        });
}
