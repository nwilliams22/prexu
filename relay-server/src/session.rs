use tracing::{info, warn};

use crate::messages::{ParticipantInfo, PendingInviteInfo, ServerMessage};
use crate::state::{now_ms, Participant, Session, SharedState};

/// Send a serialized ServerMessage to a single connection by username.
fn send_to_user(state: &SharedState, username: &str, msg: &ServerMessage) {
    if let Some(conn) = state.connections.get(username) {
        if let Ok(json) = serde_json::to_string(msg) {
            let _ = conn.sender.send(json);
        }
    }
}

/// Broadcast a message to all participants in a session, optionally excluding one user.
fn broadcast_to_session(
    state: &SharedState,
    session_id: &str,
    msg: &ServerMessage,
    exclude: Option<&str>,
) {
    if let Some(session) = state.sessions.get(session_id) {
        let json = match serde_json::to_string(msg) {
            Ok(j) => j,
            Err(_) => return,
        };
        for entry in session.participants.iter() {
            if Some(entry.key().as_str()) == exclude {
                continue;
            }
            let _ = entry.value().sender.send(json.clone());
        }
    }
}

/// Create a new watch session. The creator becomes the host.
pub fn create_session(
    state: &SharedState,
    session_id: String,
    username: &str,
    plex_thumb: &str,
    media_title: String,
    media_rating_key: String,
    media_type: String,
    sender: tokio::sync::mpsc::UnboundedSender<String>,
) {
    // Check if session already exists
    if state.sessions.contains_key(&session_id) {
        send_to_user(
            state,
            username,
            &ServerMessage::SessionError {
                reason: "Session ID already exists".into(),
            },
        );
        return;
    }

    let session = Session {
        id: session_id.clone(),
        media_title,
        media_rating_key,
        media_type,
        host_username: username.to_string(),
        participants: dashmap::DashMap::new(),
        created_at: now_ms(),
    };

    session.participants.insert(
        username.to_string(),
        Participant {
            plex_username: username.to_string(),
            plex_thumb: plex_thumb.to_string(),
            is_host: true,
            state: "ready".to_string(),
            sender,
        },
    );

    state.sessions.insert(session_id.clone(), session);

    // Update connection's session_id
    if let Some(mut conn) = state.connections.get_mut(username) {
        conn.session_id = Some(session_id.clone());
    }

    send_to_user(
        state,
        username,
        &ServerMessage::SessionCreated {
            session_id: session_id.clone(),
        },
    );

    info!(session_id = %session_id, host = %username, "Session created");
}

/// Join an existing session.
pub fn join_session(
    state: &SharedState,
    session_id: &str,
    username: &str,
    plex_thumb: &str,
    sender: tokio::sync::mpsc::UnboundedSender<String>,
) {
    let session = match state.sessions.get(session_id) {
        Some(s) => s,
        None => {
            send_to_user(
                state,
                username,
                &ServerMessage::SessionError {
                    reason: "Session not found".into(),
                },
            );
            return;
        }
    };

    // Check if already in session
    if session.participants.contains_key(username) {
        send_to_user(
            state,
            username,
            &ServerMessage::SessionError {
                reason: "Already in this session".into(),
            },
        );
        return;
    }

    // Collect existing participants for the join response
    let existing_participants: Vec<ParticipantInfo> = session
        .participants
        .iter()
        .map(|entry| ParticipantInfo {
            plex_username: entry.plex_username.clone(),
            plex_thumb: entry.plex_thumb.clone(),
            is_host: entry.is_host,
            state: entry.state.clone(),
        })
        .collect();

    // Add new participant
    session.participants.insert(
        username.to_string(),
        Participant {
            plex_username: username.to_string(),
            plex_thumb: plex_thumb.to_string(),
            is_host: false,
            state: "buffering".to_string(),
            sender,
        },
    );

    // Drop session ref before broadcasting (avoid deadlock)
    drop(session);

    // Update connection's session_id
    if let Some(mut conn) = state.connections.get_mut(username) {
        conn.session_id = Some(session_id.to_string());
    }

    // Tell the joining user about existing participants
    send_to_user(
        state,
        username,
        &ServerMessage::SessionJoined {
            session_id: session_id.to_string(),
            participants: existing_participants,
        },
    );

    // Tell everyone else about the new participant
    broadcast_to_session(
        state,
        session_id,
        &ServerMessage::ParticipantJoined {
            participant: ParticipantInfo {
                plex_username: username.to_string(),
                plex_thumb: plex_thumb.to_string(),
                is_host: false,
                state: "buffering".to_string(),
            },
        },
        Some(username),
    );

    info!(session_id = %session_id, user = %username, "User joined session");
}

/// Remove a user from their current session. Destroys session if empty.
pub fn leave_session(state: &SharedState, username: &str) {
    // Find the session this user is in
    let session_id = match state.connections.get(username) {
        Some(conn) => match &conn.session_id {
            Some(id) => id.clone(),
            None => return,
        },
        None => return,
    };

    // Remove from session participants
    let should_destroy = if let Some(session) = state.sessions.get(&session_id) {
        session.participants.remove(username);
        session.participants.is_empty()
    } else {
        false
    };

    // Clear session from connection
    if let Some(mut conn) = state.connections.get_mut(username) {
        conn.session_id = None;
    }

    if should_destroy {
        state.sessions.remove(&session_id);
        info!(session_id = %session_id, "Session destroyed (empty)");
    } else {
        // Notify remaining participants
        broadcast_to_session(
            state,
            &session_id,
            &ServerMessage::ParticipantLeft {
                plex_username: username.to_string(),
            },
            None,
        );
        info!(session_id = %session_id, user = %username, "User left session");
    }
}

/// Handle an invite: push to target if connected, otherwise store as pending.
pub fn handle_invite(
    state: &SharedState,
    target_username: &str,
    session_id: &str,
    media_title: &str,
    media_rating_key: &str,
    media_type: &str,
    sender_username: &str,
    sender_thumb: &str,
) {
    let invite_msg = ServerMessage::InviteReceived {
        session_id: session_id.to_string(),
        media_title: media_title.to_string(),
        media_rating_key: media_rating_key.to_string(),
        media_type: media_type.to_string(),
        sender_username: sender_username.to_string(),
        sender_thumb: sender_thumb.to_string(),
        sent_at: now_ms(),
    };

    // If user is connected, deliver immediately
    if state.connections.contains_key(target_username) {
        send_to_user(state, target_username, &invite_msg);
        info!(
            from = %sender_username,
            to = %target_username,
            session_id = %session_id,
            "Invite delivered immediately"
        );
    } else {
        // Store as pending
        let pending = PendingInviteInfo {
            session_id: session_id.to_string(),
            media_title: media_title.to_string(),
            media_rating_key: media_rating_key.to_string(),
            media_type: media_type.to_string(),
            sender_username: sender_username.to_string(),
            sender_thumb: sender_thumb.to_string(),
            sent_at: now_ms(),
        };
        state
            .pending_invites
            .entry(target_username.to_string())
            .or_default()
            .push(pending);
        info!(
            from = %sender_username,
            to = %target_username,
            session_id = %session_id,
            "Invite stored as pending (user offline)"
        );
    }
}

/// Relay a playback event to all other participants in the sender's session.
pub fn relay_playback_event(state: &SharedState, username: &str, msg: &ServerMessage) {
    let session_id = match state.connections.get(username) {
        Some(conn) => match &conn.session_id {
            Some(id) => id.clone(),
            None => {
                warn!(user = %username, "Playback event from user not in a session");
                return;
            }
        },
        None => return,
    };

    // Update participant state in session
    if let Some(session) = state.sessions.get(&session_id) {
        if let Some(mut participant) = session.participants.get_mut(username) {
            match msg {
                ServerMessage::Play { .. } => participant.state = "playing".to_string(),
                ServerMessage::Pause { .. } => participant.state = "paused".to_string(),
                ServerMessage::Buffering { .. } => participant.state = "buffering".to_string(),
                ServerMessage::Ready { .. } => participant.state = "ready".to_string(),
                _ => {}
            }
        }
    }

    broadcast_to_session(state, &session_id, msg, Some(username));
}

/// Handle new_media event: relay to all participants including sender.
pub fn handle_new_media(
    state: &SharedState,
    username: &str,
    media_rating_key: &str,
    media_title: &str,
    media_type: &str,
) {
    let session_id = match state.connections.get(username) {
        Some(conn) => match &conn.session_id {
            Some(id) => id.clone(),
            None => return,
        },
        None => return,
    };

    // Update session media info
    if let Some(mut session) = state.sessions.get_mut(&session_id) {
        session.media_rating_key = media_rating_key.to_string();
        session.media_title = media_title.to_string();
        session.media_type = media_type.to_string();
    }

    let msg = ServerMessage::NewMedia {
        media_rating_key: media_rating_key.to_string(),
        media_title: media_title.to_string(),
        media_type: media_type.to_string(),
        from_user: username.to_string(),
    };

    // Broadcast to everyone except the sender (sender navigates locally)
    broadcast_to_session(state, &session_id, &msg, Some(username));

    info!(
        session_id = %session_id,
        user = %username,
        media = %media_title,
        "New media loaded in session"
    );
}

/// Clean up expired pending invites (older than 10 minutes).
pub fn cleanup_expired_invites(state: &SharedState) {
    let ttl_ms: u64 = 10 * 60 * 1000; // 10 minutes
    let now = now_ms();
    let mut empty_keys = Vec::new();

    for mut entry in state.pending_invites.iter_mut() {
        entry.value_mut().retain(|invite| {
            now.saturating_sub(invite.sent_at) < ttl_ms
        });
        if entry.value().is_empty() {
            empty_keys.push(entry.key().clone());
        }
    }

    for key in empty_keys {
        state.pending_invites.remove(&key);
    }
}
