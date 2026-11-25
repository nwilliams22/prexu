# Watch Together relay protocol

Messages are JSON with a snake-case `type` over authenticated `/ws` WebSockets.
Identity and `from_user` come from Plex authentication, never client-supplied
names. Time positions are seconds; timestamps are Unix milliseconds.

## Version and rollout

A host opts into the lobby/reconnect protocol with `protocol_version: 2` on
`create_session`. Omission selects version 1, preserving existing clients'
immediate control relay and disconnect removal. Versions other than 1 and 2
are rejected. Version 2 is a session-level contract: deploy the corresponding
client support to hosts and guests before enabling it. This relay change alone
does not enable the new UI or upgrade an existing session.

```json
{"type":"create_session","protocol_version":2,"session_id":"opaque-id","media_title":"Example","media_rating_key":"123","media_type":"movie"}
```

Existing `auth`, `invite`, `join_session`, `leave_session`, `ready`, `buffering`,
`play`, `pause`, `seek`, `new_media`, and `ping` shapes remain unchanged.
`session_created`, `session_joined`, `participant_joined`, `participant_left`,
`session_destroyed`, and the invite delivery messages remain available.

## Version 2 commands

| Client message | Meaning |
| --- | --- |
| `{"type":"start_now"}` | Host starts the lobby even if invitees are missing or participants are buffering. |
| `{"type":"remove_participant","plex_username":"guest"}` | Host removes an invited, connected, or reconnecting guest. Cannot remove self. |
| `{"type":"ready","current_time":0}` | Set the authenticated participant to `ready`; check auto-start. Does not seek the session. |
| `{"type":"buffering","current_time":0}` | Set participant to `joined-buffering`; does not pause anyone else. |
| `{"type":"join_session","session_id":"opaque-id"}` | Join normally or restore an unexpired disconnected slot after reauthentication. |

Only the host can issue invites in version 2. A successful invite adds an
`invited` slot, including for offline users, and clears a removal ban. Joining
consumes that slot. Existing invite delivery TTL is 10 minutes. Delivery expiry
does not silently change the lobby roster: the host can remove a missing invitee
or use StartNow. A copied link permits ordinary authenticated joins; removal
blocks that username until a fresh host invite, including with an old link or
an old pending invite. Invite-link creation is separate client work.

## Authoritative snapshot

`session_state` is broadcast to all connected participants, including the
initiator, after creation, joins/rejoins, invites, readiness, controls, removal,
new media, and disconnect/expiry transitions. The roster includes the recipient. Media fields allow reconnecting guests to
recover an item change that happened while offline.
Clients replace their session state from this snapshot rather than infer a
complete roster from `session_joined` (which retains its legacy shape).

```json
{
  "type":"session_state",
  "session_id":"opaque-id",
  "protocol_version":2,
  "media_title":"Example",
  "media_rating_key":"123",
  "media_type":"movie",
  "phase":"lobby",
  "participants":[
    {"plex_username":"host","plex_thumb":"","is_host":true,"state":"ready"},
    {"plex_username":"guest","plex_thumb":"","is_host":false,"state":"invited"}
  ],
  "host_away":false,
  "playing":false,
  "current_time":0.0,
  "timestamp":1795600000000
}
```

`phase` is `lobby` or `playback`. Participant state is `invited`,
`joined-buffering`, `ready`, or `reconnecting`; it is independent of `playing`.
Invited slots have an empty thumb until their authenticated user joins.
A host begins `joined-buffering`. Playback remains stopped until every slot
(including the host) is ready, or the host sends StartNow. Clients should send
invites before the host's Ready when those invitees must gate startup.

A transition out of the lobby broadcasts
`{"type":"session_started","current_time":0.0,"timestamp":1795600000000}`
once, followed by a snapshot. Removal or explicit guest leave also rechecks
readiness. Late joins receive the current extrapolated playback position and
buffer independently; their readiness does not restart the session.

## Playback and reconnect

Play/Pause/Seek from any connected participant during playback relay to the
other participants with authenticated `from_user`, `current_time`, and
`timestamp`. Clients can use `from_user` for attribution toasts. The initiator
also receives the resulting snapshot. Controls are ignored in the lobby and
while the host is away; positions must be finite and nonnegative. The relay
tracks the last accepted position and extrapolates elapsed monotonic time while
playing. Client drift correction remains host-led; this is not a media-clock
measurement or a replacement for the client drift algorithm.

A host socket disconnect freezes that clock and broadcasts Pause followed by
`host_away: true`, `playing: false`, and host state `reconnecting`. Reauthenticate
and send JoinSession within **60 seconds** to restore the same slot and frozen
position. The prior playing/paused state is restored (a previously paused
session stays paused); Play is broadcast when resuming. A lobby stays a lobby.
At expiry, `session_destroyed` is broadcast and remaining memberships cleared.
There is no host hand-off.

A guest disconnect retains its slot as `reconnecting` for **120 seconds**.
Other viewers keep playing. Reauthenticate and JoinSession within grace to
restore the slot as `joined-buffering` with a fresh snapshot at the current
position. Ready ends the local catch-up state. Expiry emits `participant_left`;
a later ordinary join is a new slot. Timers use monotonic deadlines; the cleanup
loop checks every second and JoinSession checks expiry synchronously.

Explicit LeaveSession never uses grace: host leave destroys the session;
guest leave removes the slot immediately. Replacing a still-connected socket
preserves its membership; stale socket commands and cleanup cannot change the
replacement's slot. A repeated JoinSession for a connected v2 member returns
a fresh snapshot.

Removal broadcasts `{"type":"participant_removed","plex_username":"guest"}`
to the room and the target and clears the target's active membership. It also
cancels any reconnect grace. The target must exit the session UI. Only a new
host invite permits rejoining.

Host-only NewMedia retains its existing event payload, resets position to zero,
pauses playback, and returns all connected members to `joined-buffering` in a
new lobby. Invited/reconnecting slots remain visible and gate auto-start. The
host also receives the reset snapshot even though the legacy NewMedia event is
only sent to guests.

## Verification

From `relay-server/`, run `cargo test` and `cargo clippy -- -D warnings`.
`tests/lifecycle.rs` advances a paused Tokio clock to exercise 60/120-second
boundaries without external services. `tests/integration.rs` exercises actual
WebSockets, authenticated sender attribution, reconnect and kick rejection,
plus the unchanged v1 behavior. These tests use synthetic identities under the
existing test-only auth bypass; they do not access any Plex library. Production
Plex/desktop journeys require the QA server and QA guest account and are not
established by these relay tests.
