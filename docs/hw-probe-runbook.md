# hw-probe runbook — semi-automated on-hardware pass

`scripts/hw-probe/` is the W2 probe suite from `docs/test-automation-plan.md`:
one-command-ish checks that run on the **Linux dev box** against a real Plex
server and a running Prexu, converting most of the manual plan's eyeball steps
(`docs/linux-on-hardware-test-plan.md` sections A, D, B, E, F, G, N) into a
report you skim instead of 27 hand-run steps.

It is **not** a CI job — it needs a real compositor + GPU + Plex. The one piece
that *does* run in CI is `hw-probe:selftest` (the mutation-checked verdict core).

## Architecture

Two layers, deliberately split:

- **`verdict.nu` — pure verdicts.** Log-invariant walks, luminance
  classification, RSS/CPU/timing/zombie/deadlock/geometry/click-sweep-point
  verdicts. No I/O. Exercised by `selftest.nu` with fixtures, so it runs in CI
  with only nushell. These are the functions the mutation-check guards.
- **`lib.nu` + entry scripts — live I/O.** Screen capture, `/proc` sampling,
  ffmpeg ground truth, `xprop`/`wmctrl`, `xdotool` key/mouse injection. Feed
  the pure verdicts; degrade to `skip` when a tool or the app is absent.

Entry points: `run.nu` (orchestrator), `log-assert.nu`, `luminance.nu`,
`probes.nu`, `geometry-x11.nu`, `selftest.nu`.

## Prerequisites

Provisioned by `mise install` (nushell) plus system packages:

| Tool | Used for | Notes |
| --- | --- | --- |
| `nu` (nushell) | all scripts | `mise install` (pinned in `mise.toml`) |
| ImageMagick (`magick`) | luminance means | v7 `magick`; forces `-colorspace sRGB` |
| `ffmpeg`/`ffprobe` | luminance ground truth | frame extraction at a timestamp |
| `grim`+`slurp` / `spectacle` / `import` | screen capture | auto fall-through, see below |
| `xprop` / `wmctrl` | X11 geometry/state, window lookup for click-sweep | X11 sessions only |
| `xdotool` (X11) / `wtype` (Wayland) | stress auto-drive; click-sweep is X11/xdotool-only | optional (required for click-sweep) |

```bash
sudo dnf install -y grim slurp xdotool wtype   # + optional: ydotool
```

### Session notes (important)

- **Capture backend** is chosen by *trying* each one, not by presence: `grim`
  fails on KDE (KWin has no `wlr-screencopy`), so on KDE Plasma the suite falls
  through to `spectacle`. On wlroots (sway/Hyprland) or X11, `grim`/`import` are
  faster and used first.
- **Geometry probes are X11-only.** On Wayland the native mpv surface has no
  addressable per-window geometry API, so `geometry-x11.nu` and the orchestrator's
  geometry row `skip`. This matches the plan: *"Wayland runs get log+luminance
  only; X11 runs add geometry probes."* The geometry *parsing* is still unit-
  tested in `selftest.nu`.
- Capture on KDE via `spectacle` is ~0.5–1 s/frame, so transition sampling is
  coarse there.

## Quick start

```bash
# Auto checks (log invariants, first-play timing, zombie scan, one luminance
# sample) + a written report. Run after using the app for a bit.
mise run hw-probe                 # == nu scripts/hw-probe/run.nu

# Just the log invariants over the newest app log:
mise run hw-probe:log

# One luminance sample of the current screen:
mise run hw-probe:luminance
```

The app log is auto-discovered at
`~/.local/share/com.prexu.client/logs/Prexu.log`.

## Probes

### Automatic (no operator action)

| Probe | Command | Plan | Checks |
| --- | --- | --- | --- |
| log invariants | `probes`/`log-assert.nu` | Pre, A.1–A.3, B.2–B.5, E.4/E.5, F.1 | DMABUF enabled, compositor installed, GL render context up, first-frame arm↔render pairing (no seek re-emit), sub-scale in (0,1], use-margins pairs with not-minimized (B.4), popout inset-clear, popout-exit→webview allocation gap under 800 ms (prexu-uf4m; both lines carry `t=<ms>` markers because log timestamps are second-precision) |
| first-play timing | `probes.nu timing` | N.2 | arm→render latency under ceiling (±1 s log precision) |
| zombie scan | `probes.nu zombie` | G.2 | no defunct app/mpv after exit — run *after* quitting |

The first-frame invariant is the high-value one: on Linux `events.rs` **arms**
the compositor (`first-frame reveal armed`) and the GLArea render handler
**fires** it once (`first frame rendered after arm`), or a stale arm is
**dropped**. The runner flags a fire with no live arm (the A.3 seek-re-emit bug)
and a re-arm before the previous arm resolved. Do **not** match the bare
`player://host-window-ready` string — it also appears in frontend-receipt logs
and the pre-prexu-91t8 non-Linux emit path.

The B.4 use-margins check reads the same `video-margin-ratio applied left=<f>
right=<f> top=<f> bottom=<f> sub-scale=<f> sub-use-margins=<bool>` line as the
sub-scale check, and asserts `sub-use-margins=true` iff all four margins are
exactly zero (the restored/not-minimized state) — the ground truth is
`sub_compensation` in `linux_compositor.rs`, which returns `(1.0, true)` only
for zero ratios and `(_, false)` otherwise.

### Operator-driven (need hands on the transition)

```bash
# N.1 — RSS stays flat across a seek loop. Start playback, run this, then seek
# repeatedly for ~10 s:
nu scripts/hw-probe/probes.nu rss --samples 20 --interval 500ms

# N.3 — steady-state CPU under the pump-gate ceiling during quiet playback:
nu scripts/hw-probe/probes.nu cpu --samples 20 --interval 500ms

# A/D — navy-stage / black-frame scan across a stop/minimize/restore transition.
# Start the transition when it prompts:
nu scripts/hw-probe/luminance.nu transition --samples 8 --interval 400ms
#   add --crop 1280x720+320+180 to sample only the player rectangle

# A/D/F — compare a live capture to ground truth extracted from the media:
nu scripts/hw-probe/luminance.nu ground-truth --src /path/movie.mkv --at 120

# G.1 — minimize/restore stress watchdog. Monitors log growth as a liveness
# heartbeat; a gap over the watchdog window = UI hang (skr2 class). Drive
# minimize/restore by hand, or pass --key to auto-send a keysym each interval:
nu scripts/hw-probe/probes.nu stress --duration 30sec --watchdog-ms 5000
```

### X11-only (run on an X11 session)

```bash
nu scripts/hw-probe/geometry-x11.nu corner --screen-w 1920 --screen-h 1080  # E.2 popout snaps to a corner
nu scripts/hw-probe/geometry-x11.nu fullscreen                              # G.4 _NET_WM_STATE_FULLSCREEN
nu scripts/hw-probe/geometry-x11.nu snapshot --out before.json             # capture geometry, enter popout...
nu scripts/hw-probe/geometry-x11.nu snapshot --out after.json              # ...exit popout, capture again
nu scripts/hw-probe/geometry-x11.nu drift --before before.json --after after.json  # E.4 exact restore, 0 px

# E.3/G.3 — click/drag sweep across the app window (4 corners, 4 edge
# midpoints, interior center) + an edge drag-resize pass, then a
# process-liveness verdict (axj4.3 click-crash class). Self-driving via
# xdotool — don't touch the mouse while it runs. Wayland has no addressable
# per-window geometry for xdotool to target, so this stays a manual click/drag
# pass there per the plan (G.3):
nu scripts/hw-probe/probes.nu click-sweep
```

## Reading the report

`run.nu` prints a status table and writes `hw-probe-report.md` (gitignored):

```
| check | section | status | detail |
| first-frame-pairing | A.1-A.3 | PASS | arms=23 fires=23 drops=0 |
| sub-scale-values    | B.2-B.5 | PASS | n=283 out-of-range=0 |
| geometry-x11        | E.2/E.4/G.4 | SKIP | X11-only; this is wayland |
```

- **PASS/FAIL** — a verified invariant. FAIL exits non-zero.
- **SKIP** — not exercised (no sub-scale lines because subs never shown; no
  minimize→popout in the log for inset-clear; geometry on Wayland). A skip is a
  gap in coverage for that run, not a defect.

## What it would have caught

audio-over-navy (prexu-91t8), navy stages (prexu-hg1j), sub-scale wrongness
(prexu-91k4, via log values), a use-margins regression that leaves subs
rendering into the surface margin after restore (B.4), minimize/restore
deadlock (prexu-skr2), the PR #34 zombie process, E.4 popout geometry drift,
the popout-exit controls-reflow lag (prexu-uf4m — webview allocation trailing
the window resize),
and the axj4.3 click/drag crash class (E.3/G.3, via the click-sweep
process-liveness check).

## Self-test / CI enforcement

```bash
mise run hw-probe:selftest        # 61 assertions incl. 18 mutation checks
```

Each mutation assertion feeds a known-bad input (reveal re-emit on seek,
re-arm before fire, DMABUF disabled, sub-scale 1.42, restored-but-use-margins-
false, inset-clear absent when required, navy/black in a transition, RSS leak,
CPU pegged, slow first-play, defunct mpv, heartbeat gap, 3 px geometry drift,
popout-exit allocation gap over ceiling / exit with no following allocation,
click-sweep pid gone, click-sweep zombie present) and asserts the verdict
flips to `fail`. It runs in `mise run ci` and in GitHub Actions
(`hustcer/setup-nu` → `nu scripts/hw-probe/selftest.nu`).

## Extending

Add a log invariant: add a `MARK_*` const + a `check-*` function in `verdict.nu`
(pure, string-only), wire it into `assert-log` in `log-assert.nu`, and add a
good + a bad fixture under `fixtures/logs/` with matching assertions in
`selftest.nu`. **Verify the marker against a real `Prexu.log`** before trusting
it — several markers here were initially wrong because the same concept logs
differently across the events/compositor sides and across build history.
