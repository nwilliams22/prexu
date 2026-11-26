use std::sync::Arc;

use tracing::{info, warn};

use crate::messages::{ParticipantInfo, PendingInviteInfo, ServerMessage};
use crate::state::{now_ms, ConnectionHandle, Participant, Session, SharedState};

/// Send a serialized ServerMessage to a single connection by username.
fn send_to_user(state: &SharedState, username: &str, msg: &ServerMessage) {
    if let Some(conn) = state.connections.get(username) {
        if let Ok(json) = serde_json::to_string(msg) {
            if conn.sender.try_send(Arc::new(json)).is_err() {
                warn!(user = %username, "Failed to deliver message (channel full or closed)");
            }
        }
    }
}

/// Broadcast a message to all participants in a session, optionally excluding one user.
///
/// The serialized JSON is allocated once and shared via `Arc<String>`; each
/// participant send clones the `Arc` (a refcount bump) instead of reallocating
/// the whole payload, so a broadcast to N participants does O(1) allocations
/// rather than O(N).
fn broadcast_to_session(
    state: &SharedState,
    session_id: &str,
    msg: &ServerMessage,
    exclude: Option<&str>,
) {
    if let Some(session) = state.sessions.get(session_id) {
        let json = match serde_json::to_string(msg) {
            Ok(j) => Arc::new(j),
            Err(_) => return,
        };
        for entry in session.participants.iter() {
            if Some(entry.key().as_str()) == exclude {
                continue;
            }
            if entry.value().sender.try_send(Arc::clone(&json)).is_err() {
                warn!(user = %entry.key(), "Broadcast message dropped (channel full or closed)");
            }
        }
    }
}

/// Create a new watch session. The creator becomes the host.
// reason: session entry point; args map 1:1 to the create-session protocol message
#[allow(clippy::too_many_arguments)]
pub fn create_session(
    state: &SharedState,
    session_id: String,
    protocol_version: u8,
    username: &str,
    plex_thumb: &str,
    media_title: String,
    media_rating_key: String,
    media_type: String,
    sender: tokio::sync::mpsc::Sender<Arc<String>>,
) {
    if !(1..=2).contains(&protocol_version) {
        send_to_user(
            state,
            username,
            &ServerMessage::SessionError {
                reason: "Unsupported protocol version".into(),
            },
        );
        return;
    }
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

    leave_session(state, username);

    let session = Session {
        id: session_id.clone(),
        media_title,
        media_rating_key,
        media_type,
        host_username: username.to_string(),
        participants: dashmap::DashMap::new(),
        created_at: now_ms(),
        protocol_version,
        invited: Default::default(),
        removed: Default::default(),
        disconnected: Default::default(),
        started: false,
        playing: false,
        resume_after_host: false,
        current_time: 0.0,
        clock_updated: tokio::time::Instant::now(),
    };

    session.participants.insert(
        username.to_string(),
        Participant {
            plex_username: username.to_string(),
            plex_thumb: plex_thumb.to_string(),
            is_host: true,
            state: if protocol_version >= 2 {
                "joined-buffering"
            } else {
                "ready"
            }
            .to_string(),
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

    broadcast_state(state, &session_id);
    info!(session_id = %session_id, host = %username, "Session created");
}

/// Join an existing session.
pub fn join_session(
    state: &SharedState,
    session_id: &str,
    username: &str,
    plex_thumb: &str,
    sender: tokio::sync::mpsc::Sender<Arc<String>>,
) {
    cleanup_disconnected_inner(state);
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

    if session.removed.contains(username) {
        drop(session);
        send_to_user(
            state,
            username,
            &ServerMessage::SessionError {
                reason: "Removed participant needs a new host invite".into(),
            },
        );
        return;
    }
    if session.disconnected.contains_key(username) {
        drop(session);
        reconnect(state, session_id, username, sender);
        return;
    }
    // Check if already in session
    if session.participants.contains_key(username) {
        if session.protocol_version >= 2 {
            drop(session);
            broadcast_state(state, session_id);
            return;
        }
        send_to_user(
            state,
            username,
            &ServerMessage::SessionError {
                reason: "Already in this session".into(),
            },
        );
        return;
    }
    drop(session);
    leave_session(state, username);
    let Some(mut session) = state.sessions.get_mut(session_id) else {
        return;
    };
    session.invited.remove(username);
    let joined_state = if session.protocol_version >= 2 {
        "joined-buffering"
    } else {
        "buffering"
    };

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
            state: joined_state.to_string(),
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
                state: joined_state.to_string(),
            },
        },
        Some(username),
    );

    broadcast_state(state, session_id);
    info!(session_id = %session_id, user = %username, "User joined session");
}

/// Remove a user from their current session. Destroys session if empty.
pub fn leave_session(state: &SharedState, username: &str) {
    let Some(conn) = state.connections.get(username) else {
        return;
    };
    let session_id = conn.session_id.clone();
    let sender = conn.sender.clone();
    drop(conn);
    if let Some(session_id) = session_id {
        leave_session_inner(state, username, &session_id, &sender);
        if let Some(mut conn) = state.connections.get_mut(username) {
            if conn.sender.same_channel(&sender) {
                conn.session_id = None;
            }
        }
    }
}

/// The disconnected handle has already been removed from the connection map.
pub fn leave_session_for_disconnect(
    state: &SharedState,
    username: &str,
    handle: &ConnectionHandle,
) {
    if let Some(session_id) = &handle.session_id {
        let Some(mut session) = state.sessions.get_mut(session_id) else {
            return;
        };
        if session.protocol_version < 2 {
            drop(session);
            leave_session_inner(state, username, session_id, &handle.sender);
            return;
        }
        if !session
            .participants
            .get(username)
            .is_some_and(|p| p.sender.same_channel(&handle.sender))
        {
            return;
        }
        let host = session.host_username == username;
        if host {
            freeze_clock(&mut session);
            session.resume_after_host = session.playing;
            session.playing = false;
        }
        let seconds = if host { 60 } else { 120 };
        session.disconnected.insert(
            username.to_string(),
            tokio::time::Instant::now() + std::time::Duration::from_secs(seconds),
        );
        if let Some(mut p) = session.participants.get_mut(username) {
            p.state = "reconnecting".into();
        }
        let position = session.current_time;
        drop(session);
        if host {
            broadcast_to_session(
                state,
                session_id,
                &ServerMessage::Pause {
                    current_time: position,
                    timestamp: now_ms(),
                    from_user: username.into(),
                },
                None,
            );
        }
        broadcast_state(state, session_id);
    }
}

fn leave_session_inner(
    state: &SharedState,
    username: &str,
    session_id: &str,
    sender: &tokio::sync::mpsc::Sender<Arc<String>>,
) {
    let Some(mut session) = state.sessions.get_mut(session_id) else {
        return;
    };
    let removed = session.participants.remove_if(username, |_, participant| {
        participant.sender.same_channel(sender)
    });
    if removed.is_none() {
        return;
    }
    session.disconnected.remove(username);
    let was_host = session.host_username == username;
    let remaining: Vec<String> = if was_host {
        session
            .participants
            .iter()
            .map(|entry| entry.key().clone())
            .collect()
    } else {
        Vec::new()
    };
    let empty = session.participants.is_empty();
    if was_host || empty {
        // Hold the session lock through revocation so reconnect replay cannot
        // enqueue an obsolete invite after its dismissal event.
        for invitee in session.invited.drain() {
            send_to_user(
                state,
                &invitee,
                &ServerMessage::InviteRevoked {
                    session_id: session_id.to_string(),
                },
            );
        }
        state.pending_invites.revoke_session(session_id);
    }
    drop(session);

    if was_host && !empty {
        broadcast_to_session(state, session_id, &ServerMessage::SessionDestroyed, None);
        for participant in remaining {
            if let Some(mut conn) = state.connections.get_mut(&participant) {
                if conn.session_id.as_deref() == Some(session_id) {
                    conn.session_id = None;
                }
            }
        }
    } else if !empty {
        broadcast_to_session(
            state,
            session_id,
            &ServerMessage::ParticipantLeft {
                plex_username: username.to_string(),
            },
            None,
        );
        maybe_start(state, session_id, false);
        broadcast_state(state, session_id);
        info!(session_id, user = %username, "User left session");
        return;
    }
    state.sessions.remove(session_id);
    info!(session_id, "Session destroyed");
}

/// Handle an invite using only authenticated identity and server-owned metadata.
pub fn handle_invite(
    state: &SharedState,
    target_username: &str,
    session_id: &str,
    sender_username: &str,
    sender_thumb: &str,
) {
    let reject = |reason: &str| {
        warn!(user = %sender_username, reason, "Invite rejected");
        send_to_user(
            state,
            sender_username,
            &ServerMessage::SessionError {
                reason: reason.into(),
            },
        );
    };
    let Some(relay_url) = state.public_url.as_deref() else {
        reject("Invitations disabled: relay public URL is not configured");
        return;
    };
    if target_username.is_empty()
        || target_username.len() > 256
        || target_username.chars().any(char::is_control)
    {
        reject("Invalid invite target");
        return;
    }
    let in_session = state
        .connections
        .get(sender_username)
        .is_some_and(|conn| conn.session_id.as_deref() == Some(session_id));
    // Serialize invite delivery and roster updates with cancellation.
    let mut session = match state.sessions.get_mut(session_id) {
        Some(session)
            if in_session
                && session.participants.contains_key(sender_username)
                && (session.protocol_version < 2 || session.host_username == sender_username) =>
        {
            session
        }
        _ => {
            reject("Invite sender must belong to the session");
            return;
        }
    };
    let pending = PendingInviteInfo {
        session_id: session_id.to_string(),
        media_title: session.media_title.clone(),
        media_rating_key: session.media_rating_key.clone(),
        media_type: session.media_type.clone(),
        sender_username: sender_username.to_string(),
        sender_thumb: sender_thumb.to_string(),
        sent_at: now_ms(),
        relay_url: relay_url.to_string(),
    };
    // Bound string storage and delivery payloads, even for online recipients.
    if !crate::pending_invites::fits_size_limit(&pending) {
        reject("Invite metadata is too large");
        return;
    }
    if state.connections.contains_key(target_username) {
        let invite_msg = ServerMessage::InviteReceived {
            session_id: pending.session_id,
            media_title: pending.media_title,
            media_rating_key: pending.media_rating_key,
            media_type: pending.media_type,
            sender_username: pending.sender_username,
            sender_thumb: pending.sender_thumb,
            sent_at: pending.sent_at,
            relay_url: pending.relay_url,
        };
        send_to_user(state, target_username, &invite_msg);
        info!(from = %sender_username, to = %target_username, "Invite delivered");
    } else {
        match state.pending_invites.insert(target_username, pending) {
            Ok(()) => {
                info!(from = %sender_username, to = %target_username, "Invite queued or deduplicated")
            }
            Err(reason) => {
                reject(reason);
                return;
            }
        }
    }
    session.removed.remove(target_username);
    if !session.participants.contains_key(target_username) {
        session.invited.insert(target_username.into());
    }
    drop(session);
    broadcast_state(state, session_id);
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

    if let Some(mut session) = state.sessions.get_mut(&session_id) {
        if session.protocol_version >= 2 {
            if !session.participants.contains_key(username)
                || session.disconnected.contains_key(username)
            {
                return;
            }
            match msg {
                ServerMessage::Ready { .. } | ServerMessage::Buffering { .. } => {
                    if let Some(mut p) = session.participants.get_mut(username) {
                        p.state = if matches!(msg, ServerMessage::Ready { .. }) {
                            "ready"
                        } else {
                            "joined-buffering"
                        }
                        .into();
                    }
                }
                ServerMessage::Play { current_time, .. }
                | ServerMessage::Pause { current_time, .. }
                | ServerMessage::Seek { current_time, .. } => {
                    if !session.started
                        || session.disconnected.contains_key(&session.host_username)
                        || !current_time.is_finite()
                        || *current_time < 0.0
                    {
                        return;
                    }
                    session.current_time = *current_time;
                    session.clock_updated = tokio::time::Instant::now();
                    if matches!(msg, ServerMessage::Play { .. }) {
                        session.playing = true;
                    }
                    if matches!(msg, ServerMessage::Pause { .. }) {
                        session.playing = false;
                    }
                }
                _ => return,
            }
            drop(session);
            broadcast_to_session(state, &session_id, msg, Some(username));
            maybe_start(state, &session_id, false);
            broadcast_state(state, &session_id);
            return;
        }
    }

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

/// Handle new_media event: only the host can change media.
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

    // Only the host can change media
    if let Some(session) = state.sessions.get(&session_id) {
        if session.host_username != username {
            warn!(user = %username, session_id = %session_id, "Non-host tried to change media");
            send_to_user(
                state,
                username,
                &ServerMessage::SessionError {
                    reason: "Only the host can change media".into(),
                },
            );
            return;
        }
    }

    // Update session media info
    if let Some(mut session) = state.sessions.get_mut(&session_id) {
        session.media_rating_key = media_rating_key.to_string();
        session.media_title = media_title.to_string();
        session.media_type = media_type.to_string();
        if session.protocol_version >= 2 {
            session.started = false;
            session.playing = false;
            session.resume_after_host = false;
            session.current_time = 0.0;
            for mut p in session.participants.iter_mut() {
                if !session.disconnected.contains_key(p.key()) {
                    p.state = "joined-buffering".into();
                }
            }
        }
    }

    let msg = ServerMessage::NewMedia {
        media_rating_key: media_rating_key.to_string(),
        media_title: media_title.to_string(),
        media_type: media_type.to_string(),
        from_user: username.to_string(),
    };

    // Broadcast to everyone except the sender (sender navigates locally)
    broadcast_to_session(state, &session_id, &msg, Some(username));

    broadcast_state(state, &session_id);
    info!(
        session_id = %session_id,
        user = %username,
        media = %media_title,
        "New media loaded in session"
    );
}

/// Clean up expired pending invites (older than 10 minutes).
pub fn cleanup_expired_invites(state: &SharedState) {
    state.pending_invites.cleanup();
}

fn freeze_clock(session: &mut Session) {
    if session.playing {
        session.current_time += session.clock_updated.elapsed().as_secs_f64();
    }
    session.clock_updated = tokio::time::Instant::now();
}

fn broadcast_state(state: &SharedState, session_id: &str) {
    let Some(session) = state.sessions.get(session_id) else {
        return;
    };
    if session.protocol_version < 2 {
        return;
    }
    let mut participants: Vec<_> = session
        .participants
        .iter()
        .map(|p| ParticipantInfo {
            plex_username: p.plex_username.clone(),
            plex_thumb: p.plex_thumb.clone(),
            is_host: p.is_host,
            state: p.state.clone(),
        })
        .collect();
    participants.extend(session.invited.iter().map(|name| ParticipantInfo {
        plex_username: name.clone(),
        plex_thumb: String::new(),
        is_host: false,
        state: "invited".into(),
    }));
    participants.sort_by(|a, b| a.plex_username.cmp(&b.plex_username));
    let msg = ServerMessage::SessionState {
        session_id: session_id.into(),
        protocol_version: session.protocol_version,
        media_title: session.media_title.clone(),
        media_rating_key: session.media_rating_key.clone(),
        media_type: session.media_type.clone(),
        phase: if session.started { "playback" } else { "lobby" }.into(),
        participants,
        host_away: session.disconnected.contains_key(&session.host_username),
        playing: session.playing,
        current_time: session.current_time
            + if session.playing {
                session.clock_updated.elapsed().as_secs_f64()
            } else {
                0.0
            },
        timestamp: now_ms(),
    };
    drop(session);
    broadcast_to_session(state, session_id, &msg, None);
}

fn maybe_start(state: &SharedState, session_id: &str, force: bool) {
    let Some(mut session) = state.sessions.get_mut(session_id) else {
        return;
    };
    if session.protocol_version < 2
        || session.started
        || session.disconnected.contains_key(&session.host_username)
    {
        return;
    }
    if !force
        && (!session.invited.is_empty()
            || !session.disconnected.is_empty()
            || session.participants.iter().any(|p| p.state != "ready"))
    {
        return;
    }
    session.started = true;
    session.playing = true;
    session.clock_updated = tokio::time::Instant::now();
    let msg = ServerMessage::SessionStarted {
        current_time: session.current_time,
        timestamp: now_ms(),
    };
    drop(session);
    broadcast_to_session(state, session_id, &msg, None);
}

pub fn start_now(state: &SharedState, username: &str) {
    let Some(id) = state
        .connections
        .get(username)
        .and_then(|c| c.session_id.clone())
    else {
        return;
    };
    if state
        .sessions
        .get(&id)
        .is_none_or(|s| s.host_username != username)
    {
        send_to_user(
            state,
            username,
            &ServerMessage::SessionError {
                reason: "Only the host can start playback".into(),
            },
        );
        return;
    }
    maybe_start(state, &id, true);
    broadcast_state(state, &id);
}

pub fn remove_participant(state: &SharedState, username: &str, target: &str) {
    let Some(id) = state
        .connections
        .get(username)
        .and_then(|c| c.session_id.clone())
    else {
        return;
    };
    let Some(mut session) = state.sessions.get_mut(&id) else {
        return;
    };
    if session.protocol_version < 2 || session.host_username != username || target == username {
        drop(session);
        send_to_user(
            state,
            username,
            &ServerMessage::SessionError {
                reason: "Only the host can remove a guest".into(),
            },
        );
        return;
    }
    session.invited.remove(target);
    let was_participant = session.participants.remove(target).is_some();
    session.disconnected.remove(target);
    session.removed.insert(target.into());
    state.pending_invites.revoke(target, &id);
    send_to_user(
        state,
        target,
        &ServerMessage::InviteRevoked {
            session_id: id.clone(),
        },
    );
    drop(session);
    if let Some(mut conn) = state.connections.get_mut(target) {
        if conn.session_id.as_deref() == Some(&id) {
            conn.session_id = None;
        }
    }
    let msg = ServerMessage::ParticipantRemoved {
        plex_username: target.into(),
    };
    // The legacy event has no session ID: never send it to a mere invitee
    // who may currently be watching in a different session.
    if was_participant {
        send_to_user(state, target, &msg);
    }
    broadcast_to_session(state, &id, &msg, None);
    maybe_start(state, &id, false);
    broadcast_state(state, &id);
}

fn reconnect(
    state: &SharedState,
    id: &str,
    username: &str,
    sender: tokio::sync::mpsc::Sender<Arc<String>>,
) {
    // Expire first so a late reconnect cannot revive an expired slot.
    cleanup_disconnected_inner(state);
    leave_session(state, username);
    let Some(mut session) = state.sessions.get_mut(id) else {
        send_to_user(
            state,
            username,
            &ServerMessage::SessionError {
                reason: "Session not found".into(),
            },
        );
        return;
    };
    if session.disconnected.remove(username).is_none() {
        drop(session);
        send_to_user(
            state,
            username,
            &ServerMessage::SessionError {
                reason: "Reconnect grace expired; join again".into(),
            },
        );
        return;
    }
    if let Some(mut p) = session.participants.get_mut(username) {
        p.sender = sender;
        p.state = "joined-buffering".into();
    }
    let host = session.host_username == username;
    if host {
        session.playing = session.resume_after_host;
        session.resume_after_host = false;
        session.clock_updated = tokio::time::Instant::now();
    }
    let resume = session.playing && host;
    let position = session.current_time;
    let participants = session
        .participants
        .iter()
        .map(|p| ParticipantInfo {
            plex_username: p.plex_username.clone(),
            plex_thumb: p.plex_thumb.clone(),
            is_host: p.is_host,
            state: p.state.clone(),
        })
        .collect();
    drop(session);
    if let Some(mut conn) = state.connections.get_mut(username) {
        conn.session_id = Some(id.into());
    }
    send_to_user(
        state,
        username,
        &ServerMessage::SessionJoined {
            session_id: id.into(),
            participants,
        },
    );
    if resume {
        broadcast_to_session(
            state,
            id,
            &ServerMessage::Play {
                current_time: position,
                timestamp: now_ms(),
                from_user: username.into(),
            },
            None,
        );
    }
    broadcast_state(state, id);
}

/// Monotonic grace deadlines, independent of wall-clock changes.
pub fn cleanup_disconnected(state: &SharedState) {
    let _guard = state
        .session_operations
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    cleanup_disconnected_inner(state);
}

fn cleanup_disconnected_inner(state: &SharedState) {
    let now = tokio::time::Instant::now();
    let expired: Vec<_> = state
        .sessions
        .iter()
        .flat_map(|s| {
            s.disconnected
                .iter()
                .filter(|(_, deadline)| **deadline <= now)
                .filter_map(|(name, _)| {
                    s.participants
                        .get(name)
                        .map(|p| (s.id.clone(), name.clone(), p.sender.clone()))
                })
                .collect::<Vec<_>>()
        })
        .collect();
    for (id, name, sender) in expired {
        // Recheck: a reconnect may have replaced the sender since collection.
        if state.sessions.get(&id).is_some_and(|s| {
            s.disconnected
                .get(&name)
                .is_some_and(|deadline| *deadline <= now)
        }) {
            leave_session_inner(state, &name, &id, &sender);
        }
    }
}
