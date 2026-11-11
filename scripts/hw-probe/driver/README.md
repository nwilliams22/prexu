# Scripted probe contract v1

This directory implements offline script/trace verification and isolated native
startup. The native parser has 64 shared positive/negative cases checked by Rust
and Python. Run its checks with
`cargo test --manifest-path src-tauri/Cargo.toml --test probe_script`.

Debug Linux/Windows builds accept `PREXU_PROBE_SCRIPT`, `PREXU_PROBE_STATE_DIR`,
`PREXU_PROBE_OUTPUT_DIR`, and `PREXU_PROBE_FIXTURE_PORT` together. The three
paths must be absolute. The port must be decimal in 1–65535; native startup
constructs `http://127.0.0.1:<port>`, so it cannot select a remote host, URL path,
credentials or alternate scheme. The launcher must supply the port of its
verified fixture service. Before application
initialization, the bootstrap validates the script, rejects existing or
overlapping directories, and reserves an exclusive `events.jsonl`. The caller
must create the parent directory; state and output must not exist. A failed
preflight can consume fresh directories; retry with new paths.

Tauri config/data/cache/log and default webview storage use the fresh state
root. Probe startup skips normal log rotation and the single-instance plugin.
Other platforms reject probe startup until their webview isolation is verified.
Release builds reject any probe variable (even empty) with `probe_disabled` and
exit code 2 before normal initialization; parsing and filesystem preparation are
compiled out. With no probe variables, normal startup is unchanged.

The debug-only `probe_driver` IPC provides a read-only `bootstrap` request
before React/auth initialization. It returns the native fixture URL only in a
preflight-enabled run, otherwise null. The URL is not part of scripts or markers.
A one-shot `ready` handshake from the main webview starts execution; ordered
`begin`, `end`, `fail`, `cleanup`, and `finish` requests use the same IPC.
Rust validates action-specific observations, assigns sequence/time,
flushes each JSONL marker, and logs the same JSON. Invalid observations emit a
fixed failure code without recording their payload. Write/flush failure poisons
the writer. Finishing exits the app after flushing the terminal marker.

`src/services/probe-runner.ts` implements the frontend execution core: one-shot
startup, serial begin/action/end calls, run/step deadlines, cancellation, fixed
failure codes, and bounded cleanup. Its adapter must subscribe before dispatch
and honor cancellation; native Rust remains the observation validator. Unit
checks cover late replies, failure short-circuiting and hung IPC/cleanup.

`src/main.tsx` reads native bootstrap before mounting React. Fixture runs use
an in-memory synthetic auth provider and do not mount `useAuthState`, so they
skip ordinary stored-auth migration, plex.tv validation and server discovery.
Bootstrap errors and timeouts fail closed; normal browser/debug startup and
release builds without the command retain ordinary authentication.

The fixture-only React bridge invokes the one-shot runner and uses the same
session, transport, track, fullscreen, mini-player, popout, router and volume
handlers as the UI. Window minimize/restore use the native window API. Each play
requires an absent native handle before dispatch and two matching fixture samples
with advancing time afterwards; normal startup warmup is skipped in probe mode.
Stop requires the session to clear and the native handle to disappear. Polling is
cancellable, including hung IPC; unsupported capabilities fail explicitly.
Passing selftests is not an end-to-end run or proof of runtime storage isolation.
The transport regression scenario is `scenarios/transport.json`: play, pause,
seek, audio/subtitle selection, resume, stop, replay, stop and quit. Run it through
the launcher on a debug desktop with the generated fixtures. On Linux, the mpv
frame pump redraws on frame notifications; unconditional redraws during playback
can delay WebKit IPC replies until EOF under software rendering. The frame pump
runs at GLib low priority so pending WebKit/GTK work can dispatch before another
video repaint; the two-sample advancing-play predicate and deadlines are unchanged.
A passing transport verdict establishes control/state only, not visible or audible output.

Test the production-compiled environment policy separately without linking the
GUI (this tests the gate, not a packaged release):

```sh
rustc --test -C debug-assertions=no src-tauri/src/probe_environment.rs -o /tmp/probe-gate-tests
/tmp/probe-gate-tests
```

Run the negative controls with:

```sh
mise run probe-driver:selftest
```

Check recorded evidence with:

```sh
python3 scripts/hw-probe/driver/check.py \
  --script run/script.json --events run/events.jsonl \
  --exit-code 0 --output run/verdict.json
```

The launcher must supply the actual app exit status. This offline command cannot
attest to how the inputs were obtained. It exits zero only for a complete valid
success trace and exit status zero. Input failures produce a failing verdict;
output files are created exclusively to preserve prior evidence.

## Linux process launcher

The launcher starts the verified fixture service, generates a unique run ID,
reserves a fresh run directory, snapshots the script, and supplies isolated
native state/output paths and the service port to a debug executable:

```sh
python3 scripts/hw-probe/driver/launch.py \
  --app /absolute/path/to/debug/prexu \
  --script scenario.json --fixtures /absolute/path/to/fixtures \
  --run-dir /absolute/path/to/new-run \
  --source-commit <40-character-build-revision>
```

The run directory must not exist; its parent must exist. `manifest.json` records
the script hash, fixture manifest and caller-supplied build revision (the
launcher does not independently certify the binary's source revision).
`process.json` records the actual exit status and timeout flag. `verdict.json`
is generated by the contract verifier from `output/events.jsonl` and that exit
status. Missing inputs, failed startup, absent markers and watchdog expiration
fail closed. Existing evidence is never overwritten. `app.log` retains the
child's combined output; inspect logs before sharing them.

The child receives an allowlist of desktop/runtime environment variables and a
fresh HOME/XDG profile, with no inherited service credentials or probe settings.
A Linux process group bounds the app and WebKit children: the watchdog kills
that group after the script deadline plus ten seconds, and residual group
members are killed even after normal app exit. The fixture listener is closed
on success and failure. Windows is explicitly unsupported until equivalent
process-tree cleanup is implemented.

Launcher tests use synthetic executables to prove process handling and verdict
generation; they are not desktop acceptance. For desktop runs, serve a built
frontend on the debug binary's configured dev URL to avoid development compilation
or HMR consuming step deadlines. The fixture server permits browser CORS only
from the known application origins. An audio-track step requires an available
audio output; a headless machine without one must fail that step.

## Scripts

`schema: prexu.probe.script`, integer `version: 1`, an ASCII `runId` (1–64
letters, digits, `_`, `-`), `fixture: av-cues-v1`, `timeoutMs` (1–900000), and
1–256 `steps` are required. Scripts are limited to 1 MiB. Unknown fields, duplicate
JSON keys, non-finite numbers, booleans in numeric fields, duplicate step IDs,
unknown actions and invalid playback sequences are rejected.

Each step has `id`, `action`, `timeoutMs` (1–120000), and optional `args`.
`quit` is required and last; stop active playback before quitting. A new play
requires the previous session to be stopped. Pause/resume must alternate.

| Action | Arguments | Completion observation |
| --- | --- | --- |
| play | mediaId: av-cues-v1 | loaded: true, advancing positionMs > 0 |
| seek | positionMs: 0–15000, toleranceMs: 0–2000 | positionMs within tolerance |
| pause / resume | none | paused: true / false |
| selectAudio | trackId: 1 or 2 | matching trackId |
| selectSubtitle | trackId: 0 (off) or 1 | matching trackId |
| fullscreen / miniPlayer / popout | enabled: boolean | matching enabled |
| windowMinimize / windowRestore | none | minimized: true / false |
| stop | none | sessionCleared: true, idle: true |
| wait | durationMs: 1–step timeout | durationMs at least requested duration |
| navigate | route: / or /settings | matching route |
| setSetting | name: volume, value: 0–100 | matching name and value |
| quit | none | ready: true |

The fixture-specific track IDs and duration match the generated v1 fixture contract.
The app must fail explicitly when an action is unsupported on its platform.

## Markers

Each line is a JSON object with `schema: prexu.probe.event`, integer `version: 1`,
matching `runId`, sequential integer `seq` starting at 1, nondecreasing
`elapsedMs`, and `event`. Unknown fields are rejected. Maximum line size is
4096 bytes and maximum trace size is 2 MiB.

Successful ordering:

1. `run.begin`
2. `step.begin` and `step.end` for each script step, in order; both have matching
   `stepId` and `action`. The end carries the allowlisted `observed` object above.
3. `cleanup.begin`, `cleanup.end`, `run.end` with `status: pass`.

Steps must complete within both their own and the run deadline. Cleanup and
terminal output must finish within 10 seconds. Missing, extra, reordered or
mismatched markers fail. Error markers always fail; their allowed codes are
`invalid_script`, `unsupported_action`, `step_timeout`, `predicate_failed`,
`player_error`, `cleanup_failed`. No raw exceptions or personal metadata enter
the verdict. This verifier does not certify a failure trace's cleanup: failure
remains failure regardless of subsequent markers.

The Rust writer owns sequence/time assignment and validates observations;
frontend completion must establish new-load correlation and register listeners
before dispatch. Marker observations establish control/state only. They cannot
prove visible video, audible sound, GPU correctness or display transitions.

## Generated media

Generate into a new directory (requires `ffmpeg` and `ffprobe` on PATH):

```sh
python3 scripts/hw-probe/driver/fixtures.py /absolute/path/to/fixtures
python3 scripts/hw-probe/driver/fixtures.py /absolute/path/to/fixtures --verify
```

The recipe generates 15 seconds of 320×180 MPEG-4 video (red, green, blue in
five-second intervals), two mono 48 kHz PCM audio tracks (440 and 880 Hz), and
three SubRip cues. No downloaded assets or user library are used. The generated
content is dedicated under CC0-1.0. The manifest records the tool version,
SHA256 of each file, stream indices, mpv track IDs, and cue intervals. Bitexact
flags and one video encoder thread make repeat runs with the same tool build
byte-identical; different FFmpeg builds can produce different hashes. Consumers
must verify the hashes from their run manifest before use.

The independent real-mpv tests accept the generated file via
`PREXU_TEST_FIXTURE` and use null video/audio outputs. On Linux:

```sh
PREXU_TEST_FIXTURE=/absolute/path/to/fixtures/av-cues-v1.mkv \
  timeout 120 cargo test --manifest-path src-tauri/Cargo.toml \
  --test probe_fixture -- --ignored --nocapture
```

Windows uses the same Rust test target with the fixture path set in PowerShell
and the bundled libmpv DLL beside the test binary. Wrap execution in a process
timeout on every platform: event waits have ten-second deadlines, but a stuck
native destructor needs an external watchdog. These tests cover signal/state
only and cannot prove the cue colors or tones reached a display or speaker.

## Loopback fixture service

`fixture_service.serve(directory)` is a context manager for harness integration.
It verifies the manifest, snapshots and rechecks bounded fixture bytes, then
binds an ephemeral port on `127.0.0.1`. The yielded `url` and `manifest` describe
that server instance. Exiting the context stops the listener and joins its
request handlers, including on exceptions. No independent background service
is installed.

It implements synthetic metadata/library/identity responses and the media part
route, with GET/HEAD and single byte ranges for native seeking. Timeline and
watched-state requests are acknowledged without persistence. Unknown routes
return 404; there is no filesystem route, proxy, Plex account login, or
transcoding endpoint. Requests and query strings are not logged. The service
is wired into the Linux launcher above; HTTP tests and ffprobe reads establish
fixture transport, not a desktop playback verdict.


## Native observations

The debug-only `probe_driver` operation `snapshot` samples the active mpv handle
under the player lock. It requires the native probe state and main webview. It
returns initialized/idle flags, a boolean for the fixed fixture path, optional
position/pause state, and optional selected audio/subtitle IDs (subtitle `0`
means off). Unknown properties remain null. Paths, query strings, and mpv errors
are never returned. Calls run off the UI thread.

The endpoint is read-only and does not emit markers. A snapshot alone is not a
new-load acknowledgement: the live UI adapter observes an absent
native player before dispatching play, then observes the fixture and advancing
time on the fresh handle. Do not use queued `player://ready` or `time-pos` events
as new-load evidence. Real-mpv tests cover snapshot seek/track/idle values and
wrong-fixture rejection with null outputs. The transport scenario exercises the
connected UI adapter and native observations together.

## Linux composed-desktop recording (RECORD stage)

On a **dedicated, provisioned X11 graphical session**, add `--record` to the
launcher. This launches the app and fixture service, drives the scenario,
records the composed desktop, validates evidence and cleans up its own processes:

```sh
DISPLAY=:96 XAUTHORITY=/absolute/path/to/session-authority \
GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 \
python3 scripts/hw-probe/driver/launch.py --record --record-window-size 800x600 \
  --app /absolute/path/to/debug/prexu \
  --script scripts/hw-probe/driver/scenarios/capture.json \
  --fixtures /absolute/path/to/generated-fixtures \
  --run-dir /absolute/path/to/new-run \
  --source-commit <40-character-build-revision>
```

Provision Xvfb/Xephyr or a dedicated X11 desktop first, and serve the completed
frontend build at the binary's dev URL as described above. The launcher owns
only its app, fixture listener, recorder and marker window; the provisioner
owns cleanup of the X server and frontend server. Never reuse another task's
session or port. The app window must fit entirely inside the captured root. The recorder focuses
the launched window. `--record-window-size 800x600` also resizes it explicitly;
this is useful for software-rendered sessions where larger windows can starve
WebKit dispatch. Omit it to preserve the application size.
This path requires `nu`, `ffmpeg`, `ffprobe`, `identify`, `xdotool`, libX11 and
at least one working hw-probe screenshot backend (`import` on X11).

`capture-screen.nu` calls the existing `lib.nu` capture API, including the
bounded retry implemented in `prexu-s83x`. Recording uses FFmpeg X11 root
capture at 30 fps with lossless FFV1. Neither operation uses webview/DOM capture.
Wayland currently fails explicitly with `capture_wayland_unsupported`; Windows
capture is outside this stage.

The evidence contains:

- `desktop.mkv`: continuous composed-root video, including fast steps.
- `capture.json`: per-step cue sequence numbers, approximate video intervals,
  per-step image names, window samples, decoded frame count and video hash.
- `step-*.png`: decoded midpoint navigation images for completed steps.
- `output/events.jsonl`: native-validated, allowlisted structured logs correlated
  by run ID, sequence and elapsed milliseconds; the script/manifest identify
  their scenario, fixture and caller-supplied build revision.
- `capture-environment.json`: kernel, display availability, rendering scope,
  binary hash and recorder source hash, including on failed preflight.
- `capture-observations.json`: partial window/cue observations on failure.
- `process.json`, `verdict.json`, `capture-before.png`, `capture-after.png` and
  FFmpeg's numeric `capture-progress.log`.

Two fresh random color challenges occupy the **top-right 16×16 desktop pixels**.
The shared screenshot backend must capture the current challenge, and full
video decoding must find both challenges. Exclude `excludedRect` from future
image assertions. This proves fresh capture of this display, not that the app
itself rendered correct content. Window geometry is sampled by the launched
PID and exact `Prexu` title; an absent window or out-of-root bounds fail.
The dedicated session must keep that window unobscured. This does not certify
window-manager transitions, GPU rendering or audio output.

Cue receipts use a monotonic host clock and the native elapsed clock. Video
startup and polling introduce timing uncertainty; intervals and midpoint
images are navigation aids, **not exact frame/transition assertions**. A step
shorter than a video frame may share its image with adjacent steps. Frame
content and precise transition assertions belong to `prexu-vbb2.3`.

A zero exit requires both the original script verifier and capture validation.
No display (`no_graphical_session`), denied/unreachable X connection
(`display_inaccessible`), failed backend/decoder (`capture_failed`), stale
frames or missing window evidence all fail explicitly. Failed evidence is
preserved, and the watchdog/SIGTERM/SIGINT paths clean up owned child groups.
Existing run directories are never overwritten.

For sharing, export only the evidence files listed above plus `script.json`
and `manifest.json`. **Do not export `home/` or `state/`**: they are isolated
runtime profiles and can contain raw application diagnostics. In record mode
`app.log` suppresses arbitrary child output and retains only a line-count
notice; the safe correlated log is `output/events.jsonl`. This deliberately
avoids guessing which future free-form messages might contain credentials.

Negative controls must be executed on the target session, not inferred from
unit tests: remove `DISPLAY`/`WAYLAND_DISPLAY`; use an empty `XAUTHORITY` against
an X server started with `-auth`; put failing `grim`, `spectacle` and `import`
executables first on PATH. Use a fresh run directory for each, retain the
nonzero exit and JSON evidence, and confirm the graphical provisioner's
processes are stopped afterwards. `test_record.py` additionally rejects real
stale/corrupt video and tests that recorder failure kills the launched app.

## Per-step visual verdicts (VERDICT stage)

`visual.py` consumes the **continuous composed recording**, native cue trace,
actual process result, capture clock evidence and a reviewed visual plan. It
fails closed on absent/invalid inputs, missing frames or markers, changed video
or reference hashes, excessive clock uncertainty, uncovered required steps,
unsupported check kinds and failed assertions. `quit` alone is marker-only.
Capture-only runs still do not assert content; request `--visual-plan` explicitly:

```sh
# Add these to the launcher invocation on the dedicated X11 session:
# --script scripts/hw-probe/driver/scenarios/visual.json --record \
# --record-window-size 800x600 \
# --visual-plan scripts/hw-probe/driver/fixtures/visual-linux-xvfb/plan.json

# Or independently replay an intact recorded run:
python3 scripts/hw-probe/driver/visual.py \
  --run-dir /absolute/path/to/run \
  --plan scripts/hw-probe/driver/fixtures/visual-linux-xvfb/plan.json \
  --output /absolute/path/to/new-visual-verdict.json
```

The checked-in plan is for an 800×600 app at desktop origin on a 1280×800 Xvfb
root, software GL, the light fixture profile, and the bundled v1 media. Its
reference PNGs were inspected from a real native run: red/green/blue video,
CUE ONE/TWO/THREE below the video, paused-player title and restored app header.
They are fixed expected images, **never automatically replaced from the capture
under test**. The test regions exclude the random desktop freshness challenge,
variable elapsed/clock labels and the intentional controls gradient. Other
layouts, themes, fonts or platforms require separately reviewed plans.

Each check names its step, begin/end anchor, nonnegative sampling offset,
transition budget, stable hold duration, absolute desktop rectangle and pixel
thresholds. Video checks compare RGB against the deterministic fixture colors;
subtitle/chrome/geometry checks compare against a hash-bound reference region.
Both actual and expected regions are area-resampled to 64×36, then the fraction
of pixels exceeding the per-channel tolerance is measured. This checks color,
text shape and placement, not luminance alone. The report includes actual pixel
errors, thresholds, sample counts, window error, bounded presentation latency,
clip file/time range and the exact allowlisted marker slice for each check.
A check needs a continuously matching hold, starting within its budget. It does
not assert every pixel outside its region or every instant outside that hold.

`scenarios/visual.json` pauses and seeks across all three different colors and
subtitle cues. A frozen earlier color cannot pass the later cue checks. The v1
media is constant within each five-second interval: it cannot distinguish two
frames from the **same** cue interval. These checks do not certify arbitrary
movie frame identity, GPU decode, audible audio, Windows or Wayland rendering.
The supplied plan exercises playback/seek/pause/subtitles/stop and restored
chrome; fullscreen, mini-player and popout need plans for their target layouts.

Timing uses decoded frame PTS (no frame duplication) and two independent clock
brackets: marker receipt polls bound the native elapsed origin, and the last
old/first new desktop color-challenge frames bound the video clock origin.
A plan declares a small clock slack and maximum combined uncertainty; missing,
inconsistent or too-wide bounds fail. The first stable matching frame's **upper**
latency bound must fit the budget. Old capture files without these bounds fail
required timing checks; do not invent an offset from their midpoint PNGs.
Receipt/flush and X11 capture latency remain part of this calibrated software
session assumption, not a hardware presentation timestamp guarantee.

Calibration follows **prexu-xxct**: these are explicitly scoped debug regression
budgets, not universal performance ceilings. The supplied allowance is 1500 ms
from play completion to visible content, 600 ms for other assertions, a 200 ms
stable hold, 10 ms clock slack, and at most 120 ms clock uncertainty. The live
reviewed runs had about 54–57 ms uncertainty. Release performance calibration
remains separate (`prexu-ed30`); no release ceiling is inferred from this run.

For scripts containing popout exit, `allocationGapMs` must be explicit. The
launcher preserves only the two existing numeric allocation marker types in
`allocation.log`; it does not export raw application diagnostics. The verifier
requires the expected number of exits and calls the existing
`check-popout-exit-alloc-gap` in `../verdict.nu`. A missing marker, unresolved
allocation or `skip` fails that required scenario. Scenarios without popout exit
use `allocationGapMs: null`.

Reproduce real-video negative controls after recording a passing visual scenario:

```sh
python3 scripts/hw-probe/driver/exercise_visual.py \
  --run-dir /absolute/path/to/passing-run \
  --plan scripts/hw-probe/driver/fixtures/visual-linux-xvfb/plan.json \
  --output-dir /absolute/path/to/new-controls
```

This keeps the baseline and generates black, stale, wrong-color, missing
subtitle/chrome, misplaced geometry and delayed-transition videos. It also
removes a required marker, changes the decoded-frame count and omits a required
step check. Every mutated video gets a new declared hash, so content mutations
must fail their pixel/timing assertion rather than merely a hash mismatch.
`results.json` requires the original capture to pass and each mutation to fail.
Export the videos, plans/reference PNGs, JSON reports and structured logs as
issue attachments; exclude `home/`, `state/` and raw child logs.
