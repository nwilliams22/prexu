# Isolated real-service journeys

Run from the repository root after installing project dependencies and the
Playwright Chromium browser:

```sh
PREXU_JOURNEY_REPORT=/tmp/prexu-real-journeys.json node scripts/real-journeys/run.mjs
```

Supply `PREXU_QA_PLEX_AUTH` through the protected environment, never an argument
or a checked-in file. The runner discovers only **Prexu QA Test Server** and
requires rating key `2` to be **Prexu QA Pattern**. It never chooses another
server or a personal movie as a fallback. Requests use bounded timeouts and
refuse redirects. Credentials and account responses stay in memory.

The implemented browser slice checks real Plex-backed session restore,
search-to-detail identity against service metadata, and UI preference persistence
across reload. It seeds the normal browser auth store; this is explicitly not a
PIN-login test. No Plex routes or player hooks are mocked. Each invocation owns
its Vite instance and an ephemeral Chromium context, closes both in `finally`,
and does not reuse a listening server. A loopback relay override prevents
accidental connection to the server-derived relay. Browser traces, screenshots,
video, storage snapshots and console output are not saved. The JSON report
contains only fixed scenario labels, statuses and diagnostic stages, with no
service responses, account names, URLs, tokens, or raw exception messages.

This is a partial harness, not the full acceptance gate. Any FAIL, BLOCKED,
NOT_RUN or UNSUPPORTED row exits 1. Missing credentials fail before startup;
`--allow-missing-service` explicitly records SKIP and exits 0 instead. That flag
only permits the missing-credential skip, never failed requests or partial
coverage. Attach the JSON report to the tracking issue; temporary paths are not
durable evidence.

Remaining coverage is recorded in every service-backed report:

| Journey | Boundary still to implement or provision |
| --- | --- |
| Login | Desktop shell opens the real PIN flow; seeded browser auth does not prove it |
| Playback, resume, watch-state | Desktop driver, service assertions and restoration of synthetic-fixture state |
| Queue/postplay | Real playback completion and queue advancement |
| Downloads/offline | Tauri download backend is unavailable in a browser; requires desktop driver |
| Two-client relay | Second distinct authorized QA Plex account, then local production relay and two app clients |

The production relay keys connections by verified Plex username. A second
connection using the same account supersedes the first, so it cannot represent
a guest. The provisioning request asks for a second QA identity with access to
the QA server, bound as `PREXU_QA_PLEX_GUEST_AUTH`. The current runner does not
consume that variable or start a relay yet. Test-mode relay authentication is
not equivalent to this real-account acceptance. Product changes under
prexu-5n1 and prexu-9f4s are outside this harness's scope.

Run the credential-gate checks without service access:

```sh
node --test scripts/real-journeys/run.test.mjs
```

## Linux native single-user slice

With a debug native binary and `Xvfb`, `dbus-run-session`, `python3`, and
`fusermount3` installed, run:

```sh
PREXU_JOURNEY_PROGRESS=1 PREXU_JOURNEY_REPORT=/tmp/prexu-native-journeys.json \
  node scripts/real-journeys/native.mjs
node --test scripts/real-journeys/native.test.mjs scripts/real-journeys/run.test.mjs
```

`PREXU_JOURNEY_APP` optionally selects the debug executable. Its SHA-256 is
recorded; the runner does not certify which revision produced that binary.
The frontend comes from the current checkout. For Xvfb, verify and select the
patched QA libmpv runtime described in `docs/linux-native-codec-qa.md` with
`LD_LIBRARY_PATH=/path/to/verified/bundle/lib`; the launcher passes that setting
to the app. Verify the running app maps that library and record its digest
alongside the executable digest. This does not establish GPU or audio output.
Port 1420 must be free: the
runner starts its own Vite with strict binding and never attaches to an existing
server. Xvfb allocates a free display. Fresh HOME/XDG directories and a private
D-Bus session isolate native stores, downloads, browser data and log files.
The injected driver is served only by this launcher; normal dev/build commands
do not include it. No product source or native probe authentication is replaced.

The real Sign in button creates a Plex PIN and invokes the native shell opener.
A private `xdg-open` handler forwards only that Plex auth URL to a nonce-protected
loopback endpoint. The runner links the PIN with the protected QA credential;
it does not exercise the external Plex web sign-in page or manual password entry.
Native auth polling, server selection and the normal Tauri store run unchanged.
The account must expose exactly one server, the named QA server. The fixture
must be the synthetic movie, already watched, with no resume offset, and between
30 and 120 seconds long. Other account/library states fail closed.

The slice checks login, full-page reload/session restore, native time advance,
pause, early-stop watched-state preservation against the service, completed
native download and local-file presence. It also restores a persisted user queue
containing the fixture twice, drives EOF and Play Now, and checks queue index and
restarted native time. This tests queue restoration/handoff, not playlist creation,
episode chaining or distinct-item identity. Download playback is attempted after
replacing the isolated profile's server address with an unreachable loopback port
and restarting the native app process, so an in-memory metadata cache cannot
supply offline acceptance.

Resume checks and remaining acceptance limits:

- The installed QA movie lasts 119.040 seconds. Resume requires at least 90
  seconds: the driver plays past 65 seconds, pauses/stops, compares the saved
  service position within two seconds, clicks the real Resume button, and
  verifies native progress within six seconds of that position. It then lets
  playback complete and checks that Plex clears the resume marker.
- Downloaded playback must advance with the server unavailable; reaching
  Retry/Go Back is a `native-offline` FAIL, not UNSUPPORTED.
- Two-client relay journeys are SKIP with reason "pending second account"
  while `PREXU_QA_PLEX_GUEST_AUTH` is absent. This is pending coverage, not
  unsupported behavior. Presence of that secret changes the report to NOT_RUN
  until the real two-client adapter is implemented and verified. Full acceptance
  remains nonzero in either case.
- Native events establish control/progress, not audible output, GPU correctness
  or composed-screen acceptance. No screenshots or recordings are captured.

Finally, run-owned process groups are stopped, the fixture's prior resume offset
and watched flag are restored and checked, the private document-portal mount is
unmounted, and the entire profile is deleted. Reports contain only fixed labels,
statuses, numeric progress comparison and a binary digest. Raw app output is
suppressed. A failed service restoration or profile deletion fails cleanup.
Plex's account-side authorized-device history is not erased by deleting a local
profile. Attach the redacted JSON to the task; never attach the profile.

The QA account/service must be idle before starting. The runner refuses an
active session at preflight, checks session identity during service comparisons,
and skips restoration if another client becomes active. This is a fail-closed
contention check, not a cross-machine lease: arrange exclusive use of the QA
account for acceptance runs. A concurrent client can invalidate watch-state
comparisons even when local profiles and displays are isolated.

For the offline regression alone, set `PREXU_JOURNEY_OFFLINE_ONLY=1` in the
native command above. This runs real login, download, process restart and
local playback with an unreachable stored server address, then deletes the file
and checks the explicit missing-file error. It accepts the
fixture's current watch state, skips online playback/queue/resume/relay checks,
and still verifies cleanup and restoration. A PASS for this slice does not
establish those omitted journeys. The fallback uses the existing completed
download record for title/episode display; file duration and tracks are probed
by the local player. Fresh server metadata is still preferred when available.

Set `PREXU_JOURNEY_QUEUE_ONLY=1` to diagnose queue/postplay and offline
playback without repeating online resume. This slice still performs real login
and download, and its report explicitly excludes full journey acceptance.
The full native run has an eight-minute deadline. Reports retain up to 20
numeric watch-state comparisons and fixed boolean error categories; raw UI
text is never exported.

Linux startup must finish creating the GTK/mpv render context before issuing
`loadfile`, including after player teardown and app restart. Local downloads can
reach `vo=libmpv` before an asynchronously queued GTK bind finishes; network
loading can mask that race. The player awaits render readiness without waking
the idle overlay, and reports initialization failure instead of retrying the
load. `Raw(-20)` alone is generic: the diagnostic identifying this race was
`No render context set` before video-output initialization failed. Do not turn
that error into a pass or retry it away when evaluating repeatability.
