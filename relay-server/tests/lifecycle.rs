//! Protocol-v2 state machine tests use synthetic identities and a paused clock.
//! No Plex account, media library, or external service is contacted.
use prexu_relay::{
    messages::ServerMessage,
    session::*,
    state::{AppState, ConnectionHandle, SharedState},
};
use serde_json::Value;
use std::{sync::Arc, time::Duration};
use tokio::sync::mpsc;

type Receiver = mpsc::Receiver<Arc<String>>;
fn connect(state: &SharedState, name: &str) -> Receiver {
    let (sender, rx) = mpsc::channel(256);
    state.connections.insert(
        name.into(),
        ConnectionHandle {
            plex_username: name.into(),
            plex_thumb: String::new(),
            session_id: None,
            sender,
        },
    );
    rx
}
fn sender(state: &SharedState, name: &str) -> mpsc::Sender<Arc<String>> {
    state.connections.get(name).unwrap().sender.clone()
}
fn setup() -> (SharedState, Receiver, Receiver) {
    let state = Arc::new(
        AppState::new()
            .with_public_url("wss://relay.example/ws")
            .unwrap(),
    );
    let host = connect(&state, "host");
    let guest = connect(&state, "guest");
    create_session(
        &state,
        "room".into(),
        2,
        "host",
        "",
        "Fixture".into(),
        "1".into(),
        "movie".into(),
        sender(&state, "host"),
    );
    (state, host, guest)
}
fn join(state: &SharedState, name: &str) {
    join_session(state, "room", name, "", sender(state, name));
}
fn ready(state: &SharedState, name: &str) {
    relay_playback_event(
        state,
        name,
        &ServerMessage::Ready {
            current_time: 0.0,
            from_user: name.into(),
        },
    );
}
fn disconnect(state: &SharedState, name: &str) {
    let (_, handle) = state.connections.remove(name).unwrap();
    leave_session_for_disconnect(state, name, &handle);
}
fn drain(rx: &mut Receiver) -> Vec<Value> {
    std::iter::from_fn(|| rx.try_recv().ok())
        .map(|s| serde_json::from_str(&s).unwrap())
        .collect()
}
fn latest_state(rx: &mut Receiver) -> Value {
    drain(rx)
        .into_iter()
        .rev()
        .find(|v| v["type"] == "session_state")
        .unwrap()
}

#[tokio::test(start_paused = true)]
async fn lobby_waits_for_every_invitee_and_starts_once() {
    let (s, mut host, _) = setup();
    handle_invite(&s, "guest", "room", "host", "");
    ready(&s, "host");
    let snapshot = latest_state(&mut host);
    assert_eq!(snapshot["phase"], "lobby");
    assert_eq!(snapshot["participants"][0]["state"], "invited");
    join(&s, "guest");
    assert_eq!(
        latest_state(&mut host)["participants"][0]["state"],
        "joined-buffering"
    );
    ready(&s, "guest");
    let messages = drain(&mut host);
    assert_eq!(
        messages
            .iter()
            .filter(|v| v["type"] == "session_started")
            .count(),
        1
    );
    assert_eq!(messages.last().unwrap()["phase"], "playback");
    ready(&s, "guest");
    assert!(!drain(&mut host)
        .iter()
        .any(|v| v["type"] == "session_started"));
}

#[tokio::test(start_paused = true)]
async fn only_host_can_start_now_with_missing_invitees() {
    let (s, mut host, mut guest) = setup();
    handle_invite(&s, "missing", "room", "host", "");
    join(&s, "guest");
    start_now(&s, "guest");
    assert_eq!(drain(&mut guest).last().unwrap()["type"], "session_error");
    assert!(!s.sessions.get("room").unwrap().started);
    start_now(&s, "host");
    assert_eq!(latest_state(&mut host)["phase"], "playback");
}

#[tokio::test(start_paused = true)]
async fn kick_blocks_rejoin_until_host_reinvites() {
    let (s, mut host, mut guest) = setup();
    join(&s, "guest");
    remove_participant(&s, "guest", "host");
    assert!(s
        .sessions
        .get("room")
        .unwrap()
        .participants
        .contains_key("host"));
    remove_participant(&s, "host", "guest");
    assert!(drain(&mut guest)
        .iter()
        .any(|v| v["type"] == "participant_removed"));
    join(&s, "guest");
    assert_eq!(drain(&mut guest).last().unwrap()["type"], "session_error");
    assert!(s.connections.get("guest").unwrap().session_id.is_none());
    handle_invite(&s, "guest", "room", "host", "");
    join(&s, "guest");
    assert_eq!(
        latest_state(&mut host)["participants"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test(start_paused = true)]
async fn host_drop_pauses_and_rejoin_resumes_frozen_clock() {
    let (s, _, mut guest) = setup();
    join(&s, "guest");
    start_now(&s, "host");
    tokio::time::advance(Duration::from_secs(10)).await;
    disconnect(&s, "host");
    let messages = drain(&mut guest);
    assert!(messages
        .iter()
        .any(|v| v["type"] == "pause" && v["current_time"] == 10.0));
    let snapshot = messages.last().unwrap();
    assert_eq!(snapshot["host_away"], true);
    assert_eq!(snapshot["playing"], false);
    relay_playback_event(
        &s,
        "guest",
        &ServerMessage::Play {
            current_time: 90.0,
            timestamp: 0,
            from_user: "guest".into(),
        },
    );
    tokio::time::advance(Duration::from_secs(59)).await;
    let mut host = connect(&s, "host");
    join(&s, "host");
    let snapshot = latest_state(&mut host);
    assert_eq!(snapshot["host_away"], false);
    assert_eq!(snapshot["playing"], true);
    assert_eq!(snapshot["current_time"], 10.0);
    tokio::time::advance(Duration::from_secs(2)).await;
    cleanup_disconnected(&s);
    assert!(s.sessions.contains_key("room"));
}

#[tokio::test(start_paused = true)]
async fn host_timeout_destroys_and_clears_guest_membership() {
    let (s, _, mut guest) = setup();
    join(&s, "guest");
    disconnect(&s, "host");
    tokio::time::advance(Duration::from_secs(60)).await;
    cleanup_disconnected(&s);
    assert!(!s.sessions.contains_key("room"));
    assert!(s.connections.get("guest").unwrap().session_id.is_none());
    assert!(drain(&mut guest)
        .iter()
        .any(|v| v["type"] == "session_destroyed"));
    let mut host = connect(&s, "host");
    join(&s, "host");
    assert_eq!(drain(&mut host).last().unwrap()["type"], "session_error");
}

#[tokio::test(start_paused = true)]
async fn guest_reconnect_restores_slot_at_current_clock_without_pausing() {
    let (s, mut host, _) = setup();
    join(&s, "guest");
    start_now(&s, "host");
    disconnect(&s, "guest");
    let snapshot = latest_state(&mut host);
    assert_eq!(snapshot["playing"], true);
    assert_eq!(snapshot["participants"][0]["state"], "reconnecting");
    tokio::time::advance(Duration::from_secs(119)).await;
    let mut guest = connect(&s, "guest");
    join(&s, "guest");
    let snapshot = latest_state(&mut guest);
    assert_eq!(snapshot["current_time"], 119.0);
    assert_eq!(snapshot["participants"].as_array().unwrap().len(), 2);
    tokio::time::advance(Duration::from_secs(2)).await;
    cleanup_disconnected(&s);
    assert!(s
        .sessions
        .get("room")
        .unwrap()
        .participants
        .contains_key("guest"));
}

#[tokio::test(start_paused = true)]
async fn guest_timeout_emits_left_but_keeps_playback() {
    let (s, mut host, _) = setup();
    join(&s, "guest");
    start_now(&s, "host");
    disconnect(&s, "guest");
    tokio::time::advance(Duration::from_secs(120)).await;
    cleanup_disconnected(&s);
    assert!(drain(&mut host)
        .iter()
        .any(|v| v["type"] == "participant_left" && v["plex_username"] == "guest"));
    let session = s.sessions.get("room").unwrap();
    assert!(session.playing);
    assert!(!session.participants.contains_key("guest"));
}

#[tokio::test(start_paused = true)]
async fn late_buffering_does_not_pause_and_new_media_resets_lobby() {
    let (s, mut host, _) = setup();
    start_now(&s, "host");
    tokio::time::advance(Duration::from_secs(23)).await;
    join(&s, "guest");
    relay_playback_event(
        &s,
        "guest",
        &ServerMessage::Buffering {
            from_user: "guest".into(),
        },
    );
    let snapshot = latest_state(&mut host);
    assert_eq!(snapshot["playing"], true);
    assert_eq!(snapshot["current_time"], 23.0);
    handle_new_media(&s, "guest", "2", "Next", "episode");
    assert_eq!(s.sessions.get("room").unwrap().media_rating_key, "1");
    handle_new_media(&s, "host", "2", "Next", "episode");
    let snapshot = latest_state(&mut host);
    assert_eq!(snapshot["phase"], "lobby");
    assert_eq!(snapshot["playing"], false);
    assert_eq!(snapshot["current_time"], 0.0);
    ready(&s, "host");
    ready(&s, "guest");
    assert_eq!(latest_state(&mut host)["phase"], "playback");
}

#[tokio::test(start_paused = true)]
async fn paused_host_reconnect_does_not_force_play() {
    let (s, _, _) = setup();
    start_now(&s, "host");
    relay_playback_event(
        &s,
        "host",
        &ServerMessage::Pause {
            current_time: 5.0,
            timestamp: 0,
            from_user: "host".into(),
        },
    );
    disconnect(&s, "host");
    let mut host = connect(&s, "host");
    join(&s, "host");
    assert_eq!(latest_state(&mut host)["playing"], false);
}

#[tokio::test(start_paused = true)]
async fn removing_missing_invitee_rechecks_readiness_and_requires_new_invite() {
    let (s, mut host, _) = setup();
    handle_invite(&s, "missing", "room", "host", "");
    ready(&s, "host");
    assert_eq!(latest_state(&mut host)["phase"], "lobby");
    remove_participant(&s, "host", "missing");
    assert_eq!(latest_state(&mut host)["phase"], "playback");
    let mut missing = connect(&s, "missing");
    join(&s, "missing");
    assert_eq!(drain(&mut missing).last().unwrap()["type"], "session_error");
}

#[tokio::test(start_paused = true)]
async fn rejoin_checks_deadline_without_waiting_for_cleanup_tick() {
    let (s, _, mut guest) = setup();
    join(&s, "guest");
    disconnect(&s, "host");
    tokio::time::advance(Duration::from_secs(60)).await;
    let mut host = connect(&s, "host");
    join(&s, "host");
    assert!(!s.sessions.contains_key("room"));
    assert_eq!(drain(&mut host).last().unwrap()["type"], "session_error");
    assert!(drain(&mut guest)
        .iter()
        .any(|v| v["type"] == "session_destroyed"));
}

#[tokio::test(start_paused = true)]
async fn reconnect_snapshot_recovers_media_change_and_lobby() {
    let (s, _, _) = setup();
    join(&s, "guest");
    start_now(&s, "host");
    disconnect(&s, "guest");
    handle_new_media(&s, "host", "2", "Next", "episode");
    ready(&s, "host");
    let mut guest = connect(&s, "guest");
    join(&s, "guest");
    let snapshot = latest_state(&mut guest);
    assert_eq!(snapshot["media_rating_key"], "2");
    assert_eq!(snapshot["media_title"], "Next");
    assert_eq!(snapshot["phase"], "lobby");
    ready(&s, "guest");
    assert_eq!(latest_state(&mut guest)["phase"], "playback");
}

#[tokio::test(start_paused = true)]
async fn explicit_leave_is_immediate_and_old_disconnect_does_not_remove_rejoin() {
    let (s, _, mut guest) = setup();
    join(&s, "guest");
    let (_, old) = s.connections.remove("guest").unwrap();
    leave_session_for_disconnect(&s, "guest", &old);
    let mut replacement = connect(&s, "guest");
    join(&s, "guest");
    leave_session_for_disconnect(&s, "guest", &old);
    assert!(s.sessions.get("room").unwrap().disconnected.is_empty());
    leave_session(&s, "host");
    assert!(!s.sessions.contains_key("room"));
    assert!(drain(&mut replacement)
        .iter()
        .any(|v| v["type"] == "session_destroyed"));
    assert!(!drain(&mut guest)
        .iter()
        .any(|v| v["type"] == "session_destroyed"));
}
