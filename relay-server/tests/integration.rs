use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
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

    let state = Arc::new(prexu_relay::AppState::new());
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
        msg_type == "auth_error" || msg_type == "connection_closed" || msg_type == "connection_error",
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
    match resp {
        Some(val) => assert_ne!(val["type"], "auth_ok", "should not get auth_ok for non-auth message"),
        None => {} // Expected: no response yet (waiting for auth)
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
    ws_send(
        &mut ws,
        &serde_json::json!({ "type": "leave_session" }),
    )
    .await;

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
            "sender_username": "host_inv",
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
            "sender_username": "host_pend",
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

    // Send 35 messages rapidly (limit is 30 per second)
    for i in 0..35 {
        ws_send(
            &mut ws,
            &serde_json::json!({
                "type": "ping"
            }),
        )
        .await;
        // Tiny delay to avoid TCP-level backpressure, but fast enough to hit rate limit
        if i % 10 == 9 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    // We should eventually receive a rate-limit error or get disconnected.
    // Collect messages until we see auth_error with rate limit reason or the
    // connection closes.
    let mut found_rate_limit = false;
    for _ in 0..40 {
        match ws_try_recv(&mut ws, Duration::from_millis(500)).await {
            Some(msg) => {
                if msg["type"] == "auth_error"
                    && msg["reason"]
                        .as_str()
                        .unwrap_or("")
                        .contains("Rate limit")
                {
                    found_rate_limit = true;
                    break;
                }
            }
            None => break,
        }
    }

    assert!(
        found_rate_limit,
        "expected rate limit error after rapid-fire messages"
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
