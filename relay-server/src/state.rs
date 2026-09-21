use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

// NOTE: per-connection writer channels carry `Arc<String>` rather than `String`
// so a session broadcast clones a cheap refcount bump per participant instead
// of reallocating the serialized JSON N times (see `session::broadcast_to_session`).

use dashmap::DashMap;
use tokio::sync::mpsc;

use crate::pending_invites::PendingInvites;

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
    /// Bounded, expiring offline invites keyed by recipient username.
    pub pending_invites: PendingInvites,
    /// Operator-configured WebSocket URL advertised in invites; None disables invites.
    pub public_url: Option<String>,
    /// Maximum time without an inbound WebSocket frame.
    pub read_idle_timeout: std::time::Duration,
    /// Global request timestamps for TMDb proxy rate limiting
    tmdb_timestamps: Mutex<VecDeque<Instant>>,
    /// Shared outbound HTTP client (prexu-0szx.12). A `reqwest::Client`
    /// owns its own connection pool + TLS config; per-handler
    /// `Client::new()` paid a fresh TCP+TLS handshake to
    /// api.themoviedb.org / plex.tv on every request. Clone per use —
    /// it's an Arc bump.
    pub http: reqwest::Client,
    /// Base URL the TMDb proxy sends requests to. Defaults to the real TMDb
    /// API; overridable via `with_tmdb_api_base` so integration tests can
    /// point the proxy at a local stub server and prove requests reuse
    /// `http`'s pooled connection instead of opening a fresh one per call
    /// (prexu-p8hy).
    pub tmdb_api_base: String,
    /// WebSocket server-initiated keepalive cadence (unsolicited `Pong`).
    /// 30s in production; overridable via `with_keepalive_interval` so the
    /// integration tests can exercise the tick without a 30s wait.
    pub keepalive_interval: std::time::Duration,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            connections: DashMap::new(),
            pending_invites: PendingInvites::default(),
            public_url: None,
            read_idle_timeout: std::time::Duration::from_secs(90),
            tmdb_timestamps: Mutex::new(VecDeque::new()),
            http: reqwest::Client::new(),
            tmdb_api_base: crate::tmdb_proxy::TMDB_API_BASE.to_string(),
            keepalive_interval: std::time::Duration::from_secs(30),
        }
    }

    /// Configure the trusted URL used for all invites, never a client-supplied URL.
    pub fn with_public_url(mut self, value: &str) -> Result<Self, String> {
        let url = reqwest::Url::parse(value).map_err(|_| "Invalid public relay URL")?;
        if value.len() > 2048
            || !matches!(url.scheme(), "ws" | "wss")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/ws"
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("Public relay URL must be ws(s)://host[:port]/ws without credentials, query, or fragment".into());
        }
        self.public_url = Some(url.to_string());
        Ok(self)
    }

    /// Build an `AppState` with a custom keepalive cadence (tests only).
    pub fn with_keepalive_interval(interval: std::time::Duration) -> Self {
        Self {
            keepalive_interval: interval,
            ..Self::new()
        }
    }

    /// Build an `AppState` with a custom TMDb proxy base URL (tests only), so
    /// the proxy can be pointed at a local stub server instead of the real
    /// TMDb API (prexu-p8hy).
    pub fn with_tmdb_api_base(base: String) -> Self {
        Self {
            tmdb_api_base: base,
            ..Self::new()
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
        while timestamps
            .front()
            .is_some_and(|t| now.duration_since(*t) > TMDB_RATE_LIMIT_WINDOW)
        {
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
    pub sender: mpsc::Sender<Arc<String>>,
}

#[allow(dead_code)]
pub struct ConnectionHandle {
    pub plex_username: String,
    pub plex_thumb: String,
    pub session_id: Option<String>,
    pub sender: mpsc::Sender<Arc<String>>,
}

/// Get current unix timestamp in milliseconds.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
