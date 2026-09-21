use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream};

type WsStream = tokio_tungstenite::WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

/// Default timeout for receiving a WebSocket message in tests.
const RECV_TIMEOUT: Duration = Duration::from_secs(5);

/// Start the relay server on an ephemeral port and return its address.
/// The server runs in a background task and will be dropped when the test ends.
///
/// Auth bypass is enabled at compile time via the `test-mode` feature
/// (activated automatically for dev/test builds in Cargo.toml).
async fn start_test_server() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to bind ephemeral port");
    let addr = listener.local_addr().unwrap();

    let state = Arc::new(
        prexu_relay::AppState::new()
            .with_public_url("wss://trusted-relay.example/ws")
            .unwrap(),
    );
    prexu_relay::spawn_cleanup_task(state.clone());
    let app = prexu_relay::build_router(state);

    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    addr
}

/// Connect a WebSocket client to the test server.
async fn ws_connect(addr: SocketAddr) -> WsStream {
    let url = format!("ws://{}/ws", addr);
    let (ws, _) = connect_async(&url)
        .await
        .expect("failed to connect WebSocket");
    ws
}

/// Send a JSON text message on the WebSocket.
async fn ws_send(ws: &mut WsStream, json: &serde_json::Value) {
    let text = serde_json::to_string(json).unwrap();
    ws.send(Message::Text(text.into())).await.unwrap();
}

/// Receive the next text message and parse it as JSON, with a timeout.
async fn ws_recv(ws: &mut WsStream) -> serde_json::Value {
    let msg = timeout(RECV_TIMEOUT, async {
        loop {
            match ws.next().await {
                Some(Ok(Message::Text(t))) => {
                    return serde_json::from_str::<serde_json::Value>(&t).unwrap();
                }
                Some(Ok(_)) => continue, // skip ping/pong/binary
                Some(Err(e)) => panic!("WebSocket error: {}", e),
                None => panic!("WebSocket closed unexpectedly"),
            }
        }
    })
    .await
    .expect("timed out waiting for WebSocket message");
    msg
}

/// Try to receive a message, returning None if nothing arrives within the timeout.
async fn ws_try_recv(ws: &mut WsStream, dur: Duration) -> Option<serde_json::Value> {
    timeout(dur, async {
        loop {
            match ws.next().await {
                Some(Ok(Message::Text(t))) => {
                    return serde_json::from_str::<serde_json::Value>(&t).unwrap();
                }
                Some(Ok(_)) => continue,
                Some(Err(_)) | None => return serde_json::Value::Null,
            }
        }
    })
    .await
    .ok()
}

/// Perform the auth handshake and return the auth_ok response.
async fn authenticate(ws: &mut WsStream, username: &str) -> serde_json::Value {
    ws_send(
        ws,
        &serde_json::json!({
            "type": "auth",
            "plex_token": username,
            "plex_username": username,
            "plex_thumb": ""
        }),
    )
    .await;
    let resp = ws_recv(ws).await;
    assert_eq!(resp["type"], "auth_ok", "expected auth_ok, got: {}", resp);
    resp
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_health_endpoint() {
    let addr = start_test_server().await;
    let url = format!("http://{}/health", addr);
    let resp = reqwest::get(&url).await.unwrap();
    assert!(resp.status().is_success());
    let body = resp.text().await.unwrap();
    assert!(body.starts_with("OK"));
}

#[tokio::test]
async fn test_auth_success() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;
    let resp = authenticate(&mut ws, "testuser").await;
    assert_eq!(resp["plex_username"], "testuser");
}

#[tokio::test]
async fn test_auth_timeout() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;

    // Don't send auth — wait for the server to time out (10s)
    let msg = timeout(Duration::from_secs(15), async {
        loop {
            match ws.next().await {
                Some(Ok(Message::Text(t))) => {
                    return serde_json::from_str::<serde_json::Value>(&t).unwrap();
                }
                Some(Ok(Message::Close(_))) | None => {
                    return serde_json::json!({"type": "connection_closed"});
                }
                Some(Ok(_)) => continue,
                Some(Err(_)) => {
                    return serde_json::json!({"type": "connection_error"});
                }
            }
        }
    })
    .await
    .expect("did not get auth error or close within 15s");

    // Server should send auth_error or close the connection
    let msg_type = msg["type"].as_str().unwrap_or("");
    assert!(
        msg_type == "auth_error"
            || msg_type == "connection_closed"
            || msg_type == "connection_error",
        "expected auth_error or close, got: {}",
        msg
    );
}

#[tokio::test]
async fn test_invalid_auth_message() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;

    // Send a non-auth message — server should not respond with auth_ok
    ws_send(
        &mut ws,
        &serde_json::json!({
            "type": "ping"
        }),
    )
    .await;

    // The server ignores non-auth messages during auth phase and eventually
    // times out. We just verify no auth_ok is received quickly.
    let resp = ws_try_recv(&mut ws, Duration::from_millis(500)).await;
    // None is expected: no response yet (waiting for auth).
    if let Some(val) = resp {
        assert_ne!(
            val["type"], "auth_ok",
            "should not get auth_ok for non-auth message"
        );
    }
}

#[tokio::test]
async fn test_create_session() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "host_user").await;

    ws_send(
        &mut ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "test-session-1",
            "media_title": "Test Movie",
            "media_rating_key": "12345",
            "media_type": "movie"
        }),
    )
    .await;

    let resp = ws_recv(&mut ws).await;
    assert_eq!(resp["type"], "session_created");
    assert_eq!(resp["session_id"], "test-session-1");
}

#[tokio::test]
async fn test_create_duplicate_session() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "host_user").await;

    let create_msg = serde_json::json!({
        "type": "create_session",
        "session_id": "dup-session",
        "media_title": "Test Movie",
        "media_rating_key": "12345",
        "media_type": "movie"
    });

    ws_send(&mut ws, &create_msg).await;
    let resp = ws_recv(&mut ws).await;
    assert_eq!(resp["type"], "session_created");

    // Create same session again — should get error
    ws_send(&mut ws, &create_msg).await;
    let resp = ws_recv(&mut ws).await;
    assert_eq!(resp["type"], "session_error");
    assert!(resp["reason"].as_str().unwrap().contains("already exists"));
}

#[tokio::test]
async fn test_join_session() {
    let addr = start_test_server().await;

    // Host creates session
    let mut host_ws = ws_connect(addr).await;
    authenticate(&mut host_ws, "host_user").await;

    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "join-test",
            "media_title": "Test Movie",
            "media_rating_key": "12345",
            "media_type": "movie"
        }),
    )
    .await;
    let resp = ws_recv(&mut host_ws).await;
    assert_eq!(resp["type"], "session_created");

    // Guest joins session
    let mut guest_ws = ws_connect(addr).await;
    authenticate(&mut guest_ws, "guest_user").await;

    ws_send(
        &mut guest_ws,
        &serde_json::json!({
            "type": "join_session",
            "session_id": "join-test"
        }),
    )
    .await;

    let guest_resp = ws_recv(&mut guest_ws).await;
    assert_eq!(guest_resp["type"], "session_joined");
    assert_eq!(guest_resp["session_id"], "join-test");

    // Guest should see the host in participants
    let participants = guest_resp["participants"].as_array().unwrap();
    assert_eq!(participants.len(), 1);
    assert_eq!(participants[0]["plex_username"], "host_user");
    assert_eq!(participants[0]["is_host"], true);

    // Host should be notified of the new participant
    let host_resp = ws_recv(&mut host_ws).await;
    assert_eq!(host_resp["type"], "participant_joined");
    assert_eq!(host_resp["participant"]["plex_username"], "guest_user");
    assert_eq!(host_resp["participant"]["is_host"], false);
}

#[tokio::test]
async fn test_join_nonexistent_session() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "user1").await;

    ws_send(
        &mut ws,
        &serde_json::json!({
            "type": "join_session",
            "session_id": "no-such-session"
        }),
    )
    .await;

    let resp = ws_recv(&mut ws).await;
    assert_eq!(resp["type"], "session_error");
    assert!(resp["reason"].as_str().unwrap().contains("not found"));
}

#[tokio::test]
async fn test_join_session_already_in() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "host_user").await;

    ws_send(
        &mut ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "already-in-test",
            "media_title": "Test Movie",
            "media_rating_key": "12345",
            "media_type": "movie"
        }),
    )
    .await;
    ws_recv(&mut ws).await; // session_created

    // Try to join the same session we created (we're already in it)
    ws_send(
        &mut ws,
        &serde_json::json!({
            "type": "join_session",
            "session_id": "already-in-test"
        }),
    )
    .await;

    let resp = ws_recv(&mut ws).await;
    assert_eq!(resp["type"], "session_error");
    assert!(resp["reason"].as_str().unwrap().contains("Already in"));
}

#[tokio::test]
async fn test_leave_session() {
    let addr = start_test_server().await;

    // Host creates session
    let mut host_ws = ws_connect(addr).await;
    authenticate(&mut host_ws, "host_user").await;
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "leave-test",
            "media_title": "Test Movie",
            "media_rating_key": "12345",
            "media_type": "movie"
        }),
    )
    .await;
    ws_recv(&mut host_ws).await; // session_created

    // Guest joins
    let mut guest_ws = ws_connect(addr).await;
    authenticate(&mut guest_ws, "guest_user").await;
    ws_send(
        &mut guest_ws,
        &serde_json::json!({
            "type": "join_session",
            "session_id": "leave-test"
        }),
    )
    .await;
    ws_recv(&mut guest_ws).await; // session_joined
    ws_recv(&mut host_ws).await; // participant_joined

    // Guest leaves
    ws_send(
        &mut guest_ws,
        &serde_json::json!({
            "type": "leave_session"
        }),
    )
    .await;

    // Host should be notified
    let host_resp = ws_recv(&mut host_ws).await;
    assert_eq!(host_resp["type"], "participant_left");
    assert_eq!(host_resp["plex_username"], "guest_user");
}

#[tokio::test]
async fn test_session_destroyed_when_empty() {
    let addr = start_test_server().await;

    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "solo_user").await;

    ws_send(
        &mut ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "destroy-test",
            "media_title": "Test Movie",
            "media_rating_key": "12345",
            "media_type": "movie"
        }),
    )
    .await;
    ws_recv(&mut ws).await; // session_created

    // Leave session — session should be destroyed (only participant)
    ws_send(&mut ws, &serde_json::json!({ "type": "leave_session" })).await;

    // Trying to join should fail
    let mut ws2 = ws_connect(addr).await;
    authenticate(&mut ws2, "other_user").await;
    ws_send(
        &mut ws2,
        &serde_json::json!({
            "type": "join_session",
            "session_id": "destroy-test"
        }),
    )
    .await;

    let resp = ws_recv(&mut ws2).await;
    assert_eq!(resp["type"], "session_error");
    assert!(resp["reason"].as_str().unwrap().contains("not found"));
}

#[tokio::test]
async fn test_disconnect_cleans_up_session() {
    let addr = start_test_server().await;

    // Host creates session
    let mut host_ws = ws_connect(addr).await;
    authenticate(&mut host_ws, "host_dc").await;
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "dc-test",
            "media_title": "Test Movie",
            "media_rating_key": "12345",
            "media_type": "movie"
        }),
    )
    .await;
    ws_recv(&mut host_ws).await; // session_created

    // Guest joins
    let mut guest_ws = ws_connect(addr).await;
    authenticate(&mut guest_ws, "guest_dc").await;
    ws_send(
        &mut guest_ws,
        &serde_json::json!({
            "type": "join_session",
            "session_id": "dc-test"
        }),
    )
    .await;
    ws_recv(&mut guest_ws).await; // session_joined
    ws_recv(&mut host_ws).await; // participant_joined

    // Guest disconnects abruptly
    guest_ws.close(None).await.ok();
    drop(guest_ws);

    // Host should get participant_left notification
    let host_resp = ws_recv(&mut host_ws).await;
    assert_eq!(host_resp["type"], "participant_left");
    assert_eq!(host_resp["plex_username"], "guest_dc");
}

#[tokio::test]
async fn test_play_pause_seek_relay() {
    let addr = start_test_server().await;

    // Host creates session
    let mut host_ws = ws_connect(addr).await;
    authenticate(&mut host_ws, "host_sync").await;
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "sync-test",
            "media_title": "Test Movie",
            "media_rating_key": "12345",
            "media_type": "movie"
        }),
    )
    .await;
    ws_recv(&mut host_ws).await; // session_created

    // Guest joins
    let mut guest_ws = ws_connect(addr).await;
    authenticate(&mut guest_ws, "guest_sync").await;
    ws_send(
        &mut guest_ws,
        &serde_json::json!({
            "type": "join_session",
            "session_id": "sync-test"
        }),
    )
    .await;
    ws_recv(&mut guest_ws).await; // session_joined
    ws_recv(&mut host_ws).await; // participant_joined

    // Host sends play
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "play",
            "current_time": 42.5,
            "timestamp": 1700000000000_u64
        }),
    )
    .await;

    let guest_msg = ws_recv(&mut guest_ws).await;
    assert_eq!(guest_msg["type"], "play");
    assert_eq!(guest_msg["current_time"], 42.5);
    assert_eq!(guest_msg["from_user"], "host_sync");

    // Guest sends pause
    ws_send(
        &mut guest_ws,
        &serde_json::json!({
            "type": "pause",
            "current_time": 45.0,
            "timestamp": 1700000001000_u64
        }),
    )
    .await;

    let host_msg = ws_recv(&mut host_ws).await;
    assert_eq!(host_msg["type"], "pause");
    assert_eq!(host_msg["current_time"], 45.0);
    assert_eq!(host_msg["from_user"], "guest_sync");

    // Host sends seek
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "seek",
            "current_time": 120.0,
            "timestamp": 1700000002000_u64
        }),
    )
    .await;

    let guest_msg = ws_recv(&mut guest_ws).await;
    assert_eq!(guest_msg["type"], "seek");
    assert_eq!(guest_msg["current_time"], 120.0);
    assert_eq!(guest_msg["from_user"], "host_sync");
}

#[tokio::test]
async fn test_buffering_and_ready_relay() {
    let addr = start_test_server().await;

    let mut host_ws = ws_connect(addr).await;
    authenticate(&mut host_ws, "host_br").await;
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "br-test",
            "media_title": "Test Movie",
            "media_rating_key": "12345",
            "media_type": "movie"
        }),
    )
    .await;
    ws_recv(&mut host_ws).await;

    let mut guest_ws = ws_connect(addr).await;
    authenticate(&mut guest_ws, "guest_br").await;
    ws_send(
        &mut guest_ws,
        &serde_json::json!({
            "type": "join_session",
            "session_id": "br-test"
        }),
    )
    .await;
    ws_recv(&mut guest_ws).await;
    ws_recv(&mut host_ws).await;

    // Guest sends buffering
    ws_send(
        &mut guest_ws,
        &serde_json::json!({
            "type": "buffering",
            "current_time": 10.0
        }),
    )
    .await;

    let host_msg = ws_recv(&mut host_ws).await;
    assert_eq!(host_msg["type"], "buffering");
    assert_eq!(host_msg["from_user"], "guest_br");

    // Guest sends ready
    ws_send(
        &mut guest_ws,
        &serde_json::json!({
            "type": "ready",
            "current_time": 10.0
        }),
    )
    .await;

    let host_msg = ws_recv(&mut host_ws).await;
    assert_eq!(host_msg["type"], "ready");
    assert_eq!(host_msg["from_user"], "guest_br");
    assert_eq!(host_msg["current_time"], 10.0);
}

#[tokio::test]
async fn test_new_media_relay() {
    let addr = start_test_server().await;

    let mut host_ws = ws_connect(addr).await;
    authenticate(&mut host_ws, "host_nm").await;
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "nm-test",
            "media_title": "First Movie",
            "media_rating_key": "111",
            "media_type": "movie"
        }),
    )
    .await;
    ws_recv(&mut host_ws).await;

    let mut guest_ws = ws_connect(addr).await;
    authenticate(&mut guest_ws, "guest_nm").await;
    ws_send(
        &mut guest_ws,
        &serde_json::json!({
            "type": "join_session",
            "session_id": "nm-test"
        }),
    )
    .await;
    ws_recv(&mut guest_ws).await;
    ws_recv(&mut host_ws).await;

    // Host switches media
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "new_media",
            "media_rating_key": "222",
            "media_title": "Second Movie",
            "media_type": "movie"
        }),
    )
    .await;

    let guest_msg = ws_recv(&mut guest_ws).await;
    assert_eq!(guest_msg["type"], "new_media");
    assert_eq!(guest_msg["media_title"], "Second Movie");
    assert_eq!(guest_msg["media_rating_key"], "222");
    assert_eq!(guest_msg["from_user"], "host_nm");
}

#[tokio::test]
async fn test_ping_pong() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "ping_user").await;

    ws_send(&mut ws, &serde_json::json!({ "type": "ping" })).await;

    let resp = ws_recv(&mut ws).await;
    assert_eq!(resp["type"], "pong");
}

#[tokio::test]
async fn test_invite_to_connected_user() {
    let addr = start_test_server().await;

    // Host creates session
    let mut host_ws = ws_connect(addr).await;
    authenticate(&mut host_ws, "host_inv").await;
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "inv-test",
            "media_title": "Test Movie",
            "media_rating_key": "12345",
            "media_type": "movie"
        }),
    )
    .await;
    ws_recv(&mut host_ws).await;

    // Target user connects (but doesn't join session)
    let mut target_ws = ws_connect(addr).await;
    authenticate(&mut target_ws, "target_inv").await;

    // Host sends invite
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "invite",
            "target_username": "target_inv",
            "session_id": "inv-test",
            "media_title": "Test Movie",
            "media_rating_key": "12345",
            "media_type": "movie",
            "sender_username": "forged-host",
            "sender_thumb": "https://example.com/thumb.jpg",
            "relay_url": "ws://localhost:8080/ws"
        }),
    )
    .await;

    // Target should receive the invite
    let invite = ws_recv(&mut target_ws).await;
    assert_eq!(invite["type"], "invite_received");
    assert_eq!(invite["session_id"], "inv-test");
    assert_eq!(invite["media_title"], "Test Movie");
    assert_eq!(invite["sender_username"], "host_inv");
    assert_eq!(
        invite["sender_thumb"],
        "https://plex.tv/users/host_inv/avatar"
    );
    assert_eq!(invite["relay_url"], "wss://trusted-relay.example/ws");
}

#[tokio::test]
async fn test_invite_to_offline_user_delivered_on_connect() {
    let addr = start_test_server().await;

    // Host creates session and sends invite to offline user
    let mut host_ws = ws_connect(addr).await;
    authenticate(&mut host_ws, "host_pend").await;
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "pend-test",
            "media_title": "Test Movie",
            "media_rating_key": "12345",
            "media_type": "movie"
        }),
    )
    .await;
    ws_recv(&mut host_ws).await;

    // Send invite to user who is NOT connected
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "invite",
            "target_username": "offline_user",
            "session_id": "pend-test",
            "media_title": "Test Movie",
            "media_rating_key": "12345",
            "media_type": "movie",
            "sender_username": "forged-host",
            "sender_thumb": "",
            "relay_url": "ws://localhost/ws"
        }),
    )
    .await;

    // Small delay to ensure invite is stored
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Now the offline user connects
    let mut offline_ws = ws_connect(addr).await;
    authenticate(&mut offline_ws, "offline_user").await;

    // Should receive pending_invites right after auth_ok
    let resp = ws_recv(&mut offline_ws).await;
    assert_eq!(resp["type"], "pending_invites");
    let invites = resp["invites"].as_array().unwrap();
    assert_eq!(invites.len(), 1);
    assert_eq!(invites[0]["session_id"], "pend-test");
    assert_eq!(invites[0]["sender_username"], "host_pend");
    assert_eq!(
        invites[0]["sender_thumb"],
        "https://plex.tv/users/host_pend/avatar"
    );
    assert_eq!(invites[0]["relay_url"], "wss://trusted-relay.example/ws");
}

#[tokio::test]
async fn test_playback_event_without_session() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "no_session_user").await;

    // Send play without being in a session — should not crash or produce errors
    ws_send(
        &mut ws,
        &serde_json::json!({
            "type": "play",
            "current_time": 10.0,
            "timestamp": 1700000000000_u64
        }),
    )
    .await;

    // No response expected, but ping should still work (connection still alive)
    ws_send(&mut ws, &serde_json::json!({ "type": "ping" })).await;
    let resp = ws_recv(&mut ws).await;
    assert_eq!(resp["type"], "pong");
}

#[tokio::test]
async fn test_invalid_json_does_not_crash() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "bad_json_user").await;

    // Send garbage text
    ws.send(Message::Text("this is not json".into()))
        .await
        .unwrap();

    // Connection should still be alive
    ws_send(&mut ws, &serde_json::json!({ "type": "ping" })).await;
    let resp = ws_recv(&mut ws).await;
    assert_eq!(resp["type"], "pong");
}

#[tokio::test]
async fn test_unknown_message_type_does_not_crash() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "unknown_type_user").await;

    ws_send(
        &mut ws,
        &serde_json::json!({
            "type": "nonexistent_command",
            "data": "whatever"
        }),
    )
    .await;

    // Connection should still be alive
    ws_send(&mut ws, &serde_json::json!({ "type": "ping" })).await;
    let resp = ws_recv(&mut ws).await;
    assert_eq!(resp["type"], "pong");
}

#[tokio::test]
async fn test_multiple_participants_playback_relay() {
    let addr = start_test_server().await;

    // Host
    let mut host_ws = ws_connect(addr).await;
    authenticate(&mut host_ws, "host_multi").await;
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "multi-test",
            "media_title": "Test Movie",
            "media_rating_key": "12345",
            "media_type": "movie"
        }),
    )
    .await;
    ws_recv(&mut host_ws).await;

    // Guest A joins
    let mut guest_a = ws_connect(addr).await;
    authenticate(&mut guest_a, "guest_a").await;
    ws_send(
        &mut guest_a,
        &serde_json::json!({
            "type": "join_session",
            "session_id": "multi-test"
        }),
    )
    .await;
    ws_recv(&mut guest_a).await; // session_joined
    ws_recv(&mut host_ws).await; // participant_joined(guest_a)

    // Guest B joins
    let mut guest_b = ws_connect(addr).await;
    authenticate(&mut guest_b, "guest_b").await;
    ws_send(
        &mut guest_b,
        &serde_json::json!({
            "type": "join_session",
            "session_id": "multi-test"
        }),
    )
    .await;
    ws_recv(&mut guest_b).await; // session_joined

    // Both host and guest_a should get participant_joined for guest_b
    let host_notif = ws_recv(&mut host_ws).await;
    assert_eq!(host_notif["type"], "participant_joined");
    assert_eq!(host_notif["participant"]["plex_username"], "guest_b");

    let ga_notif = ws_recv(&mut guest_a).await;
    assert_eq!(ga_notif["type"], "participant_joined");
    assert_eq!(ga_notif["participant"]["plex_username"], "guest_b");

    // Host sends play — both guests should receive it
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "play",
            "current_time": 10.0,
            "timestamp": 1700000000000_u64
        }),
    )
    .await;

    let ga_play = ws_recv(&mut guest_a).await;
    assert_eq!(ga_play["type"], "play");
    assert_eq!(ga_play["from_user"], "host_multi");

    let gb_play = ws_recv(&mut guest_b).await;
    assert_eq!(gb_play["type"], "play");
    assert_eq!(gb_play["from_user"], "host_multi");
}

#[tokio::test]
async fn test_rate_limiting() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "rate_user").await;

    // Create a session so messages are processed
    ws_send(
        &mut ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "rate-test",
            "media_title": "Test",
            "media_rating_key": "1",
            "media_type": "movie"
        }),
    )
    .await;
    ws_recv(&mut ws).await; // session_created

    // Send 35 messages rapidly (limit is 30 per second). The server disconnects
    // the moment the limit trips, so a send mid-loop can fail once the socket is
    // closing — tolerate that (the rate-limit error is already queued) rather
    // than unwrapping like ws_send and panicking before the assertion below.
    let ping = serde_json::to_string(&serde_json::json!({ "type": "ping" })).unwrap();
    for i in 0..35 {
        if ws.send(Message::Text(ping.clone().into())).await.is_err() {
            break;
        }
        // Tiny delay to avoid TCP-level backpressure, but fast enough to hit rate limit
        if i % 10 == 9 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    // The server enforces the limit by DISCONNECTING the client. The courtesy
    // "Rate limit exceeded" AuthError is best-effort (it is `try_send`, which is
    // dropped when the burst has already filled the outbound channel), so accept
    // EITHER that error OR the socket closing as proof we were rate-limited.
    // `ws_try_recv` yields `Value::Null` when the socket closes; a `None`
    // (read timeout with the socket still open) means we were NOT disconnected —
    // the limiter failed to fire.
    let mut rate_limited = false;
    for _ in 0..40 {
        match ws_try_recv(&mut ws, Duration::from_millis(500)).await {
            Some(msg) if msg.is_null() => {
                rate_limited = true; // socket closed = disconnected by the limiter
                break;
            }
            Some(msg) => {
                if msg["type"] == "auth_error"
                    && msg["reason"].as_str().unwrap_or("").contains("Rate limit")
                {
                    rate_limited = true;
                    break;
                }
            }
            None => break,
        }
    }

    assert!(
        rate_limited,
        "expected to be disconnected (rate limited) after rapid-fire messages"
    );
}

#[tokio::test]
async fn test_message_not_relayed_to_sender() {
    let addr = start_test_server().await;

    let mut host_ws = ws_connect(addr).await;
    authenticate(&mut host_ws, "host_echo").await;
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "echo-test",
            "media_title": "Test",
            "media_rating_key": "1",
            "media_type": "movie"
        }),
    )
    .await;
    ws_recv(&mut host_ws).await; // session_created

    // Send a play event (no other participants to receive it)
    ws_send(
        &mut host_ws,
        &serde_json::json!({
            "type": "play",
            "current_time": 5.0,
            "timestamp": 1700000000000_u64
        }),
    )
    .await;

    // Host should NOT receive their own play event back.
    // Ping to verify connection is alive and no play was echoed.
    ws_send(&mut host_ws, &serde_json::json!({ "type": "ping" })).await;
    let resp = ws_recv(&mut host_ws).await;
    assert_eq!(
        resp["type"], "pong",
        "expected pong (no echo of play), got: {}",
        resp
    );
}

// ── W11 (prexu-pd1x.11): keepalive-Pong + connection reuse ──────────────────

/// Start a test server with a custom (short) keepalive cadence so the
/// server-initiated Pong tick can be exercised without a 30s wait.
async fn start_test_server_with_keepalive(interval: Duration) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to bind ephemeral port");
    let addr = listener.local_addr().unwrap();

    let state = Arc::new(prexu_relay::AppState::with_keepalive_interval(interval));
    prexu_relay::spawn_cleanup_task(state.clone());
    let app = prexu_relay::build_router(state);

    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    addr
}

/// The server emits an UNSOLICITED keepalive `Pong` on its interval (not a
/// reply to a client ping). Guards the reader-loop `keepalive.tick()` arm.
#[tokio::test]
async fn test_server_keepalive_pong_tick() {
    let addr = start_test_server_with_keepalive(Duration::from_millis(120)).await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "keepalive_user").await;

    // Send nothing. Within ~one interval the server should push a pong on its own.
    let msg = ws_try_recv(&mut ws, Duration::from_millis(700)).await;
    assert_eq!(
        msg.expect("expected an unsolicited keepalive pong")["type"],
        "pong",
    );
}

/// A single authenticated connection is reusable across session lifecycles:
/// create a session, leave it (destroyed while empty), then create another on
/// the SAME socket.
#[tokio::test]
async fn test_ws_connection_reused_across_session_lifecycles() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "reuse_user").await;

    ws_send(
        &mut ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "reuse-a",
            "media_title": "Movie A",
            "media_rating_key": "1",
            "media_type": "movie"
        }),
    )
    .await;
    let a = ws_recv(&mut ws).await;
    assert_eq!(a["type"], "session_created");
    assert_eq!(a["session_id"], "reuse-a");

    // Leave (alone => session destroyed). Drain any leave-side message.
    ws_send(&mut ws, &serde_json::json!({ "type": "leave_session" })).await;
    let _ = ws_try_recv(&mut ws, Duration::from_millis(200)).await;

    // Reuse the SAME connection for a fresh session.
    ws_send(
        &mut ws,
        &serde_json::json!({
            "type": "create_session",
            "session_id": "reuse-b",
            "media_title": "Movie B",
            "media_rating_key": "2",
            "media_type": "movie"
        }),
    )
    .await;
    let b = ws_recv(&mut ws).await;
    assert_eq!(b["type"], "session_created");
    assert_eq!(b["session_id"], "reuse-b");
}

/// The client ping/pong channel is reusable — repeated pings on one connection
/// each get exactly one pong.
#[tokio::test]
async fn test_client_ping_pong_channel_reused() {
    let addr = start_test_server().await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "ping_reuse_user").await;

    for _ in 0..3 {
        ws_send(&mut ws, &serde_json::json!({ "type": "ping" })).await;
        let resp = ws_recv(&mut ws).await;
        assert_eq!(resp["type"], "pong");
    }
}

// ── N.4 (prexu-p8hy): TMDb proxy reuses the shared reqwest::Client ─────────
//
// pd1x.11 (above) proved WebSocket connection reuse but never touched the
// HTTP side: `AppState::http` (state.rs) is a single shared `reqwest::Client`
// so that TMDb proxy requests reuse one pooled upstream connection instead of
// paying a fresh TCP+TLS handshake per call. This section proves that.

/// A fixed JSON body every stub response answers with. Content doesn't
/// matter — the proxy test only asserts success + connection count.
const STUB_BODY: &[u8] = br#"{"results":[]}"#;

/// Start a minimal HTTP/1.1 stub server: a bare `TcpListener` accept loop
/// that counts every ACCEPTED TCP connection in an `AtomicUsize` and speaks
/// just enough HTTP/1.1 keep-alive to answer each request on that connection
/// with a fixed JSON body. Returns the stub's address and a handle to the
/// connection counter.
async fn start_counting_stub() -> (SocketAddr, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to bind stub port");
    let addr = listener.local_addr().unwrap();
    let connections = Arc::new(AtomicUsize::new(0));
    let counter = connections.clone();

    tokio::spawn(async move {
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(pair) => pair,
                Err(_) => break,
            };
            counter.fetch_add(1, Ordering::SeqCst);
            tokio::spawn(serve_stub_connection(stream));
        }
    });

    (addr, connections)
}

/// Serve one keep-alive HTTP/1.1 connection: read and answer requests in a
/// loop with a fixed JSON body until the peer closes the socket.
async fn serve_stub_connection(mut stream: TcpStream) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];

    loop {
        buf.clear();
        loop {
            match stream.read(&mut chunk).await {
                Ok(0) => return, // peer closed the connection
                Ok(n) => {
                    buf.extend_from_slice(&chunk[..n]);
                    if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                Err(_) => return,
            }
        }

        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n",
            STUB_BODY.len()
        );
        if stream.write_all(response.as_bytes()).await.is_err() {
            return;
        }
        if stream.write_all(STUB_BODY).await.is_err() {
            return;
        }
    }
}

/// Start a test relay server whose TMDb proxy is pointed at `tmdb_base`
/// instead of the real TMDb API (`AppState::with_tmdb_api_base`).
async fn start_test_server_with_tmdb_base(tmdb_base: String) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to bind ephemeral port");
    let addr = listener.local_addr().unwrap();

    let state = Arc::new(prexu_relay::AppState::with_tmdb_api_base(tmdb_base));
    prexu_relay::spawn_cleanup_task(state.clone());
    let app = prexu_relay::build_router(state);

    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });

    addr
}

/// N sequential TMDb proxy requests through the relay reuse ONE upstream TCP
/// connection because every handler clones the same `AppState::http`
/// `reqwest::Client`, which owns one pooled connection per host. Guards
/// against a regression to a fresh `reqwest::Client::new()` per request.
#[tokio::test]
async fn test_tmdb_proxy_reuses_shared_http_client() {
    // Test-only credential for the local stub. Invalid-ID tests reject requests
    // before credentials are read; no test mutates this key to another value.
    std::env::set_var("TMDB_API_KEY", "test-key");

    let (stub_addr, connections) = start_counting_stub().await;
    let relay_addr = start_test_server_with_tmdb_base(format!("http://{}", stub_addr)).await;

    const N: usize = 5;
    for i in 0..N {
        let path = match i {
            0 => "/tmdb/find/tt1234567".to_string(),
            1 => "/tmdb/find/nm1234567".to_string(),
            _ => format!("/tmdb/search/movie?query=test{i}&page=1"),
        };
        let url = format!("http://{relay_addr}{path}");
        let resp = reqwest::get(&url).await.expect("proxy request failed");
        assert!(
            resp.status().is_success(),
            "request {} failed: {}",
            i,
            resp.status()
        );
        let _ = resp.text().await.unwrap();
    }

    assert_eq!(
        connections.load(Ordering::SeqCst),
        1,
        "expected exactly one upstream TCP connection reused across {} proxy requests",
        N
    );
}

// Security regression coverage: exercise the wire boundary, not only helpers.
async fn start_server_with_state(state: Arc<prexu_relay::AppState>) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = prexu_relay::build_router(state);
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}

async fn create_test_session(ws: &mut WsStream, id: &str) {
    ws_send(
        ws,
        &serde_json::json!({
            "type": "create_session", "session_id": id,
            "media_title": "Server-owned title", "media_rating_key": "123", "media_type": "movie"
        }),
    )
    .await;
    assert_eq!(ws_recv(ws).await["type"], "session_created");
}

#[tokio::test]
async fn test_invites_reject_nonmembers_and_missing_sessions() {
    let addr = start_test_server().await;
    let mut host = ws_connect(addr).await;
    authenticate(&mut host, "owner").await;
    create_test_session(&mut host, "private-session").await;
    let mut outsider = ws_connect(addr).await;
    authenticate(&mut outsider, "outsider").await;
    for session in ["private-session", "nonexistent"] {
        ws_send(
            &mut outsider,
            &serde_json::json!({
                "type": "invite", "session_id": session, "target_username": "owner",
                "sender_username": "owner", "relay_url": "wss://attacker.example/ws"
            }),
        )
        .await;
        let response = ws_recv(&mut outsider).await;
        assert_eq!(response["type"], "session_error");
        assert!(response["reason"].as_str().unwrap().contains("belong"));
    }
    assert!(ws_try_recv(&mut host, Duration::from_millis(100))
        .await
        .is_none());
}

#[tokio::test]
async fn test_invites_fail_closed_without_public_url() {
    let state = Arc::new(prexu_relay::AppState::new());
    let addr = start_server_with_state(state.clone()).await;
    let mut host = ws_connect(addr).await;
    authenticate(&mut host, "host").await;
    create_test_session(&mut host, "session").await;
    ws_send(
        &mut host,
        &serde_json::json!({
            "type": "invite", "session_id": "session", "target_username": "offline",
            "relay_url": "wss://attacker.example/ws"
        }),
    )
    .await;
    let response = ws_recv(&mut host).await;
    assert_eq!(response["type"], "session_error");
    assert!(response["reason"].as_str().unwrap().contains("public URL"));
    assert!(state.pending_invites.take("offline").is_none());
}

#[tokio::test]
async fn test_offline_invites_deduplicate_and_use_session_metadata() {
    let addr = start_test_server().await;
    let mut host = ws_connect(addr).await;
    authenticate(&mut host, "real-host").await;
    create_test_session(&mut host, "session").await;
    for _ in 0..3 {
        ws_send(
            &mut host,
            &serde_json::json!({
                "type": "invite", "session_id": "session", "target_username": "recipient",
                "media_title": "Forged title", "media_rating_key": "999", "media_type": "episode",
                "sender_username": "forged", "sender_thumb": "forged",
                "relay_url": "wss://attacker.example/ws"
            }),
        )
        .await;
    }
    // A ping response is an ordering barrier: all prior invites were processed.
    ws_send(&mut host, &serde_json::json!({"type": "ping"})).await;
    assert_eq!(ws_recv(&mut host).await["type"], "pong");
    let mut guest = ws_connect(addr).await;
    authenticate(&mut guest, "recipient").await;
    let response = ws_recv(&mut guest).await;
    let invites = response["invites"].as_array().unwrap();
    assert_eq!(invites.len(), 1);
    assert_eq!(invites[0]["media_title"], "Server-owned title");
    assert_eq!(invites[0]["media_rating_key"], "123");
    assert_eq!(invites[0]["media_type"], "movie");
    assert_eq!(invites[0]["sender_username"], "real-host");
    assert_eq!(invites[0]["relay_url"], "wss://trusted-relay.example/ws");
}

#[tokio::test]
async fn test_read_idle_timeout_releases_connection_and_session_despite_server_pongs() {
    let mut state = prexu_relay::AppState::with_keepalive_interval(Duration::from_millis(30));
    state.read_idle_timeout = Duration::from_millis(500);
    let state = Arc::new(state);
    let addr = start_server_with_state(state.clone()).await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "idle-host").await;
    create_test_session(&mut ws, "idle-session").await;
    // Client stays connected without reading/sending; the server's own traffic
    // must not count as inbound activity or keep this ghost session alive.
    timeout(Duration::from_secs(3), async {
        while state.connections.contains_key("idle-host") {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("idle connection was never cleaned up");
    assert!(!state.sessions.contains_key("idle-session"));
}

#[tokio::test]
async fn test_inbound_frames_refresh_read_idle_deadline() {
    let mut state = prexu_relay::AppState::new();
    state.read_idle_timeout = Duration::from_millis(500);
    let state = Arc::new(state);
    let addr = start_server_with_state(state.clone()).await;
    let mut ws = ws_connect(addr).await;
    authenticate(&mut ws, "active-user").await;
    for _ in 0..8 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        ws_send(&mut ws, &serde_json::json!({"type": "ping"})).await;
        assert_eq!(ws_recv(&mut ws).await["type"], "pong");
    }
    assert!(state.connections.contains_key("active-user"));
    timeout(Duration::from_secs(3), async {
        while state.connections.contains_key("active-user") {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("connection did not expire after inbound traffic stopped");
}

#[tokio::test]
async fn test_tmdb_rejects_path_and_query_injection_before_upstream_request() {
    let (stub_addr, connections) = start_counting_stub().await;
    let addr = start_test_server_with_tmdb_base(format!("http://{stub_addr}")).await;
    for id in [
        "..%2F..%2Faccount",
        "tt123%3Fextra%3D1",
        "tt123%26x%3D1",
        "tt123%23fragment",
        "tt",
        "nm",
        "12345",
        "ttabc",
        "tt%EF%BC%91",
        "tt123%252Faccount",
    ] {
        let response = reqwest::get(format!("http://{addr}/tmdb/find/{id}"))
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            reqwest::StatusCode::BAD_REQUEST,
            "id={id}"
        );
    }
    assert_eq!(connections.load(Ordering::SeqCst), 0);
}

#[test]
fn test_public_url_configuration_rejects_unsafe_or_unusable_endpoints() {
    for url in [
        "https://relay.example/ws",
        "file:///ws",
        "wss://user:secret@relay.example/ws",
        "wss://relay.example/ws?token=secret",
        "wss://relay.example/ws#fragment",
        "wss://relay.example/wrong",
    ] {
        assert!(
            prexu_relay::AppState::new().with_public_url(url).is_err(),
            "{url}"
        );
    }
    for url in [
        "ws://localhost:9847/ws",
        "wss://relay.example/ws",
        "ws://[::1]:9847/ws",
    ] {
        assert_eq!(
            prexu_relay::AppState::new()
                .with_public_url(url)
                .unwrap()
                .public_url
                .as_deref(),
            Some(url)
        );
    }
}
