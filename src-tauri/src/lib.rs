use tauri_plugin_log::{Target, TargetKind};
use tauri::Manager;
use std::io::{BufRead, BufReader, Write};
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
}

impl ProxyState {
    fn new() -> Self {
        Self {
            port: Mutex::new(None),
            server_url: Arc::new(Mutex::new(String::new())),
            token: Arc::new(Mutex::new(String::new())),
        }
    }
}

/// Start (or reuse) the local HTTP proxy. Returns the port number.
/// Called from JS before HLS playback begins.
#[tauri::command]
fn start_proxy(
    server_url: String,
    token: String,
    state: tauri::State<'_, ProxyState>,
) -> Result<u16, String> {
    // Always update the server URL and token (user may switch servers)
    *state.server_url.lock().unwrap() = server_url;
    *state.token.lock().unwrap() = token;

    // If proxy is already running, reuse it
    let mut port_guard = state.port.lock().unwrap();
    if let Some(port) = *port_guard {
        return Ok(port);
    }

    // Bind to a random available port on localhost
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind proxy: {}", e))?;
    let port = listener.local_addr().unwrap().port();

    let server_url_ref = state.server_url.clone();
    let token_ref = state.token.clone();

    thread::spawn(move || {
        let client = reqwest::blocking::Client::builder()
            .build()
            .expect("Failed to build HTTP client for proxy");

        for stream in listener.incoming().flatten() {
            let su = server_url_ref.lock().unwrap().clone();
            let tk = token_ref.lock().unwrap().clone();
            let client = client.clone();
            thread::spawn(move || {
                if let Err(e) = handle_proxy_request(stream, &su, &tk, &client) {
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
            Access-Control-Allow-Origin: *\r\n\
            Access-Control-Allow-Methods: GET, OPTIONS\r\n\
            Access-Control-Allow-Headers: Range, Content-Type\r\n\
            Content-Length: 0\r\n\
            \r\n";
        stream.write_all(response.as_bytes())?;
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
         Access-Control-Allow-Origin: *\r\n\
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

fn write_error(
    stream: &mut TcpStream,
    status: u16,
    message: &str,
) -> Result<(), std::io::Error> {
    let response = format!(
        "HTTP/1.1 {} {}\r\n\
         Content-Type: text/plain\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
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
        .invoke_handler(tauri::generate_handler![start_proxy])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.show().unwrap_or_default();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
