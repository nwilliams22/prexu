# Isolated real-service journeys

Run the full required gate from the repository root with project dependencies,
Playwright Chromium, a debug Linux native binary, Xvfb, dbus-run-session,
python3 and fusermount3 installed:

```sh
cargo build --manifest-path relay-server/Cargo.toml --locked --no-default-features --bin prexu-relay
PREXU_JOURNEY_PROGRESS=1 PREXU_JOURNEY_REPORT=/tmp/prexu-full-journeys.json \
  node scripts/real-journeys/full.mjs
node --test scripts/real-journeys/*.test.mjs
```

Supply `PREXU_QA_PLEX_AUTH` and `PREXU_QA_PLEX_GUEST_AUTH` through protected
environment variables, never arguments or checked-in files. Both identities must
be distinct and expose only **Prexu QA Test Server**, with rating key `2` named
**Prexu QA Pattern**. The installed fixture is 119040 ms. The service must be
idle; these checks do not provide a cross-machine lease. Do not run another QA
client at the same time.

`PREXU_JOURNEY_APP` selects the debug native executable, and
`PREXU_JOURNEY_RELAY` selects the production relay executable. Defaults are
`src-tauri/target/debug/prexu` and `relay-server/target/debug/prexu-relay`.
The native report records the binary SHA-256, but does not independently prove
its source revision. Build the intended revision before acceptance. The relay
rejects an invalid credential as a negative control: a test-mode relay must fail.

`full.mjs` runs browser, native and relay slices sequentially, then requires
exactly one PASS for every row in `full-contract.mjs`. Missing rows, duplicates,
FAIL, SKIP, NOT_RUN and UNSUPPORTED fail the full gate. Cross-slice placeholders
are ignored only when their required concrete rows are supplied by the other
slice. There are no implicit unsupported waivers. The JSON contains the full
slice reports as well as the required-row verdict. Attach it to the task;
`/tmp` paths alone are not durable evidence.

## Coverage and boundaries

- `run.mjs`: real Plex-backed browser session restore, browse/search/detail
  identity against service metadata, and settings persistence after reload.
  Browser auth is seeded in an ephemeral profile; it does not establish PIN login.
- `native.mjs`: the real Sign in button creates a Plex PIN and invokes the
  native shell opener. A private URL handler links only that PIN with the
  authorized credential. It does not test the external web sign-in page or
  manual password entry. Native polling, server selection and Tauri storage are
  unchanged. It checks reload/session restore, progress/pause, early-stop watched
  preservation, playback beyond 65 seconds, service resume within two seconds,
  Resume-button progress within six seconds, and completion clearing the marker.
  The fixture must be watched; an existing resume marker is preserved as the
  initial baseline and restored at cleanup.
- Native queue checks restore a persisted queue containing the synthetic fixture
  twice, seek to EOF, click Play Now and verify index advancement and restarted
  time. This covers repeated-item queue handoff, not distinct-item identity,
  playlist creation or episode chaining.
- Native download checks wait for completion and a real local file, replace the
  isolated server address with an unreachable loopback address, restart the app,
  and verify local playback. Deleting the downloaded file must produce the
  explicit missing-file error. Download success alone is not offline acceptance.
- `relay.mjs`: an isolated browser host and a real PIN-authenticated Tauri guest use
  the two identities and a fresh loopback production relay. Plain browser
  playback invokes native APIs, so the guest uses the supported native path. Session creation and invite dispatch use
  the production app service; the guest's visible invite, Join Session and Stop
  controls exercise UI reception, joining and leaving. Relay events and health
  counts provide bounded independent comparisons. Explicit service disconnect,
  reload/reconnect, relay process failure and restart are checked against both
  app connection state and visible Settings connection status. Relay restart
  destroys the old session; the check proves authenticated reconnection, not
  automatic restoration of a destroyed session. Guest watch state is restored
  and checked after playback stops.

No Plex routes, player hooks or relay authentication are mocked. Native events
establish control/progress, not audible output, GPU correctness or composed-screen
acceptance. The headless tests do not replace hardware acceptance.

## Isolation and cleanup

Each slice owns its Vite instance and never attaches to another listener. The
native slice requires port 1420 free and asks Xvfb to allocate a free display.
Fresh HOME/XDG directories and private D-Bus isolate stores, downloads and logs.
The driver is injected only by this launcher, never by normal dev/build commands.
The relay uses an ephemeral relay port, port 1420 for its private Vite
instance, an isolated native guest profile/display and an ephemeral Chromium
host profile. Its nonce-scoped driver executes only run-supplied observations
and UI actions; no product player or auth hooks are replaced. Credentials and account responses remain in memory; child relay
processes receive an allowlisted environment without the credentials.

Raw app output, browser logs, traces, video, screenshots and storage snapshots
are not exported. Reports contain fixed labels, numeric comparisons, boolean
error categories and binary digests, never account names, URLs, tokens or raw
exceptions. Requests have bounded timeouts and refuse redirects.

Finally blocks close owned processes and servers, restore/check fixture state,
unmount the private document portal and delete profiles/caches. Restoration or
cleanup failures fail acceptance. Contention prevents restoration rather than
overwriting another client's state. Plex authorized-device history is not erased
by deleting a local profile.

For diagnosis, invoke a slice directly with `PREXU_JOURNEY_REPORT`. Native
`PREXU_JOURNEY_OFFLINE_ONLY=1` and `PREXU_JOURNEY_QUEUE_ONLY=1` narrow coverage;
the full launcher removes these flags. The native deadline is eight minutes.
Missing browser credentials fail unless `--allow-missing-service` explicitly
permits a SKIP; this option is never passed by the full gate. A passing diagnostic
slice is not full acceptance.

## Desktop download queue

Build the debug app from the commit being checked, then run:

```sh
PREXU_JOURNEY_DOWNLOAD_QUEUE=1 PREXU_JOURNEY_PROGRESS=1 \
  PREXU_JOURNEY_SCREENSHOTS=/tmp/prexu-queue-shots \
  PREXU_JOURNEY_REPORT=/tmp/prexu-queue.json \
  node scripts/real-journeys/native.mjs
```

This mode uses the same isolated native profile and PIN sign-in, then downloads
**Prexu QA Lossless Surround** (13) and **Prexu QA Surround** (3). These
existing synthetic Movies fixtures exceed 50 MB so navigation does not outlast
the transfer; the smaller season episodes can finish before Pause appears. It clicks the
real detail and Downloads controls, pauses both, moves the second item up,
resumes, checks both completion metadata and native file presence, then deletes
both through the UI and checks native file absence. It also
changes the Settings concurrency selector from 1 to 3 and back. The second fixture is selected through real in-app search, preserving the live
queue context. This mode does not claim process-restart acceptance.
Controls must be visible and unobscured before the driver clicks them. This mode
requires `xdotool` and sizes the real app to 1900×1000 on a 1920×1080 display.
Screenshots of the paused/reordered queue and completed files are required.
The profile and downloads are removed during cleanup; attach the JSON and PNGs
to the task. No personal library or seeded download records are used.


For the native paused-load backend contract, use
`PREXU_JOURNEY_PAUSED_LOAD=1 node scripts/real-journeys/native.mjs` with a newly
built debug app. This signs in through the real app, resolves the QA Pattern
source through production code, and exercises native IPC: decoder readiness
while paused, three seconds without time advance, explicit start, and a warm
solo load that autoplays. It does not exercise the Watch Together lobby or
establish audible silence on a physical output device. The lobby acceptance
must mount `usePlayer(key, offset, { initiallyPaused: true })`, report readiness
from `isPrepared`, and explicitly start only on relay `phase=playback`.

## Watch Together lobby

`node scripts/real-journeys/lobby.mjs` runs two isolated native app clients with
real QA PIN sign-in and the production relay. Build the current desktop commit
first and set `PREXU_JOURNEY_APP` to that binary. Supply both protected QA
credentials above. Port 1420 must be free. Set `PREXU_JOURNEY_SCREENSHOTS` to an
external evidence directory and `PREXU_JOURNEY_REPORT` to a JSON output path.
Build the relay with an isolated `CARGO_TARGET_DIR` and `--no-default-features`;
never reuse the shared test-mode executable. The journey requires invalid-token
rejection before either real QA client starts.
The journey exercises the actual creator, resend, guest join, all-ready start,
participant removal and Start now with a no-show. It records stopped preparation
for three seconds, advancing playback on both clients, and restores each QA
account's fixture progress. It does not establish macOS acceptance or replace
Downloads coverage. Missing prerequisites or interrupted checks are NOT_VERIFIED.

## Downloads storage warning

Build the debug app from the commit under test, then run:

```sh
PREXU_JOURNEY_DOWNLOAD_STORAGE=1 PREXU_JOURNEY_SCREENSHOTS=/tmp/prexu-storage-shots \
  PREXU_JOURNEY_REPORT=/tmp/prexu-storage-report.json node scripts/real-journeys/native.mjs
```

This uses the real PIN sign-in and QA Seasons season page, checks the Downloads
storage summary, requests the whole season, captures the insufficient-space
warning, and cancels it. It verifies that cancellation leaves the queue empty.
The launcher sets `PREXU_QA_DOWNLOAD_FREE_BYTES=1` only in its isolated app
process; the override exists only in debug builds. Actual directory usage still
comes from the filesystem. Screenshots and the report must be attached to the
tracking issue. The launcher stops its processes and removes its profile on exit.

For Watch Together drift and connection grace acceptance, run the two-native-client
lobby journey with `PREXU_JOURNEY_WATCH_CONNECTIONS=1`. It adds local guest drift
(three corrections), host socket loss/return, guest reconnect/rejoin, and host
absence beyond 60 seconds. Socket closure and a delayed first retry induce the
outage; authentication and session restoration use the real service. Set
`PREXU_JOURNEY_SCREENSHOTS` and `PREXU_JOURNEY_REPORT` to capture evidence. Use a
fresh desktop build and the isolated production relay described above. The run
restores both QA accounts' fixture progress and stops both desktops and servers.

## Download folder migration

Build the Linux desktop binary from the revision under test. Use a libmpv runtime
with the scaler LUT fix described in `docs/linux-dev.md`; if the host library is
unpatched, set `LD_LIBRARY_PATH` to the verified private runtime. Then run:

```sh
PREXU_JOURNEY_DOWNLOAD_MOVE=1 PREXU_JOURNEY_PROGRESS=1 \
  PREXU_JOURNEY_SCREENSHOTS=/tmp/prexu-download-move \
  PREXU_JOURNEY_REPORT=/tmp/prexu-download-move.json \
  node scripts/real-journeys/native.mjs
```

This uses the QA movie fixtures, the native folder picker, Settings confirmation,
local playback and screenshots in an isolated profile. The open-folder row checks
the path dispatched to the desktop handler; it does not inspect a file manager.
The runner cleans up its profile, moved files and child processes. Attach reports
and screenshots to the task before temporary evidence expires. macOS acceptance
requires a separate real-app run in the Mac VM.

For copyable links and pending invites, set `PREXU_JOURNEY_WATCH_INVITES=1` on
`lobby.mjs`. This closes the guest popup with Later, joins from the pending list,
then creates another session, copies its link through the host UI, reads the real
X11 clipboard, and pastes it into the guest's Pending invites form. Capture and
attach the screenshots and report. This covers pasted-link joining in the Linux
app; OS scheme delivery and macOS installation still need separate verification.
