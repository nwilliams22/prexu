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
This is an installed-release adapter, separate from the debug-only
`PREXU_PROBE_SCRIPT` adapter under `scripts/hw-probe/driver`.

`CopyFromScreen` samples the composed virtual desktop, including native video,
WebView2 chrome and OS window borders. Evidence contains timestamped pairs of
PNG frames, video-region motion/color metrics and theme-matched control-icon pixel observations.
Repeated native pointer movement keeps controls visible while sampling; their
DOM styles and captured pixels are never changed.
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
