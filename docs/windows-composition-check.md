# Windows composition desktop check

The disposable `win11-test` VM has two virtual monitors. This check installs a
Windows candidate, seeds the authorized synthetic QA Plex profile, and plays
**Prexu QA Pattern** through the installed native player. It uses the real
WebView2 to navigate, reset the fixture between groups, and read control geometry; video verdicts come from
paired desktop captures, including the native DirectComposition surface.

## Run

Read `/usr/local/share/win11-eval/AGENTS.md` first. Coordinate ownership of the
single VM; the driver refuses to start if it is already running. Install the
repository's npm dependencies, Python 3.11+, FFmpeg/ffprobe, and have `ssh win11-test`, `scp`, and the
`sudo -n win11-vm` wrapper available. Supply `PREXU_QA_PLEX_AUTH` through the
protected environment, never a command-line argument or committed file.

Download a successful `windows-candidate.yml` artifact as described in
[Windows candidates](windows-candidate.md). Pass the directory containing
`BUILD.txt`, `SHA256SUMS.txt`, and the NSIS installer:

```sh
node scripts/windows-composition/run.mjs /path/to/candidate /path/to/evidence
```

Use a new, empty evidence directory for each run.

The driver downloads the authorized QA pattern and stream-copies ten repetitions
into a local MKV, without re-encoding. `fixture.json` records both hashes and
duration. This avoids EOF during slow software rendering and helper work; it is
not a Plex streaming or decoder-performance verdict. The QA library player is
opened normally, then its native engine loads this copy through a range-capable loopback HTTP
server and an SSH reverse tunnel. Both HTTP endpoints bind only to loopback;
the product's HTTP-only playback policy remains in effect.

The driver verifies the installer checksum, records build provenance, boots the
VM, runs the D3D11 hardware-device probe, installs the app, seeds its secure
store, and opens a loopback-only SSH tunnel on port 19346. It requires a committed
DComp tree and a live native render thread before starting the matrix. It resets
the VM in `finally`, closes the tunnel and fixture server, and deletes its temporary credential
file. On forced interruption, run `sudo win11-vm reset` yourself. Never force off
the VM: its Radeon shutdown guard needs a clean Windows shutdown.

`probe.txt` names the selected DXGI adapter. A present Radeon is optional; do not
label a Basic Render Driver result as a hardware-GPU result. The VM hardware
record and `BUILD.txt` must accompany any verdict.

## Pixel checks

- Baseline and return from Alt+Tab: a central video region must be illuminated,
  contain the synthetic saturated bars, and change between frames.
- Alt+Tab: detect the six narrow color stripes inside the thumbnail, excluding
  the larger background video. Compare only its interior, not the switcher UI.
- Space after returning without a click: pixels must freeze, then resume on the
  second press. Also record whether the native foreground HWND is Prexu.
- Occlusion and minimize/restore: capture the covered/minimized states and
  require advancing video after each return.
- Scale: exercise 100% → 150% → 100%. Monitor 1 temporarily uses 1920×1080:
  Windows clamps a 150% request to 125% at its default 1280×800 resolution.
  Verify the actual window DPI, not just the display helper's request message.
- Mixed DPI: restore monitor 1 to 1280×800/100%, keep monitor 2 at
  1920×1080/150%, and move the playing window both directions. Require actual
  144/96 DPI, stable normalized video bounds, and advancing pixels.
- At each scale/monitor position, locate the real pause button in WebView2,
  convert its center to physical desktop coordinates, and click through Win32.
  Pixel freeze/resume checks establish control hit alignment independently of
  the DOM's reported location.

The video sampler checks every third pixel on each axis. Both frames need over
50% illuminated and 15% saturated samples. Moving pairs need over 0.5% changed
samples; paused pairs allow under 0.2%, using a summed RGB difference over 45
as a changed sample. Geometry must stay within 6% of the baseline normalized
bounds. Vertical bounds use the expected stripe colors with tolerance for the
fixture's moving lines and checkerboard. A transition from video to black cannot
pass as motion.

Captures include both monitors. Frame pairs are acquired before PNG encoding;
metrics record timestamps and reject pairs outside 1–3 seconds. Acquisition may
retry an overlong pair twice; rejected timing pairs and intervals are retained.
Pixel failures are never retried away. Control checks wait for the three-second
overlay timeout before sampling, so fading chrome is not mistaken for video motion. The driver seeks
only between action groups, never during a pair or the Space test. Test-pattern
thresholds are specific to this fixture; do not substitute a film or another
pattern and reuse the thresholds.

`desktop.ps1 -SelfTest` exercises the detector with synthetic moving, frozen,
and black bitmaps. A failed prerequisite or incomplete worker is an error,
never a pass. Inspect `metrics.json` and every failed screenshot before filing a
product defect: EOF, an occupied VM, and a failed input helper can invalidate a
run. Preserve evidence as task attachments; temporary paths are not durable.

## Recorded result (2026-11-08)

Candidate `1bf70e5fc44b22de54e658d130f4b7a2e59f1624` (Windows candidate run
`42419782333`) passed the D3D11 probe and composition prerequisites on Microsoft
Basic Render Driver. The detector self-tests passed. The complete corrected
matrix exited **1**: its native video region stayed black despite a successful
600-second fixture load. Actual window DPI reached 144/96 and foreground/input
checks remained functional. An earlier complete run showed live Alt+Tab and
working keyboard return, but also partial-black frames during scale/resume.

This is **not a full composition acceptance pass**. Bead `prexu-557q` tracks the
black/partial-black observations, reproduction, and required follow-up. The
warm-player pause-state defect found during this work was fixed in `1bf70e5`
and closed as `prexu-53lm` after a focused regression and Windows pixel check.
Original screenshots, metrics, build/adapter provenance, and reset evidence are
attached to the automation task. Radeon was absent; no hardware-GPU verdict is
claimed. A failed black baseline also prevents certification of downstream
video-action checks, even when their focus and DPI checks pass.

## Remaining owner checks

See the short [owner checklist](windows-composition-scope.md#owner-checklist).
This harness does not certify fullscreen independent-flip behavior, hardware
decode, physical-monitor behavior, audible output, or SmartScreen.
