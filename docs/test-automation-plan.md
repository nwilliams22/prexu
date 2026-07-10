# Test automation plan — retiring the manual on-hardware surface

Status: proposed (2026-07-06). Companion to
`docs/linux-on-hardware-test-plan.md` (the manual plan this document aims to
shrink). Scope: everything runnable before the hardware pass — Vitest/RTL,
Playwright, Rust tests, CI jobs — plus semi-automated on-hardware scripts for
what only a real compositor + GPU can verify.

## Executive summary

The manual plan has 64 numbered steps across 15 sections (Pre-flight, A–N).
Audit result:

- The **logic** behind most native-player sections is already unit-tested in
  Rust (first-frame gate, subtitle compensation, popout snap/sanitize/retry,
  proxy range math, pump gate) — but the **wiring and visuals** are not, and
  a whole Rust test module (`src-tauri/src/player/mod.rs`, incl. the popout
  geometry stash round-trip and minimize-inset-clear tests) is
  `#[cfg(windows)]`-gated, so it never runs for the Linux target the manual
  plan exists for.
- The seven-plus manual validation rounds of the resume-label saga
  (PRs #50→#87) were all **seam bugs**: real cache + real event bus + mounted
  hooks + memoized component chains. Every module involved had passing
  isolated unit tests the whole time. Real-event coverage now stops at the
  hook layer; no test mounts the consumer *surfaces* (hero resume label,
  episode rows, popover-through-click-handler) over the real bus.
- Playwright covers page-shape flows (14 specs, ~150 tests) but none of the
  behaviors that regressed recently: page-level transition-overlay scoping
  (hook is tested; the wiring regressed anyway in the run-up to PR #75),
  back/POP restoration (zero coverage, and `useScrollRestoration` has no
  tests at all), library filter races against delayed responses, hover
  prefetch.
- `mise run ci` is a strictly weaker gate than `.github/workflows/ci.yml`:
  it runs **no Rust tests at all** (no relay `cargo test`/clippy, no
  src-tauri `cargo test`/clippy/build).
- No on-hardware scripts exist. The luminance-verification idea
  (screenshot → ImageMagick mean luminance vs ffmpeg ground truth) appears
  only as prose (`src-tauri/src/lib.rs:492` records a manual result).
  Building it plus a structured-log assertion runner converts most of
  sections A, D, F, G and N from eyeballing into a one-command
  semi-automated pass.

Hard constraints honored throughout (verified project history, not re-argued
here):

- tauri-driver/WebDriver E2E is a no-go for native player behaviors — mpv
  renders into a native surface with no DOM; geometry/transparency/
  fullscreen are not WebDriver-assertable (decided prexu-g8a.5). Native
  visuals stay manual or move to on-hardware scripts.
- `e2e/mock-tauri.ts` must never set `window.__TAURI_INTERNALS__` — the
  `isTauriRuntime()` guards in `backends.ts`/`downloads.ts` key off it, and
  setting it once produced 48 fake-passing tests. Any future invoke/event
  shim must work without that global (see W12).
- jsdom v28+ needs the localStorage polyfill in `src/__tests__/setup.ts`.

## What already runs in CI (`.github/workflows/ci.yml`)

| Job | Runner | Steps |
| --- | --- | --- |
| `ci` | ubuntu-latest | oxlint, `tsc --noEmit`, `vitest run` (190 test files), relay clippy `-D warnings`, relay `cargo test` (WS integration suite, `relay-server/tests/integration.rs`), Playwright chromium (14 specs, ~150 tests) |
| `headless-mpv` | windows-latest | src-tauri clippy, `cargo test --test headless_mpv` — real libmpv signal chain init → FileLoaded → duration → eof-reached (`src-tauri/tests/headless_mpv.rs`; the test body is Windows-only, a print-skip stub on Linux) |
| `linux-build` | ubuntu-22.04 | frontend build, src-tauri `cargo build` + `cargo test` with system libmpv |

Playwright runs against the Vite dev server with `e2e/auth-helpers.ts` route
interception; `e2e/mock-tauri.ts` stubs only the shell-open and log plugins.
There is **no invoke or event mock** — Tauri commands and events cannot
currently be simulated in browser E2E, which is why player/download flows
have no E2E coverage.

## Classification of the manual plan

Buckets: **(a)** already automated (citation) · **(b)** automatable in
Vitest/RTL integration · **(c)** automatable in Playwright (mock-tauri
browser build) · **(d)** automatable as a Rust test · **(e)** automatable
on-hardware via scripts (log-assertion runner, luminance pipeline, probes) ·
**(f)** genuinely manual.

Primary bucket per step; partial existing coverage cited inline. Test paths
are relative to the repo root; Rust test names cite the `#[cfg(test)]`
module in the same file.

| Step | What it verifies | Bucket | Existing coverage / automation route |
| --- | --- | --- | --- |
| Pre.1 | Wayland vs X11 session login | f | Environment setup; not automatable |
| Pre.2 | DMABUF renderer not disabled (startup log) | e | Log-assertion runner greps `[player:linux] WebKit DMABUF renderer enabled` (W2); also W13 Xvfb smoke |
| Pre.3 | Native engine active (`compositor installed` log) | e | Same runner (W2/W13) |
| Pre.4 | Test content present (2-ep show, text subs) | f | Fixture prep on the tester's server |
| Pre.5 | Log tags / dev log level | e | Subsumed by the log runner (W2) |
| A.1 | First-frame reveal: no audio-over-navy; arm→rendered log pair | e | Gate logic already (a): `src-tauri/src/player/events.rs` tests `first_frame_gate_*`; one-shot reveal: `linux_compositor.rs` `first_frame_reveal_is_one_shot_and_disarmable`. Audio/visual absence needs luminance + log-order script (W2) |
| A.2 | Handoff re-arms reveal, no navy between episodes | e | Partially (a): `first_frame_gate_simulates_file_lifecycle` covers FileLoaded-reset→re-arm. Full check via W2 |
| A.3 | Seeks do not re-emit host-window-ready | a | `events.rs` gate tests + one-shot consume test cover the invariant; W2 double-checks wiring on hardware |
| B.1 | Subs render at default style | f | Playback-visual setup step |
| B.2 | Mini mode scales subs, no clipping | e | Math already (a): `linux_compositor.rs` `sub_compensation_scales_by_mini_height_fraction`; `commands/minimize.rs` `margin_ratios_*` (Linux tests). Clipping/readability visual → W2 log-value check + eyeball |
| B.3 | Resize while minimized keeps subs proportional | e | Ratio math (a); recompute wiring via W2 log values |
| B.4 | Restore → sub-scale 1.0, use-margins true | a | `sub_compensation_defaults_when_not_minimized`; W2 confirms the applied log line |
| B.5 | User sub style multiplies mini compensation | d | Structural: user style drives `sub-font-size` (apply_sub_style), compensation drives `sub-scale` (`linux_compositor.rs:709-728`) — separate mpv properties that compose. Add a small Rust test pinning that apply_sub_style never writes `sub-scale` (W5 scope) |
| C.1 | Mute survives episode handoff in-session | a | `src/hooks/player/useNativePlayer.test.ts` "mute scope (prexu-jphh)" + reveal-mute suite (mute preserved across reveal) |
| C.2 | New session starts unmuted | a | Same file: "a fresh session starts unmuted even when the previous session ended muted" |
| C.3 | Volume > 0 auto-unmutes | b | Source implements it (`useNativePlayer.ts` setVolume auto-unmute path); no test — add to the same suite (W9) |
| D.1 | Stop → dashboard with no navy stage, ~instant | e | Overlay-keep logic (a): `useRouteTransitionSpinner.test.ts` player-exit path. Navy-stage absence + timing → luminance/timing script (W2) |
| D.2 | Minimize → expand with optimistic flip, no navy | e | Partially (a): `src/contexts/PlayerContext.test.tsx` optimistic Linux restore. Visual via W2 |
| D.3 | Enter minimize shrinks without flashing | e | Partially (a): PlayerContext minimize IPC tests. Visual via W2 |
| D.4 | Exit-while-minimized doesn't leak margins | d | Linux margin-state clearing partially (a): `popout.rs` linux tests (`set_minimize(None)` clears margin). Inset-clear state tests exist but are Windows-gated (`player/mod.rs`) — un-gate (W5); residual visual via W2 |
| E.1 | Popout button appears on Linux native | b | Partially (a): `usePopOutPlayer.test.ts` supported/unsupported. Add a ControlsBottomBar render assertion for the gate (W7 scope) |
| E.2 | Enter popout: corner/undecorated/on-top per backend | e | Placement logic (a): `popout.rs` `nearest_corner_*`, `corner_origin_*`, monitor-record round-trip. WM behavior → W2 probes (X11: xdotool/xprop geometry+state; Wayland: log assertions only) |
| E.3 | Edge drag-resize without click-crash (axj4.3 class) | e | Scripted X11 click/drag sweep + process-liveness check (W2); Wayland remains manual |
| E.4 | Exit restores exact geometry, no per-cycle drift | e | Stash decision logic (d→W5): `player/mod.rs` stash round-trip tests are Windows-gated. Px-exact inner-size round-trip needs live WM → W2 repeat-cycle probe comparing geometry |
| E.5 | Minimize → popout clears inset | d | Windows-gated test `popout_enter_clears_leftover_minimize_inset` — un-gate (W5); Linux margin variant already (a) (`popout_bottom_ratio_margin`); log line via W2 |
| E.6 | Exit player while popped out: popout-first ordering | e | Ordering already (a): `usePlayerLifecycle.test.ts` (popout-first exit). Window-restore visual via W2 |
| F.1 | GL proc resolver line (EGL/GLX) | e | Log runner on X11 (W2) |
| F.2 | X11 playback/seek/controls | e | Luminance probe + log runner (W2) |
| F.3 | Resize/maximize/restore, no stale bands | e | Luminance sampling across resize script (W2); judgment residual manual |
| F.4 | X11 mini mode + subs | e | Same as B.2 route |
| F.5 | X11 popout corner placement | e | W2 X11 geometry probes |
| F.6 | DMABUF renderer differences | e | Log capture (W2) |
| F.7 | Record results on prexu-5jxx | f | Tracker bookkeeping |
| G.1 | Minimize/restore stress, no deadlock (skr2 class) | e | Scripted stress driver + watchdog (W2) |
| G.2 | App exit, no zombie (PR #34 class) | e | Process-exit probe (W2); CI-side W13 Xvfb smoke covers start/quit |
| G.3 | Click sweep, no SIGABRT (axj4.3 class) | e | X11 xdotool sweep + liveness (W2); Wayland manual |
| G.4 | Fullscreen toggle in normal + popout | e | X11 xprop `_NET_WM_STATE_FULLSCREEN` probe (W2); visuals manual |
| G.5 | EOF → postplay → next advances | b | Signal chain (a) on Windows (`headless_mpv.rs`) — port to Linux (W6). UI chain eof→usePostPlay→PostPlayScreen not integration-tested (components are prop-driven pure tests) → W7 |
| H.1 | Splash floor, earlier dashboard, no login flash | b | SplashScreen fade timing (a) (`SplashScreen.test.tsx`); the App.tsx quorum waterfall + `{isLoading ? null}` login-flash gate have **no test** → W4 |
| H.2 | Offline launch: no half-auth state | b | Partially (a): `useAuth.test.ts`/`useAuth.reResolve.test.ts` (unreachable transitions). App-level rendering path → W4 |
| H.3 | Revoked token → login, no dashboard flash | b | Partially (a): `useAuth.test.ts` clears auth on invalid token, discards optimistic prefetch. Rendering gate → W4; Playwright 401-route variant optional |
| I.1 | No full-screen spinner on ordinary nav | a | `useRouteTransitionSpinner.test.ts` (incl. prexu-xb3h "no matter how much time passes"). Page-level wiring guard → W3 Playwright |
| I.2 | Player exit keeps the overlay | a | Same file (`/play/*` exit, 600 ms hold, stale reset) |
| I.3 | Deep-link `/play/` entry + return | f | Overlay-on-leave logic (a); `prexu://` OS registration/launch is manual |
| J.1 | Detail skeleton (not bare spinner) on cold load | c | `DetailSkeleton.test.tsx` renders the component; page-level delayed-response assertion → W3 |
| J.2 | Instant re-open from 30 s TTL cache | a | `useItemDetailData.test.ts` — real api-cache, warm instant paint, TTL stale-while-revalidate |
| J.3 | Hover-intent prefetch → instant detail | a | `PosterCard.hoverintent.test.tsx` (150 ms, sweep, unmount) + `useItemDetailData.test.ts` warm cache + `useDetailPrefetch.test.ts`. Full hover→navigate→hit chain also lands in W3 |
| J.4 | No prefetch burst on fast sweep | a | `PosterCard.hoverintent.test.tsx` quick-sweep case |
| J.5 | ErrorState Retry recovers without reload | b | `ErrorState.test.tsx` renders the button; the retry→refetch→render loop on a mounted detail page is untested → W1/W3 scope |
| K.1 | Filter/sort race: keep-prior dimmed, last wins | a | `usePaginatedLibrary.test.ts` (isStale keep-prior, generation guard last-selection-wins, per-range abort) + `LibraryView.test.tsx` aria-busy dim. Real-network-timing variant → W3 |
| K.2 | Navigate away mid-load: clean aborts | a | `usePaginatedLibrary.test.ts` abort-on-unmount; cross-page contention variant → W3 |
| K.3 | Playlist virtualization + scroll restore on back | c | `VirtualizedLibraryGrid.test.tsx` covers sparse slots/ranges but mocks `@tanstack/react-virtual`; `useScrollRestoration` has **zero tests** (mocked in every consumer) → W3 (Playwright POP) + W8 (hook tests) |
| K.4 | CollectionsBrowser debounce + alpha jump | a | `CollectionsBrowser.test.tsx` (debounced filter), `AlphaJumpBar.test.tsx`, `LibraryView.test.tsx` jump-to-offset landing |
| K.5 | CollectionDetail virtualization, visible-row metadata only | c | Range-driven fetch logic partially (a) (`VirtualizedLibraryGrid.test.tsx` onRangeChange); request-count assertion vs network → W3 |
| K.6 | Actor shelves session cache + 20-item cap | b | No test found for the actor-shelf session cache; add hook-level test (W1 scope) |
| L.1 | No card re-render on session poll; scan badges live | a | `PosterCard.memo.test.tsx` (explicit comparator, prexu-0szx.13/tqnq), `PosterCard.scanrender.test.tsx` (per-key scan store), `useServerActivity.test.tsx` (completionCounter no-re-render). Mounted-Dashboard-with-real-poll variant → W1 |
| L.2 | Poster interactions (click/context/hover/expand) | a | `PosterCard.test.tsx`, `ContextMenu.test.tsx`, e2e `dashboard.spec.ts` click-nav |
| M.1 | Success toast names the item | a | `useDownloads.test.tsx` (real queue/retry/toast logic, injected Tauri events) |
| M.2 | Exactly one failure toast after retries exhaust | a | Same file: backoff ×3 then single failure toast; no toast while auto-retry pending |
| M.3 | Cancel is silent | a | Same file: no toast on user-initiated cancel |
| N.1 | Flat RSS on local-file seeks | e | Bounded-copy logic (a): `src-tauri/src/lib.rs` proxy_tests (`parse_range` ×6, `stream_body` ×4). RSS measurement → W2 probe |
| N.2 | mpv warmup: faster first play | e | Warmup path untested (entangled with AppHandle); timing probe → W2; keep-warm regression guard possible in W6 |
| N.3 | Idle-playback CPU (pump gate) | e | Gate logic (a): `linux_compositor.rs` `should_pump_*` + `pump_gate_mirrors_setters_and_resets_to_quiescent`. CPU sampling → W2 |
| N.4 | Relay: no per-message connection churn | d | Architectural only today (`relay-server/src/state.rs` shared `reqwest::Client`); add counting-stub test (W11). Relay WS suite otherwise strong (`relay-server/tests/integration.rs`, 25 tests) |

### Bucket counts (primary classification per step)

| Bucket | Steps | Share |
| --- | --- | --- |
| (a) already automated | 17 | 27% |
| (b) Vitest/RTL integration | 8 | 12% |
| (c) Playwright | 3 | 5% |
| (d) Rust test | 4 | 6% |
| (e) on-hardware scripts | 27 | 42% |
| (f) genuinely manual | 5 | 8% |

Reading: 17 steps are already safe to skim rather than execute. The 27
(e)-steps are the heart of the manual burden — nearly all have their
*decision logic* unit-tested already, so a scripted hardware pass (W2) that
checks logs, luminance, geometry and process health retires the bulk of the
repetition while keeping a human for judgment calls. The 15 (b)+(c)+(d)
steps are pre-hardware CI material.

## The seam problem (why unit tests missed 7+ rounds)

The resume-label saga (PRs #50, #64, #66, #69, #72, #79, #81, #83, #85, #87)
fixed one staleness layer per round while every existing unit test passed:

1. module-listener lifetime — deck cache never invalidated while Dashboard
   was unmounted (#50)
2. unverified writes — stop beacon emitted success on non-2xx (#64)
3. cache-scope misses — item-detail cache not invalidated (#66), then
   timing races between refetch and PMS ingestion (#72, #79, #81)
4. **frozen mounted state/refs** — three separate layers where a
   viewOffset-only change triggers no re-render: `useItemDetailData` mounted
   state (#83), `useDashboard` onDeck state (#85), and `usePlayAction`'s
   `itemsRef` click-handler cache (#87, prexu-r8ib — the ref only refreshed
   when `getPlayHandler` ran during a render, so memoized cards served the
   play-start offset)

`cache-invalidators.test.ts` exercises the real cache and real bus but never
mounts a consumer; consumer component tests (`ResumePopover.test.tsx`,
`ItemHeroSection.test.tsx`, `EpisodeListSection.test.tsx`) are prop-driven
and never see an event. The fix-generation tests
(`useDashboard.watchStateIntegration.test.ts`, `useItemDetailData.test.ts`,
`usePlayAction.test.tsx`) now cover hooks over the real bus — the remaining
gap, and the pattern for all future features, is **surface-level
integration**: real cache + real invalidators + real bus + mounted page
surface + memoized card chain, asserting what the user sees.

The same pattern applies to two other seams:

- **Player lifecycle → chrome:** `player://*` listener wiring is tested in
  `useTransparentWindow.test.ts` and session state in
  `PlayerContext.test.tsx`, but no test runs eof → `usePostPlay` →
  `PostPlayScreen`/`NextEpisodePrompt` as one chain (G.5's UI half).
- **Router POP/restoration:** `useScrollRestoration` has zero tests and is
  mocked in all six consumer page tests; nothing covers back-nav
  restoration end to end (and a back-nav library-slowness issue is already
  on file).

## Local gate: `mise run ci` parity gaps

**Closed by W10 (prexu-pd1x.10).** `mise.toml`'s `ci` task now depends on
`lint`, `tsc`, `test`, `clippy-relay`, `test-relay`, `clippy-tauri`,
`test-tauri`, `e2e`, `hw-probe:selftest`. The Rust gate added:

1. `test-relay` — relay-server `cargo test` (WS integration suite guarding the
   keepalive-tick race prexu-waec and rate-limit flake prexu-3a78)
2. `clippy-relay` — relay-server `cargo clippy --all-targets -- -D warnings`
   (replaced the bare `cargo check`)
3. `test-tauri` — src-tauri `cargo test --lib` (excludes the libmpv-gated
   `headless_mpv` integration test; system `libmpv-dev`, see `docs/linux-dev.md`)
4. `clippy-tauri` — src-tauri `cargo clippy --all-targets -- -D warnings`,
   gated behind a `build` (dist bundle for `generate_context!`)

The src-tauri Rust tasks `depend` on a frontend `build`. Note: **Linux**
src-tauri clippy still runs nowhere in GitHub CI (only the Windows job clippies,
and it can't see `#[cfg(target_os = "linux")]` code) — W10 immediately caught an
`assertions_on_constants` lint in `popout.rs` that had been invisible. Adding
that clippy step to CI's `linux-build` job is a filed follow-up.

## Prioritized roadmap

Ordered by manual-effort retired per unit of work. Sizes are relative
(S/M/L); no time estimates.

### W1 — Watch-state surface integration suite (Vitest/RTL) — M

Mount real consumer **surfaces** (ItemDetail hero + episode rows, Dashboard
deck shelf with memoized PosterCards, play-button → ResumePopover via
`usePlayAction`) over the REAL `api-cache` + `cache-invalidators` +
`watch-state-events` bus; script play → stop → `emitWatchStateChanged` and
assert the *rendered* labels/popovers, including the no-re-render paths.
Extend `useDashboard.watchStateIntegration.test.ts`'s harness into a shared
`src/__tests__/integration/` helper. Include K.6 (actor-shelf session cache)
and J.5 (retry loop on mounted detail).
**Retires/hardens:** J.2/J.3/J.5, K.6, L.1 — and the entire recurring
revalidation class that consumed the 7+ rounds.
**Would have caught:** prexu-kwqe (#83), prexu-0fwh (#85), prexu-r8ib (#87
`itemsRef` staleness), prexu-tqnq (#69 memo comparator) — each manifested
only at the mounted-surface layer.

### W2 — On-hardware probe suite (`scripts/hw-probe`) — L

**Status: implemented (prexu-pd1x.2).** Delivered as `scripts/hw-probe/` (nushell)
+ `mise run hw-probe*` tasks + `docs/hw-probe-runbook.md`. Pure verdict core
(`verdict.nu`) is mutation-checked by `hw-probe:selftest` in CI; live probes run
on the dev box. Capture auto-falls-through grim→spectacle→import (grim has no
KDE support); geometry probes are X11-only per the plan. Validated against a real
`Prexu.log`: log/timing/zombie/luminance all green.

One command to run on the Linux box against a real Plex server (not CI).
Components: (1) structured-log assertion runner — ordered invariants from
`tauri-plugin-log` output (arm→rendered pair exactly once per load, no
re-emit on seek; `sub-scale`/`sub-use-margins` values per B; popout
inset-clear line; DMABUF/compositor/GL-resolver startup block); (2) the
luminance pipeline — screenshot (grim/spectacle) → ImageMagick mean
luminance vs ffmpeg-extracted ground truth, sampled across stop/minimize/
restore transitions to detect navy stages and black frames; (3) probes —
RSS sampling during a seek loop (N.1), CPU during steady playback (N.3),
first-play timing (N.2), app-exit zombie check (G.2), minimize/restore
stress driver with watchdog (G.1), X11 geometry/state probes via
xdotool/xprop for popout cycles (E.2–E.4, G.4) and click sweeps (E.3/G.3).
Wayland runs get log+luminance only; X11 runs add geometry probes.
**Retires:** the bulk of the 27 (e)-steps — sections A, D, most of B/E/F/G,
N.1–N.3 become a semi-automated pass with human review of a report.
**Would have caught:** prexu-91t8 audio-over-navy, prexu-hg1j navy stages,
prexu-91k4 sub-scale wrongness (log values), prexu-skr2 deadlock, PR #34
zombie process, E.4 popout drift.

### W3 — Playwright pack: transitions, POP, races — M

New specs against the existing mock-tauri browser build (no
`__TAURI_INTERNALS__`): (1) no full-screen overlay on ordinary nav
(page-level, complements the hook test); (2) back/POP navigation restores
library scroll position and grid state; (3) library filter/sort switching
against **delayed** route fulfillments — prior items stay dimmed, last
selection wins; (4) detail page shows skeleton (not spinner) under a delayed
metadata route; (5) hover-intent prefetch asserted via intercepted request
counts (sustained hover fires once; fast sweep fires none); (6)
CollectionDetail visible-row metadata request count (~10 initially, not
per-item).
**Retires:** J.1, K.3 (browser half), K.5; hardens I.1, K.1, K.2, J.3.
**Would have caught:** the PR #75 transition-overlay wiring regression, the
K.1 blank-grid/race class, the on-file back-nav library slowness.

### W4 — Boot waterfall integration tests (Vitest/RTL) — M

Test `App.tsx`'s boot logic directly (extract `AppRoutes` boot gate if
needed): quorum dismissal (2-of-3 prefetch settle), 20 s hard cap, splash
floor interaction, and the `{isLoading ? null : <Routes>}` login-flash gate,
with fake timers and controlled auth/prefetch promises — happy path, offline
(H.2), revoked token (H.3, asserting no dashboard flash from optimistic
prefetch).
**Retires:** H.1–H.3.
**Would have caught:** any regression in the prexu-0szx.9 waterfall — the
quorum/gating logic currently has zero tests.

### W5 — Un-gate Windows-only Rust state tests for Linux — S

`src-tauri/src/player/mod.rs`'s test module is
`#[cfg(all(test, target_os = "windows"))]`, yet much of `PlayerState` is
cross-platform: popout `pre_popout_geometry` stash round-trip, stash
consume-once, minimize-inset clear on popout enter, geometry throttle/flush.
Split the cfg so cross-platform state tests run in the `linux-build` CI job;
add the B.5 guard (apply_sub_style never writes `sub-scale`).
**Retires:** logic half of E.4/E.5/D.4 — today those invariants are only
verified by Windows CI while all the bugs ship on Linux.
**Would have caught:** any Linux-side stash/inset regression in the popout
rounds (PRs #65/#67/#77/#84 territory) at compile-test time.

### W6 — Linux headless mpv CI job — S

Port `src-tauri/tests/headless_mpv.rs` to also run on Linux with system
libmpv (`vo=null`/`ao=null` needs no display): drop the
`#[cfg(target_os = "windows")]` around the test body, run it (still
`--ignored`-gated) in the `linux-build` job.
**Retires:** G.5's signal-chain half on the shipping Linux target; guards
the A-section event chain against system-libmpv version drift (the Windows
job pins its own DLL and cannot see Linux-specific behavior).
**Would have caught:** Linux event-chain regressions of the prexu-0cs /
prexu-ta9 queue-advancement class.

### W7 — Player eof → postplay → next UI-chain integration (Vitest) — M

Drive the real chain: injected `player://` eof event (captured-handler
harness as in `useTransparentWindow.test.ts`) → `usePostPlay` →
`PostPlayScreen`/`NextEpisodePrompt` mounted → countdown → next-episode
load call. Add the E.1 popout-button gate assertion on ControlsBottomBar.
**Retires:** G.5's UI half; hardens E.1.
**Would have caught:** regressions in the postplay/advance flow currently
invisible because the prompt components are only tested prop-driven.

### W8 — `useScrollRestoration` tests (Vitest) — S

The hook has zero tests and is mocked in all six consumer pages. Cover:
save-on-unmount, RAF+MutationObserver restore after async content, 5 s
safety timer, per-pathname keys.
**Retires:** the unit half of K.3 (W3 covers the browser half).
**Would have caught:** back/POP restoration regressions — a known live
issue.

### W9 — Mute auto-unmute test (Vitest) — S

Add the C.3 case (setVolume > 0 auto-unmutes, routed through the
reveal-mute gate) to `useNativePlayer.test.ts`'s existing mute-scope suite.
**Retires:** C.3 (completing section C).

### W10 — `mise run ci` parity — S

Add tasks: relay `cargo test`, relay clippy `-D warnings`, src-tauri
`cargo test` + clippy (Linux, system libmpv); wire into the `ci` task's
depends. Closes the local-gate hole (no manual sections retired, but every
other item on this list is only useful if devs actually run it before
hardware).

### W11 — Relay client-reuse + keepalive tests (Rust) — S

(1) Counting stub TMDb/Plex HTTP server asserting N proxy requests reuse one
connection (shared `reqwest::Client`, prexu-0szx.12); (2) tokio
paused-time test for the server-side periodic keepalive Pong
(`connection.rs` interval), which the existing suite doesn't cover
(only client-initiated ping is tested).
**Retires:** N.4.

### W12 — Playwright player-mode project (invoke/event shim) — L, spike first

A second Playwright project running a dedicated Vite mode that **aliases**
`@tauri-apps/api/core`/`event` to a scriptable mock at build time — never
touching `window.__TAURI_INTERNALS__`, and never loaded in the default
project, so the auth-path realism constraint holds. Enables browser-level
player chrome flows (mini chrome restore, popout enter/exit chrome state,
download progress/completion events feeding the Downloads page).
**Retires:** parts of D chrome wiring and E.1; unlocks future E2E coverage
of anything event-driven. Do a feasibility spike before committing — the
alias must be provably absent from the default build.

### W13 — Xvfb desktop smoke CI job — M, spike first

Run the actual built binary under Xvfb + system libmpv on ubuntu CI: assert
the startup log block (`compositor installed`, DMABUF renderer line), clean
window-close exit, no zombie process. No rendering assertions (no GPU).
Feasibility unknown (WebKitGTK under Xvfb without DMABUF may warn — assert
lifecycle only); spike before building.
**Retires:** Pre.2/Pre.3 and part of G.2 in CI, before hardware.

## What stays manual

- Wayland WM interactions with no protocol-level automation: popout pinning
  via compositor menu, drag feel, always-on-top expectations (E.2 Wayland
  rows), Wayland click sweeps (G.3).
- Perceptual judgment: subtitle readability/clipping aesthetics (B.2),
  fullscreen visual correctness, A/V sync feel (luminance catches
  video-absence, not sync).
- `prexu://` deep-link OS registration and launch (I.3).
- X11/Wayland session logins and fixture prep (Pre.1/Pre.4, F.7).

With W1–W11 landed, the manual plan shrinks from 64 executed steps to
roughly the 5 (f)-steps plus reviewing the W2 probe report — and the classes
of bug that caused every multi-round saga to date (watch-state seams,
transition scoping, popout state, boot gating) gain pre-hardware coverage.
