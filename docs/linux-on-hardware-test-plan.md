# Linux on-hardware test plan (2026-07-04)

Consolidated verification plan for everything merged since the axj4.5 test
session, plus the still-open Linux verification items. Run with
`npm run tauri dev` against a real Plex server.

Covers: PR #36 (first-frame reveal, prexu-91t8), PR #37 (mini-player
subtitle scale, prexu-91k4), PR #39 (per-session mute, prexu-jphh),
PR #40 (instant transitions, prexu-hg1j), PR #41 (Linux popout,
prexu-axj4.10), and the open prexu-5jxx X11 sweep.

## Pre-flight

1. Session type matters — run sections A–E on your normal **Wayland**
   session; section F needs an **X11** login. Popout (section E) has
   different expectations per backend, marked inline.
2. Do **NOT** set `WEBKIT_DISABLE_DMABUF_RENDERER` — the native player's
   transparent-webview compositing requires the DMABUF renderer. Startup
   logs `[player:linux] WebKit DMABUF renderer enabled (default)` when
   correct, and warns loudly if the env var is set.
3. Native engine should be active (Settings toggle on, `libmpv.so`
   present). Startup log: `[player:linux] compositor installed`.
4. Have at least one show with ≥2 episodes (handoff tests) and one item
   with text subtitles (SRT/embedded) for section B.
5. Dev builds log debug+trace. Grep tags used below: `[player:events]`,
   `[player:linux]`, `[player:popout]`, `player:transparent`,
   `player:minimize`, `player:popout` (TS side logs via the same file).

## A. Load reveal — first frame, not PlaybackRestart (PR #36)

1. Play any movie from cold (no player open).
   - Expect: loading screen holds until video appears; **no audible audio
     over the navy background** at any point. Audio and first video frame
     arrive together.
   - Logs, in order:
     `[player:events] first PlaybackRestart → arming compositor first-frame reveal`
     then `[player:linux] first frame rendered after arm → player://host-window-ready`.
     The gap between the two is the gap the fix removed (was ~0.5–1 s of
     audio-over-navy).
2. Episode handoff: let an episode reach EOF and auto-advance (or use
   Next). The soft-stop keeps mpv alive.
   - Expect: the same arm → rendered pair fires again for the new file;
     no audio-over-navy between episodes.
3. Seek several times mid-playback.
   - Expect: NO additional `host-window-ready` emits (one reveal per load;
     seeks log PlaybackRestart internally but must not re-arm).

## B. Mini-player subtitle scale (PR #37)

1. Play something with text subtitles enabled at default style (100%).
2. Minimize the player (mini corner mode).
   - Expect: subtitle text scales down proportionally with the mini video
     — readable-small, fully inside the mini rect, no clipping at the rect
     edge, not rendered outside the mini area.
   - Log: `[player:linux] video-margin-ratio applied ... sub-scale=0.2–0.4 sub-use-margins=false`
     (exact scale = mini height / window height).
3. Resize the main window while minimized (drag a corner).
   - Expect: subs stay proportional to the mini rect as ratios recompute.
4. Restore to full player.
   - Expect: subs return to full size (`sub-scale=1.0000 sub-use-margins=true`).
5. Set subtitle size to 150% in Settings, repeat 2–4.
   - Expect: mini subs are 1.5× the step-2 size but still proportional —
     the user style multiplies, never replaces, the mini compensation.

## C. Mute scope — per-session by design (PR #39 reverting #38)

1. Mute (M) during playback, let the episode auto-advance.
   - Expect: next episode starts **muted** (in-session handoff keeps mute).
2. Mute, then STOP playback (exit the player). Play any item again.
   - Expect: new session starts **unmuted** — this is the designed
     behavior (bd memory `player-mute-scope-decision`), reversing what the
     old A3 plan expected.
3. While muted, raise volume via the slider.
   - Expect: auto-unmute (volume > 0 unmutes), audio resumes.

## D. Instant transitions (PR #40)

1. Exit: click stop from normal playback.
   - Expect: last video frame holds briefly, then the dashboard replaces
     it directly. **No navy stage** between video and dashboard. Total
     should feel instant (<~300 ms to dashboard), vs the old ~2 s
     (frame → navy → dashboard).
   - If a residual delay remains, note WHERE it sits (frame hold vs
     dashboard paint) — next step per prexu-hg1j notes is instrumenting
     `player_unload` IPC duration.
2. Minimize → expand: minimize, then click the mini player to restore.
   - Expect: the mini video expands in place to full size — no navy
     stage, no ~1 s hold. Log: `restore IPC done (optimistic flip already applied)`.
3. Enter minimize: full → mini.
   - Expect: unchanged from before (this direction was already optimistic)
     — video shrinks into the corner without flashing.
4. Exit while minimized: stop playback from the mini player.
   - Expect: mini player disappears, dashboard immediately usable, margins
     don't leak into the next playback (start another item; video fills
     the window from the start).

## E. Popout (PR #41) — run on BOTH backends where marked

1. Popout button appears in the player controls on Linux native (it was
   gated off before).
2. Enter popout.
   - **X11**: window shrinks to the persisted corner (default
     bottom-right, 480×270), undecorated, always-on-top over other apps.
   - **Wayland**: window shrinks **in place** (no programmatic placement
     in the protocol), undecorated. NOT pinned on top — pin it via the
     compositor's window menu if wanted. This is expected, not a bug.
   - Both: video fills the popout, controls chrome works, the top drag
     strip appears on hover and drags the window.
3. Edge drag-resize the undecorated popout window.
   - Expect: resizing works (wry's undecorated-resize handler). **Watch
     for any click-crash here** — this path exercises the same
     grandparent-downcast that SIGABRT'd during axj4.3 (fixed by the
     overlay reparent; a regression would abort the whole app).
4. Drag the popout somewhere else, resize it, then exit popout.
   - Expect: main window restores to its exact pre-popout position/size,
     decorated. Repeat enter/exit a few times — the window must NOT grow
     or drift by a few px per cycle (the stash uses inner-size round-trip
     to prevent exactly that).
   - X11: re-enter popout — it should reopen at the size you left it and
     snap to the nearest corner you dragged it to. Wayland: size persists;
     corner is not tracked (no coordinates).
5. Minimize → popout: enter minimize, then trigger popout.
   - Expect: mini margins clear (video fills the popout window, no inset
     ghost). Log: `[player:popout] clearing leftover minimize inset on enter`.
6. Exit the player entirely while popped out.
   - Expect: lifecycle exits popout FIRST (window restores to full
     pre-popout geometry) and then the dashboard appears at normal size.

## F. X11 session sweep (prexu-5jxx — still open)

Log into an X11 session and repeat a compressed pass:

1. Startup: check the resolver log line
   `[player:linux] GL proc resolver ready: primary=...` — note whether
   EGL or GLX resolved (X11 may use either; GLX exercises the fallback).
2. Play a movie: video renders, seek works, controls fade in/out.
3. Resize/maximize/restore during playback — no stale bands or black.
4. Minimize mode + subs (quick repeat of B.2).
5. Popout with full corner-placement expectations (E.2–E.4, X11 rows).
6. Note DMABUF behavior differences, if any (webkit may pick a different
   renderer under X11 — capture the startup log block).
7. Record results on prexu-5jxx (close it if everything passes).

## G. Regression spot-checks (previous session's fixes)

1. Minimize → restore repeatedly during playback (~5 cycles, some while
   paused): no deadlock/freeze (prexu-skr2 / PR #35 class).
2. Exit the app entirely during playback (window close button): app exits
   promptly, no zombie process (PR #34 class).
3. Left-click all over the UI (drag strips, video area, menus): no
   process abort (axj4.3 reparent SIGABRT class).
4. Fullscreen toggle (F / button / double-click) in normal + popout modes.
5. EOF → postplay → next episode flow still advances.

## Pass criteria

- A–E all pass on Wayland; F recorded (pass or gap list) on X11.
- No audio without video, no navy stages in transitions, no window
  geometry drift across popout cycles, no crash/abort anywhere.
- File anything that fails as a bd bug referencing the section letter
  (e.g. "linux-test-plan E.4 popout drift") so fixes trace back here.
