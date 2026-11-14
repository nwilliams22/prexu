# Windows composed-screen scenarios

Run against an unused disposable `win11-test` VM from bd-server:

```sh
node scripts/windows-composition/run.mjs /path/to/candidate /path/to/new-evidence --scenarios
node --test scripts/windows-composition/scenarios.test.mjs
```

The candidate directory must contain the NSIS installer, `SHA256SUMS.txt` and
`BUILD.txt` from the Windows candidate workflow. The authorized throwaway QA
account must be supplied through `PREXU_QA_PLEX_AUTH`, never a command argument.
The runner refuses an occupied VM or nonempty evidence directory. It installs
and launches the actual app on the signed-in desktop, attaches to its WebView2,
and reuses the QA pattern as a stream-copied ten-minute loop. Only the fixture
bytes are served over a loopback SSH forward; authentication is not sent there.
The VM is reset in `finally`, including failure paths. Check `reset.txt` and
`final-status.txt`; if the controller is interrupted, run `sudo win11-vm reset`.

The scenario mode exercises play, native seek, fullscreen and return, in-window
mini and restore, popout and return, a native freeze negative control, recovery,
and stop. Mode changes use the installed UI's actual button handlers. Transport
uses the real native IPC. There is no mocked IPC or browser-only renderer.
The seek check keeps playback moving and waits up to ten seconds for the UI
position to reach 24–26 seconds after requesting 25. It does not certify
paused-seek timeline updates; a fixed-delay read while paused can retain a stale
pre-seek UI position even when native seeking succeeded.
This is an installed-release adapter, separate from the debug-only
`PREXU_PROBE_SCRIPT` adapter under `scripts/hw-probe/driver`.

`CopyFromScreen` samples the composed virtual desktop, including native video,
WebView2 chrome and OS window borders. Evidence contains timestamped pairs of
PNG frames, video-region motion/color metrics and theme-matched control-icon pixel observations.
Repeated native pointer movement keeps controls visible while sampling; their
DOM styles and captured pixels are never changed.
The six-bar locator tolerates up to six unclassified pixels inside a stripe
only when the same color resumes, so thin moving fixture lines cannot erase
every seed row. Wider gaps and other bar colors are not bridged. The Windows
`desktop.ps1 -SelfTest` includes full-height line and wide-gap regressions.
Offline replay diagnoses classifier failures; it does not turn a failed live
scenario run into a clean acceptance pass.
These are sampled frames, **not a continuous recording or transition-latency
measurement**. Scenario samples must be 1–10 seconds apart to accommodate
software capture latency; this is not a frame-pacing acceptance threshold.
The separate focus/DPI matrix retains its tighter three-second bound.
Native pixel self-tests run before playback. The deliberate
fault pauses the actual libmpv renderer while the same moving-video predicate
still expects movement; detection requires visible frozen video and controls,
not missing/black captures. Playback must recover afterwards. Stop requires
both video bars and player controls to disappear.

`session.json`, `hardware.txt`, `probe.txt`, `composition.txt`, `fixture.json`
and `BUILD.txt` identify session, displays, adapters, selected D3D11 prerequisite
adapter, renderer startup, source media and installed build. A Radeon listed by
WMI does not mean the app selected it. Physical GPU decode is not certified by
this run. `metrics.json` and `verdict.json` are the source of truth for outcomes.
`render-events.txt` retains renderer diagnostics on success and, when the guest
is still reachable, on failure. Builds with frame-progress counters report wakes,
timeouts, requested frames, completed renders and successful/failed Present calls
every five seconds. These counters distinguish scheduling and presentation
failures; successful submission alone does not establish visible video pixels.
A missing capture, session 0, malformed evidence, failed action, failed capture
prerequisite or absent required verdict fails the command. Captures can contain
the throwaway account's UI: review before attaching; never attach its secure store.

Without `--scenarios`, the existing focus/occlusion/DPI composition matrix runs.

## Checks a hosted runner cannot establish

| Check | Required graphical equipment / environment |
| --- | --- |
| Actual composed native video and interactive controls | Signed-in, unlocked Windows desktop with an active display surface and D3D11/ANGLE support; this VM supplies virtual displays and software rendering |
| Representative GPU rendering and hardware decoding | Windows PC with a supported AMD, Intel or NVIDIA GPU, its vendor driver, and an attached active display; verify the adapter actually selected by ANGLE and the decoder |
| Physical mixed-DPI transitions and unplug/replug | Two attached physical monitors at different scales/resolutions; a person or managed display switch to disconnect/reconnect; virtual displays cover only virtual topology |
| HDR and color correctness | HDR-capable GPU/output path, HDR monitor, known reference media, and a colorimeter for measured color accuracy |
| Refresh, tearing and presentation latency | Physical display at the target refresh rate and a high-speed camera or external capture device with known timing; PNG pairs cannot measure presentation timing |
| Audible playback and AV sync | Working audio device plus speakers/headphones; loopback or external synchronized AV capture for measured sync |
| Sleep/wake and GPU driver recovery | Representative physical Windows machine and display; controlled sleep/resume and driver-recovery testing |

No equipment is purchased by this harness. Green hosted installer/build tests
remain packaging evidence only. Software/virtual runs do not waive the rows
requiring physical equipment.

### Opt-in pixel readback

For black-output diagnosis, run the normal command with
`PREXU_VIDEO_PIXEL_PROBE=1`. The runner sets this variable only in the installed
app's desktop launcher and records the setting in `pixel-probe.txt`. Candidates
built before this probe ignore it; check for the `pixel probe armed` log and a completed sample.

The native renderer samples an interior 5×5 grid from the GL render target,
D3D shared texture and copied swapchain backbuffer after the copy fence and
before Present, using the same rendered frame and dimensions. `render-events.txt`
retains each sample's log timestamp, frame counter, dimensions, non-black count,
maximum RGB channel, RGB hash and readback duration. Alpha is ignored; a sample
is non-black when any RGB channel exceeds 16. Errors are recorded separately
from black results. Sampling is one-shot per render-thread lifetime. The renderer polls a request
file at most once per two seconds; it performs no readback until the harness
has completed its first playback screenshot pair and written that request.
The harness waits up to ten seconds for completion, records the request time
and acknowledgement in the play metrics, and rejects a missing acknowledgement.
Thus the first composed pair is an untouched positive or black baseline; later
captures can reveal probe interference. Default playback performs no readback.
The runner supplies `PREXU_VIDEO_PIXEL_PROBE_REQUEST` only to its desktop launcher;
the feature requires scenario mode. Older continuously sampled evidence remains
historical and cannot be assumed free of startup/timing interference.

Correlate these records with the original composed captures and frame counters.
A lit GL/shared target but black backbuffer implicates the copy; a lit backbuffer
with black composed output directs investigation after the copy. A black GL
target requires upstream decode/render investigation. Shared/back hashes use the
same coordinate and channel ordering; GL samples convert bottom-left to top-left
coordinates, but GL/D3D orientation must be checked against the fixture before
assuming their hashes match. Sparse samples cannot prove that every pixel is
black, and successful Present does not prove composition. Readback synchronizes
GPU work and can hide a timing fault: compare runs with the probe disabled and
do not classify passing probe runs as a black-video fix.

With queued-frame diagnostics, the same opt-in request also records at most eight
`NEXT_FRAME_INFO` observations over two seconds, at most four per second. The
first is taken before the render used for the pixel sample; subsequent entries
report queued-frame progress without further pixel readbacks. Calls stay on the
render thread with its GL context current, after update and before rendering.
Flags are a bitset: 1 PRESENT, 2 REDRAW, 4 REPEAT, 8 BLOCK_VSYNC; zero means no
queued frame. `target_time_raw` is the unscaled scheduled absolute display time returned by
mpv, not media PTS or presentation confirmation, and may be zero. Do not infer
units from the API header: the pinned runtime returned nanosecond-scale deltas
in the measured two-second window despite the header describing microseconds. Progress establishes queue
submission only; it does not prove decoded pixel content. Missing progress does
not by itself establish decoder starvation. Sampling can still affect timing.
