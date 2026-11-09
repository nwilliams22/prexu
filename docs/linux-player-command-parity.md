# Linux native player command parity

Audit: 2026-11-06; parity follow-up: 2026-11-09, `prexu-axj4.5`. This is a command inventory and bounded
acceptance record, not a claim that every native feature passes. Registry:
`src-tauri/src/lib.rs`; implementation: `src-tauri/src/player/commands/`.
All 24 distinct registered `player_*` commands have one row below.

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
| `player_set_muted` | `mute` boolean | PASS R3: same-hook episode handoff retained `mute=true` after reveal; new mounts reset intent. Audible silence remains outside this null-audio run. |
| `player_set_audio_track` | `aid=<id>` or `aid=no` | PASS R1 for selection: live `aid=2` after choosing the second real PCM track. Audible frequency/output not measured (null audio). |
| `player_set_sub_track` | `sid=<id>` or `sid=no` | PASS R1: live `sid=1`, visible embedded CUE ONE at 2 seconds. |
| `player_load_external_sub` | `sub-add <quoted URL> select` | PASS R2: direct registered command added the HTTP SRT, live `sid=2`, visible EXTERNAL PARITY CUE. |
| `player_set_audio_delay_ms` | `audio-delay=ms/1000` seconds | PASS R2 for property: 250 ms became live `audio-delay=0.25`. Audible synchronization remains outside this null-audio run. |
| `player_apply_sub_style` | `sub-font`, `sub-font-size`, `sub-color`, `sub-border-color`, `sub-border-size`, `sub-back-color`, `sub-shadow-offset` | PASS R2: 150% size and yellow text visibly changed embedded and external cues. Does not write `sub-scale`; full-app baseline layout not tested by this harness. |
| `player_set_af_chain` | `af`: empty, loudnorm (light), or acompressor+loudnorm (night) | PARTIAL S1: off and light dispatched; audible normalization not tested. |
| `player_set_timeline_context` | Stores Plex close-report context; teardown reads mpv time/state | PASS R4 for protocol receipt: independent HTTP receiver recorded playing/stopped state, ratingKey, time and duration. Synthetic Plex-protocol sink, not actual PMS receipt or close-window fallback acceptance. |
| `player_clear_timeline_context` | Clears stored context; no mpv property write | PASS R4 for cleanup dispatch and independently received stopped state. Window-close duplicate suppression is not certified. |
| `player_stop` | `mute=true`, `pause=false`, `stop`; retains handle | PASS R3: episode-2 loaded in the same hook session; explicit soft-stop retained initialized handle with idle=true, mute=true and no time-pos. |
| `player_unload` | Synchronous mute/pause/stop/quit; asynchronous pump/render/handle teardown | PASS S3: exit returned to detail page and next load rendered full-frame. Audible cessation and app-close races not measured. |
| `player_set_fullscreen` | Tauri main-window fullscreen, actual-state event; compositor follows allocation; not mpv `fullscreen` | PASS S4 for application state/recovery; real window-manager transitions unverified. |
| `player_enter_minimize` | Stored inset → `video-margin-ratio-*`; compositor subtitle scale/use-margins compensation; busy/ready | PASS S2/S3/S4: visible bounded mini; subtitle scaling unverified without subtitles. |
| `player_update_mini_geometry` | Recomputes same margin ratios without transition busy/ready | PASS S4: anchor drag logged `TopLeft`, screenshot 21 shows video there. |
| `player_exit_minimize` | Clears inset and all four video margins; restores subtitle compensation; busy/ready | PASS S2/S4: full-frame restore, IPC resolves; no frozen mini state. |
| `player_enter_popout` | Clears mini margins as needed; resizes/repositions Tauri window; subtitle-safe bottom margin | PASS S5 on Xvfb for 480×270 visible popout. Wayland placement/keep-above untested. |
| `player_exit_popout` | Clears margins; restores saved Tauri geometry, decoration/min-size state | PASS S5: logged and visible 1280×800 recovery. |
| `player_set_playback_rate` | Validates finite 0.5–2; writes mpv `speed` | PASS R5: production hook reached native `speed=2`; same-session handoff retained it. Real libmpv clock measured 0.500/1.000/2.000×; HTML5 measured 0.500/1.000/2.000×. |

The common hook exposes `playbackRate` / `setPlaybackRate`; the controls bar
selects 0.5–2× (compact widths use the existing More menu). HTML5 writes both
`defaultPlaybackRate` and `playbackRate`. Both engines retain rate across media
handoffs and reset to 1× on a new hook mount. Invalid rates are ignored by the
hooks and rejected by the Rust command. Native IPC failure restores the last
confirmed rate in the selector.

## 2026-11-09 runtime follow-up

Rebuilt debug executable SHA-256:
`914bc11d7e5b14dad394e5eaf3bd1a25671b0181390c901f6ae85f46d4142fd4`.
Build base was `663250e` plus this change's native command/probe additions.
Library: the same checksum-verified patched libmpv above. Xvfb `:96`, 1280×800,
software GL; ALSA null output enabled audio-track selection, **not audible
acceptance**. The GPU/audio waiver is unchanged.

Evidence: BAD-357 attachment `linux-parity-evidence.tar.gz` (attachment ID
`ecf3a3ff-bbf8-458f-9239-a2aaa16dc687`, SHA-256
`a9625373c6770fb7b403b115f297cf816f2eba9b6a60352954b185e8359ba197`).
Includes sanitized logs, screenshots, raw observations (including unsuccessful
exploratory measurements), fixture manifest, harness sources and reproduction
instructions. The harness rendered the production hooks and controls using
synthetic auth; it did not exercise full application navigation. The generated
`av-cues-v1` fixture has real selectable 440/880 Hz PCM tracks and embedded SRT.

- **R1:** Pause, seek 2 s, select Plex audio stream 3 and subtitle stream 4.
  Read-only native snapshot returned `audioTrack=2`, `subtitleTrack=1`.
  `embedded.png` shows white CUE ONE.
- **R2:** Apply 150% yellow subtitle style and 250 ms audio offset. Snapshot
  returned `audioDelay=0.25`; `styled.png` shows larger yellow CUE ONE.
  Invoke external subtitle command against the fixture SRT; snapshot returned
  `subtitleTrack=2`, and `external.png` shows EXTERNAL PARITY CUE. The harness's
  always-visible bottom bar overlaps the cue baseline; this is not a full-app
  subtitle-layout result.
- **R3:** Select 2×, mute, change ratingKey to episode-2 without remounting the
  production hook. Native snapshot after the load: `muted=true`, `playbackRate=2`,
  `idle=false`. Then `player_stop`: `initialized=true`, `idle=true`, `muted=true`,
  `positionMs=null`. This exercises same-session handoff/soft-stop, not queue
  navigation. Unload then produced `initialized=false`.
- **R4:** The separate HTTP handler recorded `playing` for av-cues-v1 at 8400 ms
  and `stopped` for both av-cues-v1 and episode-2, duration 15000 ms. Only those
  allowlisted fields were recorded. This proves Plex-protocol request receipt at
  the fixture sink; actual Plex Media Server/account integration is not claimed.
- **R5:** Native production-hook readback returned `speed=2`. Independent real
  libmpv null-output test (`cargo test --manifest-path src-tauri/Cargo.toml
  --test playback_rate -- --ignored --nocapture`, with the patched library)
  measured 1/2/4 seconds of media over two seconds at 0.5/1/2×; one test passed.
  HTML5 production-hook timing with silent H.264 media measured 0.499891,
  1.000251 and 1.999529×. Native JavaScript timing samples are **invalid** because
  delayed WebKit IPC responses skew their elapsed interval; retained raw
  measurements are not passes. Native playback logs also show the 15-second
  fixture reaching EOF about seven seconds after 2× play.
- Focused Vitest checks cover both hooks, invalid inputs, deferred native rate,
  IPC rejection, handoff/new-session reset and selector dispatch. The debug
  native build and TypeScript check passed. The additional libmpv clock test is
  explicitly opt-in and does not claim hardware rendering or sound.

Both desktop sessions used `qa-desktop-session.sh`; ports were checked before
start, and stop used the same display/port. The fixture listener, Vite, Xvfb and
D-Bus holders were stopped. Temporary index entry changes were restored.

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
  (S3/S6), with live same-session handoff now confirmed by R3.

The scoped runtime gaps in `prexu-hui3` and rate requirement in `prexu-3bd2`
are resolved by R1–R5 and the committed tests. `prexu-axj4.5` can close on this
bounded command/state/visible-subtitle evidence. Hardware sound, GPU, Wayland,
and full navigation acceptance are not implied by closure.

This removes feature parity as a blocker for `prexu-axj4.8` and
`prexu-axj4.9`. Neither successor was run here; codec verification and the final
validation gates still require their own evidence. The earlier
[codec record](linux-native-codec-qa.md) remains historical, not a fresh native
codec acceptance result.
