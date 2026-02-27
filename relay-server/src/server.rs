use axum::{
    Router,
    extract::{State, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
};
use tokio::time::{interval, Duration};
use tracing::info;

use crate::connection::handle_connection;
use crate::session::cleanup_expired_invites;
use crate::state::SharedState;

/// Build the axum router with WebSocket and health endpoints.
pub fn build_router(state: SharedState) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .route("/health", get(health_handler))
        .with_state(state)
}

/// WebSocket upgrade handler.
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_connection(socket, state))
}

/// Health check endpoint.
async fn health_handler(State(state): State<SharedState>) -> impl IntoResponse {
    let sessions = state.sessions.len();
    let connections = state.connections.len();
    format!("OK — {} sessions, {} connections", sessions, connections)
}

/// Background task to periodically clean up expired pending invites.
pub fn spawn_cleanup_task(state: SharedState) {
    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(60));
        loop {
            ticker.tick().await;
            cleanup_expired_invites(&state);
        }
    });
    info!("Invite cleanup task started (every 60s)");
}
