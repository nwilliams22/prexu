use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio::time::{interval, Duration};
use tracing::{info, warn};

use crate::messages::{ClientMessage, ServerMessage};
use crate::session;
use crate::state::{ConnectionHandle, SharedState};

/// Handle a single WebSocket connection.
pub async fn handle_connection(ws: WebSocket, state: SharedState) {
    let (mut ws_sender, mut ws_receiver) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // Phase 1: Auth handshake (must receive auth within 10 seconds)
    let auth_result = tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            if let Message::Text(text) = msg {
                if let Ok(ClientMessage::Auth {
                    plex_username,
                    plex_thumb,
                }) = serde_json::from_str(&text)
                {
                    return Some((plex_username, plex_thumb));
                }
            }
        }
        None
    })
    .await;

    let (username, thumb) = match auth_result {
        Ok(Some((u, t))) => (u, t),
        _ => {
            let err = ServerMessage::AuthError {
                reason: "Auth timeout or invalid auth message".into(),
            };
            if let Ok(json) = serde_json::to_string(&err) {
                let _ = ws_sender.send(Message::Text(json.into())).await;
            }
            return;
        }
    };

    info!(user = %username, "User authenticated");

    // Register connection
    state.connections.insert(
        username.clone(),
        ConnectionHandle {
            plex_username: username.clone(),
            plex_thumb: thumb.clone(),
            session_id: None,
            sender: tx.clone(),
        },
    );

    // Send auth_ok
    let auth_ok = ServerMessage::AuthOk {
        plex_username: username.clone(),
    };
    if let Ok(json) = serde_json::to_string(&auth_ok) {
        let _ = tx.send(json);
    }

    // Deliver any pending invites
    if let Some((_, invites)) = state.pending_invites.remove(&username) {
        if !invites.is_empty() {
            let msg = ServerMessage::PendingInvites { invites };
            if let Ok(json) = serde_json::to_string(&msg) {
                let _ = tx.send(json);
            }
        }
    }

    // Phase 2: Spawn writer task (channel rx → WebSocket)
    let writer_handle = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Phase 3: Reader loop with keepalive
    let mut keepalive = interval(Duration::from_secs(30));
    let state_clone = state.clone();
    let username_clone = username.clone();
    let thumb_clone = thumb.clone();

    loop {
        tokio::select! {
            msg = ws_receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_client_message(
                            &state_clone,
                            &username_clone,
                            &thumb_clone,
                            &text,
                            &tx,
                        );
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {} // Ignore binary, ping/pong handled by axum
                }
            }
            _ = keepalive.tick() => {
                let pong = ServerMessage::Pong;
                if let Ok(json) = serde_json::to_string(&pong) {
                    if tx.send(json).is_err() {
                        break;
                    }
                }
            }
        }
    }

    // Cleanup on disconnect
    info!(user = %username, "User disconnected");
    session::leave_session(&state, &username);
    state.connections.remove(&username);
    writer_handle.abort();
}

/// Dispatch a parsed client message to the appropriate session handler.
fn handle_client_message(
    state: &SharedState,
    username: &str,
    thumb: &str,
    raw: &str,
    sender: &mpsc::UnboundedSender<String>,
) {
    let msg: ClientMessage = match serde_json::from_str(raw) {
        Ok(m) => m,
        Err(e) => {
            warn!(user = %username, error = %e, "Failed to parse client message");
            return;
        }
    };

    match msg {
        ClientMessage::Auth { .. } => {
            // Already authenticated, ignore duplicate auth
        }

        ClientMessage::CreateSession {
            session_id,
            media_title,
            media_rating_key,
            media_type,
        } => {
            session::create_session(
                state,
                session_id,
                username,
                thumb,
                media_title,
                media_rating_key,
                media_type,
                sender.clone(),
            );
        }

        ClientMessage::JoinSession { session_id } => {
            session::join_session(state, &session_id, username, thumb, sender.clone());
        }

        ClientMessage::LeaveSession => {
            session::leave_session(state, username);
        }

        ClientMessage::Invite {
            target_username,
            session_id,
            media_title,
            media_rating_key,
            media_type,
            sender_username,
            sender_thumb,
        } => {
            session::handle_invite(
                state,
                &target_username,
                &session_id,
                &media_title,
                &media_rating_key,
                &media_type,
                &sender_username,
                &sender_thumb,
            );
        }

        ClientMessage::Play {
            current_time,
            timestamp,
        } => {
            let relay_msg = ServerMessage::Play {
                current_time,
                timestamp,
                from_user: username.to_string(),
            };
            session::relay_playback_event(state, username, &relay_msg);
        }

        ClientMessage::Pause {
            current_time,
            timestamp,
        } => {
            let relay_msg = ServerMessage::Pause {
                current_time,
                timestamp,
                from_user: username.to_string(),
            };
            session::relay_playback_event(state, username, &relay_msg);
        }

        ClientMessage::Seek {
            current_time,
            timestamp,
        } => {
            let relay_msg = ServerMessage::Seek {
                current_time,
                timestamp,
                from_user: username.to_string(),
            };
            session::relay_playback_event(state, username, &relay_msg);
        }

        ClientMessage::Buffering { current_time: _ } => {
            let relay_msg = ServerMessage::Buffering {
                from_user: username.to_string(),
            };
            session::relay_playback_event(state, username, &relay_msg);
        }

        ClientMessage::Ready { current_time } => {
            let relay_msg = ServerMessage::Ready {
                current_time,
                from_user: username.to_string(),
            };
            session::relay_playback_event(state, username, &relay_msg);
        }

        ClientMessage::NewMedia {
            media_rating_key,
            media_title,
            media_type,
        } => {
            session::handle_new_media(
                state,
                username,
                &media_rating_key,
                &media_title,
                &media_type,
            );
        }

        ClientMessage::Ping => {
            let pong = ServerMessage::Pong;
            if let Ok(json) = serde_json::to_string(&pong) {
                let _ = sender.send(json);
            }
        }
    }
}
