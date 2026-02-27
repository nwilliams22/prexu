use serde::{Deserialize, Serialize};

// ── Client → Server Messages ──

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    Auth {
        plex_username: String,
        plex_thumb: String,
    },
    CreateSession {
        session_id: String,
        media_title: String,
        media_rating_key: String,
        media_type: String,
    },
    JoinSession {
        session_id: String,
    },
    LeaveSession,
    Invite {
        target_username: String,
        session_id: String,
        media_title: String,
        media_rating_key: String,
        media_type: String,
        sender_username: String,
        sender_thumb: String,
        relay_url: String,
    },
    Play {
        current_time: f64,
        timestamp: u64,
    },
    Pause {
        current_time: f64,
        timestamp: u64,
    },
    Seek {
        current_time: f64,
        timestamp: u64,
    },
    Buffering {
        current_time: f64,
    },
    Ready {
        current_time: f64,
    },
    NewMedia {
        media_rating_key: String,
        media_title: String,
        media_type: String,
    },
    Ping,
}

// ── Server → Client Messages ──

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    AuthOk {
        plex_username: String,
    },
    AuthError {
        reason: String,
    },
    SessionCreated {
        session_id: String,
    },
    SessionJoined {
        session_id: String,
        participants: Vec<ParticipantInfo>,
    },
    SessionError {
        reason: String,
    },
    ParticipantJoined {
        participant: ParticipantInfo,
    },
    ParticipantLeft {
        plex_username: String,
    },
    SessionDestroyed,
    InviteReceived {
        session_id: String,
        media_title: String,
        media_rating_key: String,
        media_type: String,
        sender_username: String,
        sender_thumb: String,
        sent_at: u64,
        relay_url: String,
    },
    PendingInvites {
        invites: Vec<PendingInviteInfo>,
    },
    Play {
        current_time: f64,
        timestamp: u64,
        from_user: String,
    },
    Pause {
        current_time: f64,
        timestamp: u64,
        from_user: String,
    },
    Seek {
        current_time: f64,
        timestamp: u64,
        from_user: String,
    },
    Buffering {
        from_user: String,
    },
    Ready {
        current_time: f64,
        from_user: String,
    },
    NewMedia {
        media_rating_key: String,
        media_title: String,
        media_type: String,
        from_user: String,
    },
    Pong,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParticipantInfo {
    pub plex_username: String,
    pub plex_thumb: String,
    pub is_host: bool,
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingInviteInfo {
    pub session_id: String,
    pub media_title: String,
    pub media_rating_key: String,
    pub media_type: String,
    pub sender_username: String,
    pub sender_thumb: String,
    pub sent_at: u64,
    pub relay_url: String,
}
