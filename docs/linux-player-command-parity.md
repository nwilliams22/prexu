# Linux native player command parity

Audit: 2026-11-06, `prexu-axj4.5`. This is a command inventory and bounded
acceptance record, not a claim that every native feature passes. Registry:
`src-tauri/src/lib.rs`; implementation: `src-tauri/src/player/commands/`.
All 23 distinct registered `player_*` commands have one row below.

## Runtime and evidence

Frontend/source revision: `c415830`. Existing debug executable (not rebuilt in
this audit) SHA-256:
`98891b6ef484080c86bcd69507a9603163cb5cc7505c8ef03f2dc98f21c1ca27`.
Its exact source revision is not established by its timestamp. Source mappings
below describe the audited checkout; runtime results describe this executable.

Host: bd-server, Xvfb `:96`, 1280×800, X11, Mesa software GL, isolated profile,
session D-Bus, Vite port 1420, dedicated Prexu QA Test Server. Fixture:
**Prexu QA Pattern**, ratingKey 2, H.264/AAC stereo, 60.022 seconds.
No real GPU, audio sink, Wayland compositor or multi-monitor acceptance occurred.
The GPU/audio waiver remains unchanged.

The baseline system `/lib/x86_64-linux-gnu/libmpv.so.2` produced black output
although first-frame events fired. This matches the previously repaired
`prexu-qi6r` class of failure; it is not a fresh root-cause determination.
The repeated run used the same executable with `LD_LIBRARY_PATH` pointing to
the checksum-verified patched library from the BAD-292 runtime attachment:
`bd8fbceb286353c0069fbfc007e307052966f8d0a771b5f39c6a5dc918c721c1`.
All five entries in that bundle's `SHA256SUMS` passed. Pattern frames were then
visible on both loads. Do not apply these results to the baseline system library.

Launch: check `ss -ltnp | grep -E '1420|:8'` first; then run
`scripts/qa-desktop-session.sh start` in `dbus-run-session` with
`QA_DISPLAY=:96 QA_GEOMETRY=1280x800 QA_XSERVER=xvfb VITE_PORT=1420`, isolated
XDG paths, and the patched library path. Capture with the script's `shot --root`.
The same display/port were used for `stop`; both session holders were terminated.
No port 1420 listener remained. Evidence is attached to BAD-338 as
`linux-command-parity-evidence.tar.gz`, including sanitized `command-session.log`
and numbered screenshots. Raw logs and credentials are excluded.

## Reproduction steps and verdict vocabulary

- **S1:** Movies → Pattern → Play. Pause with Space, Right to seek, Down to
  reduce volume, M to mute, N to select light normalization. Resume with Space.
- **S2 / M6:** Minimize via lower-right overlapping-window control; resume in
  mini, then click Restore. Visible full-frame video returned. The restore
  request was at 05:08:43 UTC, completion at 05:08:45. This passes recovery,
  not a sub-300 ms latency target. Screenshots 17 and 18.
- **S3 / M7 and A3:** While muted, minimize again, close the mini player,
  then Play Pattern again. Full-frame video returned (screenshot 19). Unload
  at 05:08:59; load at 05:09:02; reveal restored `set_muted false`. This is
  the designed **new-session reset**, not a mute-persistence failure.
- **S4 / M8:** F on/off, F again, minimize, drag mini from bottom-right to
  top-left, Restore, F off. `actual_fs=true/false` and completion events
  arrived; full-size pixels returned and margins cleared. Screenshots 20–21
  and the subsequent full-frame capture 24. Xvfb has no desktop window manager:
  this proves application state/geometry recovery, not desktop fullscreen policy.
- **S5:** Pop out from restored playback; exit with top-right popout button.
  Geometry changed 1280×800 → 480×270 → 1280×800 with visible Pattern pixels.
  Screenshots 22–24, exit log at 05:10:25.
- **S6:** `npx vitest run src/hooks/player/useNativePlayer.test.ts`: exit 0,
  **1 file, 30 tests passed**. Includes fresh-session mute reset, reveal mute,
  repeated-load rearming, dispatch and fallback contracts. Mocked IPC tests
  do not establish libmpv rendering, audible output or server receipt.

**PASS** means the specific software-GL observation stated in the row passed.
**PARTIAL** means dispatch or a restricted path was observed, but the named
acceptance behavior remains unverified. **UNVERIFIED** means no runtime exercise.
None of these labels silently upgrades historical evidence to a fresh pass.

## Command → libmpv mapping

| Tauri command | Linux mapping | Verdict and producing step |
| --- | --- | --- |
| `player_engine_status` | Compositor failure state; no mpv property write | PASS S1: `available=true reason=None`; native pixels subsequently visible. Failure path covered only by S6 mocks. |
| `player_load_url` | HTTP headers; Linux reveal `mute=true`; version-aware `loadfile` with resume offset; `pause=false` | PASS S1/S3 for two zero-offset Pattern loads with first-frame reveal. Nonzero resume/header variants not exercised. |
| `player_play` | `pause=false` | PASS S1/S2: command and advancing Pattern timestamp after resume. |
| `player_pause` | `pause=true` | PASS S1: paused event and stationary visible timestamp. |
| `player_seek` | `seek <seconds> absolute` | PASS S1: `seek to 11.708s` at 05:07:20 and matching visible Pattern timestamp. |
| `player_set_volume` | `volume` (u16 converted to f64) | PARTIAL S1: 100 → 90 command at 05:07:20; audible gain not tested. |
| `player_set_muted` | `mute` boolean | PASS for command/state S1/S3: true while playing; new load restores false. S6 covers reveal intent; live muted episode handoff and audible silence remain unverified. |
| `player_set_audio_track` | `aid=<id>` or `aid=no` | PARTIAL S1: default `Some(1)` applied at 05:07:03; alternate-track output not tested. |
| `player_set_sub_track` | `sid=<id>` or `sid=no` | PARTIAL S1: `None` applied at 05:07:03; selected subtitle rendering not tested. |
| `player_load_external_sub` | `sub-add <quoted URL> select` | UNVERIFIED: Pattern had no external subtitle selected; source mapping only. |
| `player_set_audio_delay_ms` | `audio-delay=ms/1000` seconds | PARTIAL S1: default 0 ms dispatched; nonzero audible synchronization not tested. |
| `player_apply_sub_style` | `sub-font`, `sub-font-size`, `sub-color`, `sub-border-color`, `sub-border-size`, `sub-back-color`, `sub-shadow-offset` | PARTIAL S1: default style applied; no selected subtitles to judge appearance. Does not write `sub-scale`. |
| `player_set_af_chain` | `af`: empty, loudnorm (light), or acompressor+loudnorm (night) | PARTIAL S1: off and light dispatched; audible normalization not tested. |
| `player_set_timeline_context` | Stores Plex close-report context; teardown reads mpv time/state | PARTIAL S1/S3: context for ratingKey 2/duration 60022 received; independent Plex timeline receipt not checked. |
| `player_clear_timeline_context` | Clears stored context; no mpv property write | PARTIAL S1/S3: command observed in cleanup; duplicate-report prevention not independently checked at server. |
| `player_stop` | `mute=true`, `pause=false`, `stop`; retains handle | PARTIAL: cleanup dispatch observed; same-handle episode continuation not run (S6 is mocked). |
| `player_unload` | Synchronous mute/pause/stop/quit; asynchronous pump/render/handle teardown | PASS S3: exit returned to detail page and next load rendered full-frame. Audible cessation and app-close races not measured. |
| `player_set_fullscreen` | Tauri main-window fullscreen, actual-state event; compositor follows allocation; not mpv `fullscreen` | PASS S4 for application state/recovery; real window-manager transitions unverified. |
| `player_enter_minimize` | Stored inset → `video-margin-ratio-*`; compositor subtitle scale/use-margins compensation; busy/ready | PASS S2/S3/S4: visible bounded mini; subtitle scaling unverified without subtitles. |
| `player_update_mini_geometry` | Recomputes same margin ratios without transition busy/ready | PASS S4: anchor drag logged `TopLeft`, screenshot 21 shows video there. |
| `player_exit_minimize` | Clears inset and all four video margins; restores subtitle compensation; busy/ready | PASS S2/S4: full-frame restore, IPC resolves; no frozen mini state. |
| `player_enter_popout` | Clears mini margins as needed; resizes/repositions Tauri window; subtitle-safe bottom margin | PASS S5 on Xvfb for 480×270 visible popout. Wayland placement/keep-above untested. |
| `player_exit_popout` | Clears margins; restores saved Tauri geometry, decoration/min-size state | PASS S5: logged and visible 1280×800 recovery. |

Playback **rate** is separately required by the bead text but has **no registered
command or hook control** in this checkout. A registry audit and search of
`src/hooks/player` found no `playbackRate`/`setPlaybackRate` implementation.
There is therefore no application mapping to mpv `speed` to certify. This is
`prexu-3bd2`, not a successful playback-control result.

Plex timeline reporting is not an mpv command: observed time/duration/pause
properties feed the frontend reporting hooks, with the stored Rust context as
close-time fallback. Invocation of context setters alone does not prove reporting.

## Historical corrections and remaining gates

The old July summary is superseded by two later Beads records:

- `prexu-skr2` closed 2026-07-03 after the owner verified M6, M7 and M8. Its
  confirmed deadlock fix uses `render_no_block` (BLOCK_FOR_TARGET_TIME=0).
  The fresh checks above corroborate recovery only in the stated Xvfb runtime.
- `prexu-jphh` closed 2026-07-04: stop → play deliberately starts unmuted;
  PR #39 reverted persistence. The corrected A3 is PASS for new-session reset
  (S3/S6), with live same-session handoff still UNVERIFIED (S6 contract passes).

`prexu-axj4.5` remains blocked on **prexu-3bd2** (missing rate requirement)
and **prexu-hui3** (remaining runtime track/subtitle/delay/handoff/timeline
coverage). Both name Duncan as owner and contain concrete closure conditions.
This audit completes the inventory; it does not close feature parity.

`prexu-axj4.8` is **not closeable**: it retains its feature-parity prerequisite
and the named defects above. The earlier [codec record](linux-native-codec-qa.md)
contains source-selection evidence, not per-codec visible/audio acceptance or
independent server-session confirmation; it is not upgraded by this Pattern run.

`prexu-axj4.9` is **not closeable**: it retains the same named parity blockers.
Its previous full-gate results remain dated evidence in the codec record; this
run executed only S6 and the command-inventory check. No fresh full-gate pass is
claimed. After the blockers close, rerun its specified TypeScript, Vitest,
desktop/relay clippy and clean Linux build gates before closing it.
