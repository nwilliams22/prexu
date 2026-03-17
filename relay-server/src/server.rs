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
use crate::tmdb_proxy;

/// Build the axum router with WebSocket and health endpoints.
pub fn build_router(state: SharedState) -> Router {
    Router::new()
        .route("/ws", get(ws_handler))
        .route("/health", get(health_handler))
        // TMDb proxy endpoints
        .route("/tmdb/status", get(tmdb_proxy::tmdb_status))
        .route("/tmdb/search/movie", get(tmdb_proxy::search_movie))
        .route("/tmdb/search/tv", get(tmdb_proxy::search_tv))
        .route("/tmdb/search/person", get(tmdb_proxy::search_person))
        .route("/tmdb/find/{external_id}", get(tmdb_proxy::find_by_external_id))
        .route("/tmdb/person/{person_id}", get(tmdb_proxy::person_detail))
        .route("/tmdb/person/{person_id}/credits", get(tmdb_proxy::person_credits))
        .route("/tmdb/movie/{movie_id}", get(tmdb_proxy::movie_detail))
        .route("/tmdb/tv/{tv_id}", get(tmdb_proxy::tv_detail))
        .with_state(state)
}

/// Maximum WebSocket message size (64 KB).
const MAX_MESSAGE_SIZE: usize = 64 * 1024;

/// WebSocket upgrade handler.
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
) -> impl IntoResponse {
    ws.max_message_size(MAX_MESSAGE_SIZE)
        .on_upgrade(move |socket| handle_connection(socket, state))
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
