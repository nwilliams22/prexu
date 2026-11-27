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
Season 1 episodes 1 and 2 from **Prexu QA Seasons** (show 17). It pauses
both using the real Downloads controls, reorders the second item first, restarts
the native process, and checks persisted order, paused state and partial bytes.
It resumes, verifies completion and native file presence, checks show/season
grouping, and deletes both files through the UI. The concurrency selector is
checked at its default 1, set to 2 for transfers, then changed to 3 and back to 1.
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

Set `PREXU_JOURNEY_WATCH_COLD_LINK=1` instead to create a lobby while the guest
is offline, copy its link, and launch a fresh guest app with that native URI
argument. The guest must complete real Plex PIN sign-in and server selection,
then join automatically. This exercises Linux native cold-start URI delivery;
macOS still requires opening the URI with the installed application in its VM.

## Mac VM host with a Linux native guest

This procedure uses the **Mac as host**, the protected `PREXU_QA_PLEX_AUTH`
account, and a Linux guest signed in with `PREXU_QA_PLEX_GUEST_AUTH`. Both accounts
must expose only **Prexu QA Test Server**. Only fixture `16`, **Prexu QA MP4 H264 AC3**,
is used. Reserve the VM and both accounts with the current verifier first.
An occupied local port or active QA session is a contention result, not a product
failure. Do not stop someone else's process. Read `/usr/local/share/mac-test/AGENTS.md`.

### Build and topology

```sh
sudo mac-test status
ssh -n -o BatchMode=yes mac-host mac-vm status
ssh -n -o BatchMode=yes mac-host mac-vm start
```

If the Mac is away, hold the run. Keep VM sound muted throughout. Use a clean VM;
never reset one held by another ticket. The acceptance baseline is commit
`51d528e47ebbab5190c36bf6529a8efa3d1f29a0`. Record the actual binary revision,
not merely the harness revision. `macos-candidate.yml` accepts a branch ref:
verify `main` points at the intended SHA before dispatch, and check the run's
`headSha` and artifact `BUILD.txt`. A queued workflow is not a built app.

Alternatively build that exact revision in the VM (the default native feature
requires libmpv even though this test uses the macOS HTML5 engine):

```sh
git archive --format=tar 51d528e47ebbab5190c36bf6529a8efa3d1f29a0 -o /tmp/mac-source.tar
scp -o BatchMode=yes /tmp/mac-source.tar mac-vm:/tmp/mac-source.tar
ssh -n mac-vm 'mkdir -p /tmp/prexu-acceptance && cd /tmp/prexu-acceptance && tar xf /tmp/mac-source.tar'
ssh -n mac-vm 'HOMEBREW_NO_AUTO_UPDATE=1 brew install mpv pkg-config'
ssh -n mac-vm 'cd /tmp/prexu-acceptance && npm ci && npm run tauri -- build --ci --bundles app --config '\''{"bundle":{"createUpdaterArtifacts":false,"macOS":{"signingIdentity":"-"}}}'\'''
ssh -n mac-vm 'cp -Rf /tmp/prexu-acceptance/src-tauri/target/release/bundle/macos/Prexu.app /Applications/ && open -a /Applications/Prexu.app'
ssh -n mac-vm 'shasum -a 256 /Applications/Prexu.app/Contents/MacOS/prexu'
```

In an isolated checkout of the recorded revision on bd-server, run `npm ci`
and build the Linux debug app with
`cargo build --manifest-path src-tauri/Cargo.toml --target-dir /tmp/mac-lobby-app`.
Use `/tmp/mac-lobby-app/debug/prexu` below. Build a dedicated production relay. Never substitute the shared
relay target, which may have `test-mode` enabled by another job:

```sh
cargo build --manifest-path relay-server/Cargo.toml --target-dir /tmp/mac-lobby-relay --no-default-features
ss -ltnp | grep -E ':1420|:18787'
PREXU_JOURNEY_APP=/absolute/path/to/debug/prexu \
PREXU_JOURNEY_RELAY=/tmp/mac-lobby-relay/debug/prexu-relay \
PREXU_MAC_APP_REVISION=51d528e47ebbab5190c36bf6529a8efa3d1f29a0 \
PREXU_MAC_EVIDENCE=/tmp/mac-lobby-evidence \
node scripts/real-journeys/mac-lobby.mjs
```

Use a Linux debug binary from the recorded source; the helper also records its
SHA-256. The Linux frontend comes from the harness checkout. The helper refuses
occupied ports, snapshots both accounts' watched flag and resume offset,
verifies that the relay rejects an invalid token, and opens a reverse SSH tunnel:
`ssh -N -R 127.0.0.1:18787:127.0.0.1:18787 mac-vm`. Thus **both clients use
`ws://127.0.0.1:18787/ws`**, with the VM loopback forwarded to bd-server's dedicated
production relay. Nothing listens publicly; no real token is sent to the relay
until its invalid-token check passes. Leave the helper running in its terminal.

### Sign in, create, prepare and start

Use a second terminal for Mac accessibility commands. Do not print or save
Safari's authentication URL, PIN, app stores, raw accessibility dumps containing
account details, or raw app logs. The helper's `pin` command reads the normal
Safari handoff in memory, checks the Plex auth origin, and links that PIN with the
protected host credential. It does not seed the app's auth store.

```sh
ssh -n mac-vm 'axui wait Prexu "Sign in with Plex" 30'
ssh -n mac-vm 'axui click Prexu "Sign in with Plex"'
```

Enter `pin` at the helper prompt when Safari has opened the Plex authentication
page. Return to Prexu, select the QA server if prompted, and confirm no other
server is selected. Enter `guest` at the helper prompt to launch/sign in the
isolated Linux counterpart. **Wait for `guest: PASS` before creating the lobby**.
The guest waits on the fixture detail page. If an invitation was sent before
that navigation completed, click `Resend invite to` on the Mac before `join`.

Use `axui dump Prexu 25` locally to identify controls where needed; do not attach
that raw dump. Matching is case-insensitive substring; use `--nth N` only after
checking the tree. Open the account menu (the `AXPopUpButton` labelled with the QA host username),
then Settings → Connections. Set `QA_HOST_LABEL` to that non-secret displayed
label; no account token belongs in this variable. Do not open the sidebar menu.
Configure the Mac through these commands:

```sh
ssh -n mac-vm 'open -a Prexu'
ssh -n mac-vm "axui click Prexu '$QA_HOST_LABEL'"
ssh -n mac-vm 'axui click Prexu "Settings"'
ssh -n mac-vm 'axui click Prexu "Connections"'
ssh -n mac-vm 'axui click Prexu "Use custom relay URL"'
ssh -n mac-vm 'axui type Prexu "Custom relay URL" "ws://127.0.0.1:18787/ws"'
ssh -n mac-vm 'axui click Prexu "Save"'
ssh -n mac-vm 'axui wait Prexu "Connected to relay" 30'
```

The MKV Pattern fixture requires a different playback path on macOS; use this
MP4 codec fixture for the lobby acceptance. Navigate to **Prexu QA MP4 H264 AC3**, rating key `16`, using app search. Open its detail
page, click **Watch Together**, select only the QA guest in the friend chooser,
and click **Start Session**. Set `QA_GUEST_LABEL` to its displayed checkbox label
from the live accessibility tree. The exact search/creator sequence is:

```sh
ssh -n mac-vm 'axui type Prexu "Search movies, shows, episodes" "Prexu QA MP4 H264 AC3"'
ssh -n mac-vm 'axui click Prexu "Prexu QA MP4 H264 AC3 Movie"'
ssh -n mac-vm 'axui wait Prexu "Watch Together" 30'
ssh -n mac-vm 'axui click Prexu "Watch Together"'
ssh -n mac-vm "axui click Prexu '$QA_GUEST_LABEL'"
ssh -n mac-vm 'axui click Prexu "Start Session"'
ssh -n mac-vm 'axui wait Prexu "Playback starts when everyone is ready." 30'
```

There is **no manual Ready button**. Decoder preparation reports Ready through
the production player hook. The Mac host must remain in the lobby, with its own
state Ready and the guest Invited, until the guest joins. Wait three seconds and
confirm the host still shows the lobby, not moving video. Enter `lobby` in the
helper: it checks those accessibility labels and saves `mac-lobby.png`.

Enter `join` in the helper to click **Join Session** through the Linux guest's
real native UI. When the guest finishes preparation, the production relay must
automatically transition both clients to playback. **Do not click Start now**
for this all-ready check. On the Mac, observe that the lobby disappears and the
synthetic pattern moves. Move the pointer over the player with `cliclick` to
reveal controls if needed. The `join` command immediately captures two Mac
frames three seconds apart because the fixture is only about 13 seconds long.
Record the two burned-in fixture clock readings and whether the pattern changed. The helper checks Linux time advance but deliberately leaves Mac visual
acceptance as `REQUIRES_REVIEW`: a Linux pass does not prove Mac playback.

### Evidence and restoration

Attach `mac-lobby.png`, `mac-playback.png`, `mac-playback-later.png`, `report.json`,
and a text observation containing Mac clock readings, visible motion, app SHA,
source revision, harness commit and engine (HTML5). Review screenshots for
credentials/server addresses before uploading. QA account labels in the roster
are expected; never attach personal library information.

The helper writes `mac-log-excerpt.txt` with allowlisted, normalized relay and
codec-decision messages (no URLs or raw JSON objects). For additional diagnostics,
extract only relevant playback/relay lines from
`~/Library/Logs/com.prexu.client/`. Keep the timestamp and module tag, but replace
all URLs and token values before attachment. Prefer an allowlist of fixed
messages (`Connected to relay`, `canDirectPlay` boolean, preparation/playback
transitions) over publishing complete log objects. VM audio stays muted; do not
claim audible output from this procedure.

Enter `finish` in the helper. It quits the Mac app, kills its isolated Linux
process groups, restores both accounts' prior watched flag and resume offset,
reads the values back into `report.json`, closes its SSH tunnel, stops its relay
and Vite, and deletes its Vite cache. A restoration row other than PASS blocks
acceptance. If interrupted or crashed, stop only run-owned clients first; use
`before.json` and the protected credentials to restore fixture `16`, then read
metadata back and record the actual before/after comparison. Never restore over
another client's active session. Do not discard `before.json` before comparison.

After evidence has been copied and attached, always reset the VM:

```sh
ssh -n mac-host mac-vm reset
ssh -n mac-host mac-vm status
ss -ltnp | grep -E ':1420|:18787'
```

Record reset and process cleanup results in the report. The final closure
requires reviewed Mac visual evidence, both restoration comparisons equal,
no run-owned processes left, the pushed harness commit with successful CI, and
its app revision. A draft procedure or `REQUIRES_REVIEW` report is not acceptance.

## Downloads queue acceptance

```sh
PREXU_JOURNEY_APP=<debug-app-built-from-the-tested-commit> \
PREXU_JOURNEY_DOWNLOAD_QUEUE=1 PREXU_JOURNEY_PROGRESS=1 \
PREXU_JOURNEY_REPORT=/tmp/download-queue.json \
PREXU_JOURNEY_SCREENSHOTS=/tmp/download-queue-shots \
node scripts/real-journeys/native.mjs
```

This uses Season 1 episodes 1 and 2 of **Prexu QA Seasons** (show key `17`).
It pauses each queued transfer, visits the second episode through the season's
real detail controls, reorders it first, sets concurrency to 2, and clicks its
Resume button followed by Resume all. Separate report rows identify those two
clicks. Completion requires both stored byte counts to equal their positive
file sizes and both native local paths to exist. The driver then deletes both
entries/files and restores concurrency to 1. Cleanup verifies the episodes'
watch flags and offsets are unchanged and removes the isolated profile/processes.

Do not use a pending global search to navigate between these episodes: episode
titles are not global search results, and the search debounce can navigate away
from Downloads after pause/reorder. Earlier reports grouped waiting for Resume
controls with transfer completion, so that timeout alone did not prove Resume
was clicked. Screenshots and reports must be read together. Record the tested
source revision separately; the runner's binary hash does not establish it.

## Shared playback controls

Set `PREXU_JOURNEY_SHARED_CONTROL=1` when running `lobby.mjs` to add real
native guest pause, seek and resume checks with host-side attributed toasts.
The journey also checks unavailable guest item controls and joins an already
playing host after 12 seconds, requiring matching positions, a catch-up label,
and no host pause during joining. It uses the same QA-only login, production
relay, screenshots, and fixture restoration as the lobby runner. The movie
fixture establishes shared transport behavior; episode navigation availability
is additionally covered by the Player regression tests.

For the search debounce regression, run `PREXU_JOURNEY_SEARCH_SELECTION=1`
with `PREXU_JOURNEY_SCREENSHOTS` set to an evidence directory. The real desktop
signs into the QA server, searches for Prexu QA Seasons, changes the query while
the service suggestion remains visible, and clicks it before 300 ms elapses.
It checks `/item/17` after 500 ms and captures `search-detail.png`. No playback
or fixture mutation is performed. Build the selected native executable from the
revision being verified; the report's binary hash alone does not establish it.

## Downloads design gate (2026-11-25)

The full runner also requires four sequential desktop Downloads slices:

```sh
PREXU_JOURNEY_APP=/path/to/built/debug/prexu \
PREXU_JOURNEY_SCREENSHOTS=/path/to/evidence/screenshots \
PREXU_JOURNEY_REPORT=/path/to/evidence/full.json \
PREXU_JOURNEY_PROGRESS=1 node scripts/real-journeys/full.mjs
```

Build the native binary from the checkout being tested. Port 1420 and the QA
accounts must be idle; do not reuse another run's server or test session. The
runner clears slice-selection overrides, gives each slice its own screenshot
directory, and rejects missing, duplicate, or non-PASS required rows.

- `PREXU_JOURNEY_DOWNLOAD_QUEUE=1`: real QA season downloads, individual/all
  pause/resume, queue reorder, a **process restart** preserving paused order and
  byte counts (at least one partial file must be nonempty), completion, TV
  show/season grouping and collapse/expand, delete-confirmation cancellation,
  file deletion, and concurrency Settings values 2, 3 and 1.
- `PREXU_JOURNEY_DOWNLOAD_STORAGE=1`: storage summary and bulk-season warning
  cancellation. Uses the existing debug-only 1-byte free-space override; this
  exercises the warning path, not a physically full disk.
- `PREXU_JOURNEY_DOWNLOAD_MOVE=1`: real native folder picker, move confirmation,
  verified destination, Open folder dispatch, playback from the moved file, and
  removal of the isolated profile including both download locations.
- `PREXU_JOURNEY_DOWNLOAD_CLEANUP=1`: real QA HEVC8 download, Movies grouping,
  Settings default off, watched playback, current-session retention, enabled
  deletion after process relaunch, and disabled retention after another relaunch.
  The prior watched flag and resume offset are restored and checked.

For a focused diagnosis, set exactly one flag above and run `native.mjs` with
the same app, screenshot, report and protected credential variables. A focused
pass does not replace the full gate. Offline playback and the missing-local-file
error remain required in the existing native slice. The 24-hour cleanup branch
is covered by the eligibility unit tests; this gate exercises the next-launch
branch without changing the clock or seeding download records.

Attach the aggregate JSON and screenshots to the task. Never attach a profile,
raw account responses or token-bearing app logs.
