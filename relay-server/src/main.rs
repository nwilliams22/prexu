mod connection;
mod messages;
mod server;
mod session;
mod state;

use std::sync::Arc;

use clap::Parser;
use tracing::info;
use tracing_subscriber::EnvFilter;

use crate::server::{build_router, spawn_cleanup_task};
use crate::state::AppState;

#[derive(Parser, Debug)]
#[command(name = "prexu-relay", about = "WebSocket relay for Prexu Watch Together")]
struct Args {
    /// Host address to bind to
    #[arg(long, default_value = "0.0.0.0")]
    host: String,

    /// Port to listen on
    #[arg(long, default_value_t = 8080)]
    port: u16,
}

#[tokio::main]
async fn main() {
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

    info!("Prexu Relay Server starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind address");

    axum::serve(listener, app)
        .await
        .expect("Server error");
}
