# Linux on-hardware test plan (2026-07-04)

Consolidated verification plan for everything merged since the axj4.5 test
session, plus the still-open Linux verification items. Run with
`npm run tauri dev` against a real Plex server.

Covers: PR #36 (first-frame reveal, prexu-91t8), PR #37 (mini-player
subtitle scale, prexu-91k4), PR #39 (per-session mute, prexu-jphh),
PR #40 (instant transitions, prexu-hg1j), PR #41 (Linux popout,
prexu-axj4.10), and the open prexu-5jxx X11 sweep.

Sections H–N cover the perf & UX sweep epic (prexu-0szx, PRs #42–#48):
hls.js chunk split, streaming proxy, Linux mpv warmup + pump gate, relay
client reuse, ItemDetail caching + hover prefetch, library abort /
keep-prior-items / virtualization, boot waterfall + splash floor,
transition-spinner scoping, download toasts, and Dashboard render hygiene.
These are mostly cross-platform; run them in the same Wayland session as
A–E unless a step says otherwise.

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

## H. Startup & boot waterfall (PR #46, prexu-0szx.9)

1. Cold launch (app fully quit, then `npm run tauri dev` or the built binary).
   - Expect: splash screen holds ~0.7 s (was 2 s) plus fade; dashboard
     appears noticeably sooner. No flash of the login page when a valid
     session exists.
   - Log (debug): `[auth] boot waterfall settled` with `elapsedMs`,
     `valid`, `hasServer`, `hasUser` — note elapsedMs for comparison.
2. Launch with the network cable pulled / Wi-Fi off (plex.tv unreachable,
   LAN server unreachable).
   - Expect: same behavior as before the change — no half-authenticated
     state, no crash; the offline/error path renders as it did previously.
3. Launch with a revoked/expired token (if testable): must land on login,
   with no flash of dashboard content from the optimistic prefetch.

## I. Route transitions & spinner scoping (PR #46, prexu-0szx.8)

1. Navigate Dashboard → Library → a collection → back, quickly.
   - Expect: NO full-screen spinner overlay on any of these — cached pages
     paint immediately; slower pages may show their own skeletons, never
     the opaque navy overlay. (Old behavior: every navigation got a solid
     600 ms overlay.)
2. Exit the player (stop from normal playback).
   - Expect: unchanged from section D — last frame holds, dashboard
     replaces it directly. The player-exit overlay path is explicitly
     preserved; a navy stage reappearing here is a regression in the
     spinner scoping.
3. Deep-link entry (`prexu://` / Watch Together join) that lands on a
   `/play/` route and then returns.
   - Expect: leaving `/play/*` still shows the transition overlay (this is
     the one navigation class that keeps it, gap-hiding for player exit).

## J. ItemDetail cache, skeleton & hover prefetch (PRs #45/#48, prexu-0szx.3/.15)

1. Open any movie's detail page from a cold app start.
   - Expect: a detail-shaped skeleton (poster/title placeholders), not a
     bare centered spinner, then content.
2. Back to the library, immediately re-open the same item.
   - Expect: detail renders instantly from cache (no skeleton, no blank),
     refreshed in the background. (30 s TTL — within it, zero refetch
     flicker.)
3. Hover a poster card on Dashboard or Library for ≥150 ms without
   clicking, then click.
   - Expect: detail page renders instantly (cache warmed by hover).
   - Logs (debug): `[detail] hover-intent prefetch` on hover, then
     `warmItemDetailCache: prefetched` (or `already warm, skipping`); on
     the subsequent click the metadata fetch is a cache hit.
4. Sweep the cursor quickly across a whole shelf.
   - Expect: NO burst of prefetch log lines — only sustained (≥150 ms)
     hovers fire.
5. Kill the Plex server (or drop LAN) and open an uncached item: ErrorState
   now has a Retry button; restoring the network and clicking Retry loads
   the page without a full app reload.

## K. Library browsing: abort, keep-prior-items, virtualization (PRs #45/#47, prexu-0szx.5/.6/.7/.18)

1. In a large library (1000+ items), switch filters/sorts rapidly.
   - Expect: the grid keeps the previous items dimmed (aria-busy) until
     the new result set arrives — no blank-grid flash. Rapid switching
     must settle on the LAST selection (stale responses cancelled via
     AbortController, not raced).
2. Navigate away mid-load (enter a section, immediately go to Dashboard).
   - Expect: no console/log errors from aborted fetches; Dashboard loads
     without competing against orphaned full-section requests.
3. Open a playlist with hundreds of items; scroll fast.
   - Expect: smooth scrolling (rows virtualize); scroll position restores
     on back-nav.
4. CollectionsBrowser: type in the search box.
   - Expect: filtering debounced (~200 ms), no per-keystroke jank with
     hundreds of collections; alphabet jump still lands on the right
     letter (within a row).
5. Open a large collection (100+ items) in CollectionDetail; scroll.
   - Expect: rows appear as you scroll (virtualized); per-item metadata
     (cast strips, durations) loads for visible rows only — watch the
     network panel: ~10 metadata requests initially, not one per item.
6. Actor shelves on a movie detail page (prexu-0szx.4): open the same
   movie twice within ~10 min.
   - Expect: second visit renders actor shelves without refetching
     (session cache); shelves are capped at ~20 items per actor.

## L. Dashboard render hygiene (PR #47, prexu-0szx.13/.14)

1. Start playback of anything on ANOTHER client of the same server, then
   watch the Prexu Dashboard while idle.
   - Expect: dashboard cards do NOT re-render/flicker on the session
     poll cadence (React DevTools highlight-updates stays quiet on the
     shelves; scanning badges still animate when a library scan runs).
2. Poster cards still respond correctly: click → detail, right-click →
   context menu, hover → play button, expand arrow on shows.

## M. Download toasts (PR #46, prexu-0szx.16)

1. Start a download, navigate elsewhere in the app, let it finish.
   - Expect: a success toast names the item when it completes.
2. Kill the network mid-download and let retries exhaust.
   - Expect: exactly one failure toast AFTER the auto-retries exhaust
     (not one per retry attempt).
3. Cancel a download manually.
   - Expect: NO toast (user-initiated cancel is silent).

## N. Rust hot paths (PRs #43/#44, prexu-0szx.2/.10/.11/.12)

1. Play a large LOCAL downloaded file; seek near the end repeatedly.
   - Expect: app RSS stays flat (range requests stream; previously the
     file tail was buffered into RAM — watch for multi-hundred-MB jumps).
2. First playback after app start on Linux (mpv warmup, prexu-0szx.10).
   - Expect: first-play cold start noticeably faster than pre-#44 (mpv
     core pre-warmed at startup; compare against section A timings).
3. During steady playback, check CPU of the app process (pump gate,
   prexu-0szx.11).
   - Expect: idle-playback CPU lower than pre-#44 (no 60 Hz property
     polling; the pump wakes on mpv events).
4. Watch Together over the relay for several minutes (prexu-0szx.12).
   - Expect: no per-message connection churn (shared reqwest client);
     relay logs stay clean under sustained sync traffic.

## Pass criteria

- A–E all pass on Wayland; F recorded (pass or gap list) on X11.
- H–N all pass in the same Wayland session (they're mostly
  cross-platform; N.2/N.3 are Linux-specific).
- No audio without video, no navy stages in transitions, no window
  geometry drift across popout cycles, no crash/abort anywhere.
- No blank-grid flashes, no full-screen spinner on ordinary navigation,
  no memory growth on local-file seeks, no card-list re-render churn
  while remote sessions play.
- File anything that fails as a bd bug referencing the section letter
  (e.g. "linux-test-plan E.4 popout drift") so fixes trace back here.
