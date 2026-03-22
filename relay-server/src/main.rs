use std::fs::File;
use std::io::BufReader;
use std::sync::Arc;

use clap::Parser;
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto::Builder as HyperBuilder;
use tokio_rustls::TlsAcceptor;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use prexu_relay::{build_router, AppState, spawn_cleanup_task};

#[derive(Parser, Debug)]
#[command(name = "prexu-relay", about = "WebSocket relay for Prexu Watch Together")]
struct Args {
    /// Host address to bind to
    #[arg(long, default_value = "0.0.0.0")]
    host: String,

    /// Port to listen on
    #[arg(long, default_value_t = 8080)]
    port: u16,

    /// Path to TLS certificate PEM file
    #[arg(long)]
    tls_cert: Option<String>,

    /// Path to TLS private key PEM file
    #[arg(long)]
    tls_key: Option<String>,
}

fn load_tls_config(cert_path: &str, key_path: &str) -> Result<Arc<rustls::ServerConfig>, Box<dyn std::error::Error>> {
    let cert_file = File::open(cert_path)
        .map_err(|e| format!("Failed to open TLS cert file '{}': {}", cert_path, e))?;
    let key_file = File::open(key_path)
        .map_err(|e| format!("Failed to open TLS key file '{}': {}", key_path, e))?;

    let certs: Vec<_> = rustls_pemfile::certs(&mut BufReader::new(cert_file))
        .collect::<Result<_, _>>()
        .map_err(|e| format!("Failed to parse TLS certificates: {}", e))?;

    let key = rustls_pemfile::private_key(&mut BufReader::new(key_file))
        .map_err(|e| format!("Failed to read TLS private key: {}", e))?
        .ok_or("No private key found in key file")?;

    let config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| format!("Invalid TLS certificate/key pair: {}", e))?;

    Ok(Arc::new(config))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let args = Args::parse();
    let state = Arc::new(AppState::new());

    // Start background cleanup task
    spawn_cleanup_task(state.clone());

    let app = build_router(state);
    let addr = format!("{}:{}", args.host, args.port);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind to {}: {}", addr, e))?;

    match (&args.tls_cert, &args.tls_key) {
        (Some(cert), Some(key)) => {
            let tls_config = load_tls_config(cert, key)?;
            let tls_acceptor = TlsAcceptor::from(tls_config);

            info!("Prexu Relay Server (TLS) starting on {}", addr);

            loop {
                let (tcp_stream, remote_addr) = match listener.accept().await {
                    Ok(conn) => conn,
                    Err(e) => {
                        warn!("Failed to accept TCP connection: {}", e);
                        continue;
                    }
                };

                let tls_acceptor = tls_acceptor.clone();
                let app = app.clone();

                tokio::spawn(async move {
                    let tls_stream = match tls_acceptor.accept(tcp_stream).await {
                        Ok(s) => s,
                        Err(e) => {
                            warn!(addr = %remote_addr, "TLS handshake failed: {}", e);
                            return;
                        }
                    };

                    let io = TokioIo::new(tls_stream);
                    let hyper_service = hyper::service::service_fn(move |req| {
                        let mut tower_svc = app.clone();
                        async move {
                            tower::Service::call(&mut tower_svc, req).await
                        }
                    });

                    if let Err(e) = HyperBuilder::new(TokioExecutor::new())
                        .serve_connection_with_upgrades(io, hyper_service)
                        .await
                    {
                        warn!(addr = %remote_addr, "Connection error: {}", e);
                    }
                });
            }
        }
        (None, None) => {
            info!("Prexu Relay Server starting on {}", addr);

            axum::serve(listener, app)
                .await
                .map_err(|e| format!("Server error: {}", e))?;
        }
        _ => {
            return Err("Both --tls-cert and --tls-key must be provided together".into());
        }
    }

    Ok(())
}
