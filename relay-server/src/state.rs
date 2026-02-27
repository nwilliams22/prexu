use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use tokio::sync::mpsc;

use crate::messages::PendingInviteInfo;

/// Shared application state (wrapped in Arc for thread-safe sharing).
pub type SharedState = Arc<AppState>;

pub struct AppState {
    /// session_id -> Session
    pub sessions: DashMap<String, Session>,
    /// plex_username -> ConnectionHandle
    pub connections: DashMap<String, ConnectionHandle>,
    /// plex_username -> Vec<PendingInvite> (for users not currently connected)
    pub pending_invites: DashMap<String, Vec<PendingInviteInfo>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            connections: DashMap::new(),
            pending_invites: DashMap::new(),
        }
    }
}

pub struct Session {
    pub id: String,
    pub media_title: String,
    pub media_rating_key: String,
    pub media_type: String,
    pub host_username: String,
    pub participants: DashMap<String, Participant>,
    pub created_at: u64,
}

pub struct Participant {
    pub plex_username: String,
    pub plex_thumb: String,
    pub is_host: bool,
    pub state: String,
    pub sender: mpsc::UnboundedSender<String>,
}

pub struct ConnectionHandle {
    pub plex_username: String,
    pub plex_thumb: String,
    pub session_id: Option<String>,
    pub sender: mpsc::UnboundedSender<String>,
}

/// Get current unix timestamp in milliseconds.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
