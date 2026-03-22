use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use tokio::sync::mpsc;

use crate::messages::PendingInviteInfo;

/// Shared application state (wrapped in Arc for thread-safe sharing).
pub type SharedState = Arc<AppState>;

/// Max global TMDb proxy requests within the rate window.
const TMDB_RATE_LIMIT_MAX: usize = 60;
/// TMDb rate limit sliding window duration.
const TMDB_RATE_LIMIT_WINDOW: std::time::Duration = std::time::Duration::from_secs(60);

pub struct AppState {
    /// session_id -> Session
    pub sessions: DashMap<String, Session>,
    /// plex_username -> ConnectionHandle
    pub connections: DashMap<String, ConnectionHandle>,
    /// plex_username -> Vec<PendingInvite> (for users not currently connected)
    pub pending_invites: DashMap<String, Vec<PendingInviteInfo>>,
    /// Global request timestamps for TMDb proxy rate limiting
    tmdb_timestamps: Mutex<VecDeque<Instant>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            connections: DashMap::new(),
            pending_invites: DashMap::new(),
            tmdb_timestamps: Mutex::new(VecDeque::new()),
        }
    }

    /// Check if a TMDb proxy request is within global rate limits.
    /// Returns true if allowed, false if rate limited.
    pub fn check_tmdb_rate_limit(&self) -> bool {
        let now = Instant::now();
        let mut timestamps = match self.tmdb_timestamps.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        // Remove expired timestamps
        while timestamps.front().is_some_and(|t| now.duration_since(*t) > TMDB_RATE_LIMIT_WINDOW) {
            timestamps.pop_front();
        }

        if timestamps.len() >= TMDB_RATE_LIMIT_MAX {
            return false;
        }

        timestamps.push_back(now);
        true
    }
}

#[allow(dead_code)]
pub struct Session {
    pub id: String,
    pub media_title: String,
    pub media_rating_key: String,
    pub media_type: String,
    pub host_username: String,
    pub participants: DashMap<String, Participant>,
    pub created_at: u64,
}

/// Bounded channel capacity for per-connection message queues.
/// If a client falls behind by this many messages, new messages are dropped.
pub const CHANNEL_CAPACITY: usize = 256;

pub struct Participant {
    pub plex_username: String,
    pub plex_thumb: String,
    pub is_host: bool,
    pub state: String,
    pub sender: mpsc::Sender<String>,
}

#[allow(dead_code)]
pub struct ConnectionHandle {
    pub plex_username: String,
    pub plex_thumb: String,
    pub session_id: Option<String>,
    pub sender: mpsc::Sender<String>,
}

/// Get current unix timestamp in milliseconds.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
