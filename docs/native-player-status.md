# Native Player (libmpv) — Implementation Status

## Why this exists

WebView2/Chromium on Windows cannot decode HEVC Main 10 at real-time without
a paid Microsoft Store codec extension. Plex libraries with HEVC 10-bit
sources Direct Play into MSE at ~0.5 fps. The fix is to swap the HTML
`<video>` + hls.js playback engine for a native libmpv-backed player.

The full plan lives at `~/.claude/plans/parsed-zooming-biscuit.md`. This
document tracks execution against that plan.

## Branch

All work on `feature/native-player`. Merged phases squash onto `main`.

## Approved architecture

- **Library:** `libmpv2` Rust crate (v4.x) wrapping libmpv.
- **Rendering on Windows:** two-window composition — transparent Tauri
  window on top for UI + all overlays, sibling native window hosting mpv's
  `--wid` target underneath, synchronised by a Rust window-group manager.
- **Scope:** Windows-first. macOS/Linux deferred to phase 5.
- **Audio enhancements:** map to mpv `volume` / `af=lavfi=[...]` / `audio-delay`.
- **PiP:** replaced by two distinct modes — a floating "pop-out" window
  (whole Tauri main window shrunk to a corner, always-on-top) and an
  in-window "minimize" (small corner region inside the WebView while the
  rest of the app stays usable). Tracked under prexu-7il.
- **Subtitles:** libass via mpv replaces browser `::cue` styling.

## Phase progress

### ✅ Phase 0 — revert transcode hacks
Landed on `main` (commits `74ce859`, `dad4187`).

Reverted in `src/services/plex-playback.ts`:
- `directPlayAllowed` back to `"1"`
- `maxVideoBitrate` 1080p back to `20000`
- Client profile restored to `videoCodec=h264,hevc` + HEVC bit-depth limit

Kept on `main` as real bug fixes discovered during the session:
- `useHlsLoader` / `useTimelineReporting` memoization (prevents render loop)
- `tauri-loader.ts` routes through `@tauri-apps/plugin-http` +
  `response.arrayBuffer()` (fixes Plex 400 from WebView2 cross-site headers)

### ✅ Phase 1 — Rust FFI foundation (verified end-to-end)

Tracked in beads as epic `prexu-1a8` (closed). Manual smoke-tested on
2026-04-15 against a local file: `[player] ready`, `[player] duration`,
`[player] paused`, `[player] buffering`, and 4 Hz `[player] time-pos`
all fire as expected; audio plays; mpv opens its own window since
`vo=gpu-next` requires a render target (Phase 2 replaces with managed
HWND). Three follow-up fixes landed during verification (`ce961f5`):
DELAYLOAD for libmpv-2.dll, MPV_SOURCE fallback in build.rs, and an
idempotent DLL copy + `.taurignore` to break a tauri-dev rebuild loop.

**Known DLL constraint:** the shinchiro `mpv-dev-x86_64-v3-*` (AVX2 v3)
build fails `LoadLibrary` with `ERROR_NOACCESS` on Windows 11. Use the
baseline `mpv-dev-x86_64-*` build instead. Both are 117–121 MB because
they bundle BD-J extras; that's not a problem, just unusual.

#### ✅ Step 1.1 — scaffold player module (commit `5abe32b`)
- `src-tauri/src/player/mod.rs` — `PlayerState` struct (placeholder inner)
- `src-tauri/src/player/commands.rs` — 11 `#[tauri::command]` stubs, all
  return `Err("not_implemented")`:
  - `player_load_url`, `player_play`, `player_pause`, `player_seek`
  - `player_set_volume`, `player_set_muted`, `player_set_audio_track`
  - `player_set_sub_track`, `player_set_audio_delay_ms`,
    `player_set_af_chain`, `player_unload`
- `src-tauri/src/player/events.rs` — placeholder (event names reserved in
  module docs): `player://time-pos`, `player://duration`, `player://paused`,
  `player://buffering`, `player://eof`, `player://error`, `player://tracks`,
  `player://ready`
- `src-tauri/src/lib.rs` — `PlayerState` registered as managed state, all
  commands wired into `invoke_handler`
- `cargo check` passes. No functional change to current playback.

#### ✅ Step 1.2 — install libmpv dev files (Windows / MSVC)
Done on this dev machine. The `libmpv2` crate's `build_libmpv` feature on
Windows does **not** build mpv from source (that path is for Unix). It just
adds `MPV_SOURCE/64/` to the link search. You must supply pre-built artifacts
**plus** an MSVC-format import library (`mpv.lib`), since shinchiro's archive
ships only the GNU-style `libmpv.dll.a`.

Steps that worked here (replicate on a fresh Windows dev machine):
1. Download `mpv-dev-x86_64-v3-*.7z` from the shinchiro builds at
   <https://sourceforge.net/projects/mpv-player-windows/files/libmpv/>.
2. Extract to `C:\libmpv\64\` (note the `64\` subfolder — required by the
   `build_libmpv` feature's link-search layout).
3. Generate `C:\libmpv\64\mpv.lib` from the DLL exports using MSVC tools:
   ```cmd
   cd C:\libmpv\64
   dumpbin /EXPORTS libmpv-2.dll > exports.txt
   :: write a mpv.def file: first line "LIBRARY libmpv-2", second "EXPORTS",
   :: then one symbol name per line from column 4 of exports.txt
   lib /def:mpv.def /out:mpv.lib /machine:x64
   ```
4. Set persistent env: `setx MPV_SOURCE "C:\libmpv"`.
5. Add `C:\libmpv\64` to user `PATH` so `libmpv-2.dll` loads at runtime.

Alternatives (not used here): `vcpkg install mpv:x64-windows` (then point
pkg-config), or building libmpv from source via MSYS2/meson.

#### ✅ Step 1.3 — add libmpv2 crate, init/destroy
Added to `src-tauri/Cargo.toml`:
```toml
libmpv2 = { version = "4", features = ["build_libmpv"] }
```
(Resolves to `libmpv2 v4.1.0` + `libmpv2-sys v4.0.1`.)

`PlayerState` now holds `Mutex<Option<Mpv>>`, lazily created by
`ensure_init()` with: `hwdec=auto-safe`, `vo=gpu-next`, `keep-open=always`,
`force-window=no`, `volume-max=200`. `player_unload` calls `destroy()`
which drops the handle (mpv `Drop` impl tears down the underlying client).
Other commands still return `NOT_IMPLEMENTED`.

Verified: `cargo check` clean, `cargo build --bin prexu` links and produces
`target/debug/prexu.exe` (~3 min cold build).

#### ✅ Step 1.4 — core playback commands
`player_load_url` joins headers into `http-header-fields` then `loadfile`
with `start=<seconds>` per-file option (no extra seek round-trip).
`player_play`/`player_pause` toggle the `pause` property. `player_seek`
uses `seek <s> absolute`.

#### ✅ Step 1.5 — event pump thread
`PlayerState` now wraps `Mpv` in `Arc`. `ensure_init` spawns a named
`mpv-event-pump` thread that owns a separate `EventContext::new(mpv.ctx)`
(Send), observes `time-pos`/`duration`/`pause`/`paused-for-cache`, and
emits `player://*` events. `time-pos` throttled to 4 Hz; thread exits on
`Event::Shutdown` when the Mpv handle is dropped. Reply user-data IDs
keep PropertyChange dispatch O(1).

#### ✅ Step 1.6 — remaining commands
`volume` (f64), `mute` (bool), `aid`/`sid` (i64 or `"no"` sentinel),
`audio-delay` (ms→s), `af` presets (`off`=clear, `light`=loudnorm,
`night`=acompressor+loudnorm via `lavfi=[…]`).

#### ✅ Step 1.7 — bundle libmpv-2.dll
`build.rs` copies `$MPV_SOURCE/64/libmpv-2.dll` into `src-tauri/bin/`
(gitignored) so `tauri.conf.json` `bundle.resources` picks it up at
release-bundle time, AND copies it next to the built exe so
`cargo run`/`tauri dev` find it via the application directory search
path. CI runners must set `MPV_SOURCE` (release.yml change pending).

### 🟨 Phase 2 — Two-window composition + swap `<video>` (Windows only)
Tracked as epic `prexu-3r3`. Steps 2.1–2.8 implemented (see commits
`9e0a11f`, `354c6e4`, `aa2ca61`, `c2aedff`, `09d26a1`, `b22bae3`,
`ce2b5c4`, `afcfbf0`). Step 2.9 is manual acceptance — see
`docs/phase2-smoke-test.md`.

Architecture as built:
- `windows = 0.61` (pinned to Tauri's transitive version).
- `HostWindow` in `src-tauri/src/player/host_window.rs` — sibling
  top-level `WS_POPUP + WS_EX_NOACTIVATE`, registered class with
  `BLACK_BRUSH` background. Z-order anchored behind Tauri main via
  `SetWindowPos` in `create()`.
- `PlayerState::ensure_init` creates the host first, hands its HWND to
  mpv as `wid` inside `with_initializer` (must be set before
  `mpv_initialize`), syncs initial geometry, then `set_visible(true)`.
- `lib.rs` `setup` registers `on_window_event` on the main webview:
  Resized/Moved → `sync_geometry`, ScaleFactorChanged →
  `sync_geometry` with the event's new_inner_size,
  CloseRequested/Destroyed → `destroy()`.
- Tauri main window flipped `transparent: true`.
- Frontend: `useNativePlayer` mirrors `useHtml5Player` shape;
  `usePlayer` dispatches to native on Tauri Windows via a module-level
  constant (rules-of-hooks holds because the branch is fixed at import
  time).
- Fullscreen via `player_set_fullscreen` command →
  `webview_window.set_fullscreen()`.

### ⬜ Phase 3 — Feature parity (Windows)
Tracked as epic `prexu-fmd` with steps 3.1–3.10. Restores audio/sub
track switching, libass subtitle styling, audio-enhancement presets,
Watch Together drift sync, offline-download playback, Direct Play
relaxation, resume offset, PostPlay screen, buffered-range reporting.

### 🚧 Phase 4 — Pop-out + minimize + polish (Windows)
Originally tracked as epic `prexu-a6z` (steps 4.1–4.5) under the
"mini-player" name. Step 4.1 + a 4.2 MVP shipped the floating pop-out
mode (whole window shrinks to a corner, always-on-top). prexu-7il
expanded scope into two distinct modes: pop-out (floating, resizable)
and in-window minimize (small corner region inside the WebView,
resizable, drag-snap to corners). Sub-tasks prexu-7il.1–.7 carry the
remaining work.

### 🟦 Phase 5 — Cross-platform research (complete)
Tracked as epic `prexu-efy` (single research issue). ADR-style decision
on whether to extend native player to macOS (NSView + VideoToolbox) and
Linux (X11/Wayland). Full decision record:
`docs/adr-native-player-cross-platform.md`. Findings summary below.

The Windows architecture (a sibling top-level window whose handle is
handed to mpv as `wid`, composited under a transparent WebView) is a
**foreign-window-embedding** design. The portability question reduces to:
"on which platforms can mpv embed into a foreign window handle, and can
Tauri hand us that handle?"

#### Key finding — `wid` embedding is NOT available on every platform

Per the mpv project's own libmpv guidance, mpv's `--wid` foreign-window
embedding is supported on **x11, win32, and cocoa (macOS)** — and is
**not** available on **Wayland**. The mpv docs further state that, because
of platform-specific behaviour and problems (called out specifically for
macOS), the **render API** (`libmpv/render.h`, OpenGL/Vulkan/Metal into a
caller-owned surface) is *recommended over* raw window embedding. Sources:
mpv-examples libmpv README; mpv issues #1242 / #9654 (Wayland embedding);
mpv #10189 (win32 detached-window quirk). This means the current Windows
`wid` approach is a conceptual match for macOS + X11 but a **dead end on
Wayland**, which is the default session on current GNOME/KDE.

#### macOS

- **Embedding:** mpv accepts an `NSView` pointer as `wid` (analogous to
  the Windows HWND). Tauri v2 (`2.10.2` here) exposes the main window's
  `NSWindow` via `WebviewWindow::ns_window()` and deeper webview access via
  `with_webview()` → `PlatformWebview`; the `NSView` would be derived from
  the `NSWindow`'s `contentView`. *Needs verification:* exact handle
  plumbing (whether to host a sibling `NSWindow` mirroring the Windows
  sibling-HWND design, or add a child `NSView` into Tauri's view tree —
  the latter avoids a second window to geometry-sync but couples us to
  wry's view hierarchy).
- **Layer-hosting risk:** modern macOS views are layer-backed; mpv's cocoa
  output and a layer-backed/transparent WebView over it is the macOS
  analogue of the Windows transparent-overlay composition and is the most
  likely source of *needs-verification* compositing bugs (transparent-
  window focus-change glitches are a known Tauri macOS issue, #8255).
- **HW decode:** mpv supports VideoToolbox hardware decoding on Apple
  platforms (the same HEVC-10bit problem that motivated this whole effort
  is what VideoToolbox solves on Mac). *Needs verification* against a real
  Apple-Silicon device — no Mac hardware was available for this research.
- **Alternative:** the mpv-recommended **render API** (Metal/OpenGL) avoids
  foreign-window embedding entirely but is a materially different
  integration from the Windows code (no `wid`, no sibling window; mpv
  renders into a caller-supplied GL/Metal context and we drive frame
  callbacks ourselves). It would not share the `host_window.rs` design.

#### Linux

- **X11:** `wid` embedding is supported. Tauri exposes `gtk_window()` and
  `default_vbox()` on Linux, so an X11 child/foreign window is reachable.
  The mpv docs note X11 focus-policy mismatches with modern UI toolkits as
  a known rough edge for raw embedding.
- **Wayland:** `wid` embedding is **not supported** by mpv (above). On a
  Wayland session the only viable path is the **render API** (mpv renders
  into a surface/subsurface or an offscreen FBO the app composites). This
  is a substantially larger build than the Windows port and shares little
  with the existing code.
- **Fragmentation:** X11-vs-Wayland is a per-session split (same distro can
  run either), GPU drivers vary (Mesa/NVIDIA), and Tauri's own Linux story
  is the least mature of the three (webview is webkit2gtk, child-webview
  embedding is "X11 only" per wry). Net: Linux is the highest-effort,
  highest-variance target.

#### libmpv distribution & licensing (LGPL)

- libmpv is **LGPL** (an LGPL-configured build; some prebuilt binaries are
  GPL — e.g. lachs0r/lachs0r-style builds — and must be avoided to keep
  dynamic-linking rights). *Needs verification* of the exact LGPL version
  for any specific binary we ship.
- **Dynamic linking** (the current Windows model: ship `libmpv-2.dll`
  beside the exe) is the LGPL-clean, low-friction path and the same model
  ports to macOS (ship `libmpv.dylib` inside the `.app`, fix install names)
  and Linux (bundle `libmpv.so` in the AppImage; or declare a `.deb`
  dependency on the distro's `libmpv` package).
- **macOS sourcing:** Homebrew can build `libmpv.*.dylib` + its dependency
  chain; community projects (e.g. MPVKit, karelrooted/libmpv) publish
  Apple-platform builds. *Needs verification* of which produces an
  LGPL-clean, codesign-able, notarizable dylib set.
- **Linux sourcing:** AppImage bundles `libmpv.so` (portable, large); `.deb`
  can instead depend on the distro `libmpv` package (smaller, but
  version-fragile). Static linking is possible but complicates LGPL
  compliance (must provide relink materials) — prefer dynamic.

#### CI cost (GitHub-hosted runners)

- Multipliers: **Linux 1×, Windows 2×, macOS 10×** of base per-minute cost.
  *Needs verification* of current absolute rates — public figures cited
  during this research (~$0.008/min Linux, ~$0.016 Windows, ~$0.08 macOS,
  with a price cut on 2026-01-01) should be re-checked against GitHub's
  billing docs before budgeting.
- `release.yml` **already declares** the macOS (aarch64 + x86_64) and Linux
  matrix legs — they build the WebView app today but have **no libmpv
  install/bundle steps** (only the Windows leg fetches libmpv and generates
  `mpv.lib`). Enabling either platform means adding per-OS libmpv
  provisioning steps mirroring the existing Windows block, plus macOS
  codesigning/notarization of the bundled dylib.
- macOS is the cost driver (10× + two arch legs); Linux is nearly free by
  comparison.

#### Recommendation (full rationale in the ADR)

- **macOS — DEFER (revisit when Mac hardware + demand exist).** Technically
  the most viable port (`wid`/NSView mirrors the Windows design) but needs
  real Apple-Silicon hardware to verify VideoToolbox + layer compositing,
  carries 10× CI cost, and adds codesign/notarization work.
- **Linux — NO-GO for the Windows-style port; DEFER any native player.**
  Wayland (the modern default) has no `wid` embedding, forcing a
  render-API rewrite that shares little with the shipped code; X11-only
  support would strand Wayland users. Cheapest CI, highest engineering
  variance.
- **Windows remains the only supported native-player target** until the
  above blockers clear. The HEVC-10bit motivation is Windows/WebView2
  specific; macOS Safari/WebKit and many Linux WebKitGTK builds already
  decode HEVC via system codecs, *needs verification* per platform — which
  weakens the urgency of porting at all.

### ⬜ Phase 6 — Release/CI for bundled libmpv
Tracked as epic `prexu-2zo` with steps 6.1–6.4. Without this, Phase 2–4
work isn't shippable: release.yml needs to install/cache libmpv on the
Windows runner, generate `mpv.lib`, export `MPV_SOURCE`, and ship
`libmpv-2.dll` inside the NSIS installer. Includes code-signing impact
assessment for the third-party DLL.

## Architecture notes & hard-won lessons

These are the non-obvious constraints learned the hard way during
debugging sessions (notably 2026-04-19/20). If you change the native
player's Win32 integration or React lifecycle around it, read this
section first — several of these are deadlock traps or invisibility
bugs that take hours to diagnose from symptoms alone.

### Win32 thread affinity and Tauri async commands

**Claim:** The `HostWindow` HWND MUST be created on — and owned by —
Tauri's main thread. Do not create it on a tokio worker.

**Why:** Win32 windows are thread-affine. Their WndProc runs on the
thread that called `CreateWindow`, and `SetWindowPos` from another
thread does a cross-thread `SendMessage` that waits for the owner
thread to pump messages. Tauri's main thread pumps Win32 messages;
tokio worker threads (which run `#[tauri::command] async fn`) do not.

If the host is owned by a tokio worker, the main thread's
`on_window_event(Resized)` → `sync_geometry` → `SetWindowPos` blocks
indefinitely inside `SendMessage`. During normal drag-resize this
sometimes self-heals because tokio workers get woken up by other
activity, but the fullscreen command's `run_on_main_thread` closure
is a hard deadlock: main thread calls the closure → closure calls
`SetWindowPos` on the tokio-worker-owned host → waits forever.

When this happened, IPC stopped processing entirely: a subsequent
back-click's `player_unload` command queued on the webview side and
never reached the backend, while mpv kept playing on its own threads.
Visible symptom: Windows IDC_APPSTARTING cursor ("loading ring"), app
won't accept focus, ~20+ seconds of audio after navigation.

**Implementation:** `ensure_init` dispatches `HostWindow::create` +
`set_geometry` + `set_visible` to the main thread via
`app.run_on_main_thread(...)` with a one-shot channel; the tokio
worker blocks on `rx.recv()` until main completes. `destroy()` takes
`&AppHandle` and dispatches `drop(host)` to the main thread
(fire-and-forget — by that point `mpv_terminate_destroy` has already
halted rendering, so an async `DestroyWindow` is safe).

### `SW_SHOWNA`, not `SW_SHOW`, for host `ShowWindow`

`SW_SHOW` programmatically activates the window (foreground, input
focus), which `WS_EX_NOACTIVATE` does NOT block — that ex-style only
suppresses *user* activation (clicks). When the host was owned by a
tokio worker, `SW_SHOW`'s activation was silently inert because the
worker didn't pump messages. The moment the host moved to the main
thread (which does pump), `SW_SHOW` started actually raising the
host above the WebView and capturing keyboard focus.

Symptom: black screen (BLACK_BRUSH host covering WebView), Esc did
nothing (went to host's DefWindowProcW, not React). Use `SW_SHOWNA`.
Follow with `HostWindow::anchor_below(parent)` as belt-and-suspenders
to re-anchor z-order.

### Event pump drop order — join before dropping `Inner`

`Mpv::drop` in libmpv2 calls `mpv_terminate_destroy` synchronously —
but that's only triggered when the LAST `Arc<Mpv>` drops. The event
pump holds one clone. Prior to the fix, `destroy()` just cleared
`Mutex<Option<Inner>>`, which:

1. Dropped our Arc → refcount 2→1 (pump still has one), mpv stays alive
2. Dropped `HostWindow` → `DestroyWindow` on an HWND mpv was still rendering into → race
3. Eventually pump processed `Shutdown`, dropped its Arc, mpv terminated — but way too late

Audio kept bleeding for whatever it took the pump's `wait_event(1.0)`
to loop around and see `Shutdown`. Visible symptom: 20+ seconds of
audio after the user clicked back.

**Fix:** `destroy()` takes `Inner` out of the Mutex, sends `stop`
then `quit` to mpv, then `join()`s the event pump thread (bounded to
2 s via a secondary mpsc hop). When the pump exits it drops its Arc,
leaving exactly one Arc in our local `inner`. The function-end drop
of `inner` then runs `mpv_terminate_destroy` synchronously, silencing
audio. `HostWindow` drops last (now safely async to main thread).

Belt-and-suspenders: `destroy()` also sets `mute=true`, `pause=true`
BEFORE sending `stop`/`quit`, so even if the Arc math somehow doesn't
reach zero synchronously, audio is silent.

### Fullscreen geometry sync timing

The fullscreen animation on Windows 11 fires `WindowEvent::Resized`
rapidly (~10+ events in 300 ms). Each triggers
`sync_geometry` → `SetWindowPos` on the host → mpv gpu-next rebuilds
its D3D11 swapchain. ≥10 rebuilds in 300 ms reliably crashed mpv's
render thread.

Solution: `PlayerState.fullscreen_transition: AtomicBool` is set
before `main.set_fullscreen()` and held for 350 ms afterwards. The
normal `on_window_event → sync_geometry` path checks the flag and
skips while it's set. The explicit catch-up sync happens via
`apply_host_geometry` (bypasses the flag) dispatched to the main
thread *immediately* after `main.set_fullscreen()` — so the video
reaches final dimensions within a frame of the overlay, not 350 ms
later. The 350 ms sleep only keeps the flag set during the animation
burst; nothing user-visible waits on it.

### Transparent Tauri window + DOM body background

`tauri.conf.json` has `"transparent": true`. That means any frame the
WebView paints with an inline `body { background: transparent }` AND
an empty DOM lets the OS show windows BEHIND Prexu through the frame.

Player needs body transparent to let the mpv host HWND show through
the WebView. But the moment Player unmounts, there's a gap before
Dashboard paints — during that gap, body stays transparent and the
webview has no content → user sees Discord (or whatever's behind).

**MUST use `useLayoutEffect`, not `useEffect`**, for the body-bg
swap: `useEffect` cleanup is a passive effect that fires AFTER the
browser paints the post-unmount frame; `useLayoutEffect` cleanup
fires synchronously during commit, so the first post-unmount paint
already has body opaque (`#1a1a2e` — match the CSS fallback
explicitly rather than restoring a captured empty string, which can
drift if anything else mutated body mid-lifetime).

### Back-navigation-from-fullscreen ordering

`handleBack` must `await invoke("player_set_fullscreen", { fullscreen:
false })` BEFORE `navigate(-1)` when in fullscreen. If you just
`navigate(-1)` and rely on the unmount cleanup to exit fullscreen,
the Tauri window resizes from fullscreen to pre-fullscreen AFTER
Player has already unmounted, and Dashboard renders into the small
pre-fullscreen window briefly — user sees stale overlay or
transparent-window flashes depending on timing.

### Do not resize mpv's child HWND from the host WndProc

An earlier attempt (reverted) handled `WM_SIZE` in the host's WndProc
and called `SetWindowPos` on `GW_CHILD` (mpv's child window) to force
a swapchain rebuild at the new size. Two problems:

1. Synchronous `SetWindowPos` blocked the main thread while mpv
   rebuilt its swapchain (main-thread freeze, Windows busy cursor).
2. `SWP_ASYNCWINDOWPOS` variants still interacted badly with mpv's
   vo thread — different hangs, different symptoms.

If you re-attempt mpv D3D11 resize-on-fullscreen (the remaining
prexu-dsh bug), do it via an mpv property/command on a background
thread, not via direct Win32 calls from our WndProc.

### The hard-earned checklist when changing Player <-> Tauri code

- Is any Win32 API called from `#[tauri::command] async fn` via
  `ensure_init`? If so: dispatch to main via `run_on_main_thread`.
- Is any effect mutating `document.body` / `document.documentElement`?
  If the Tauri window is transparent, it MUST be `useLayoutEffect`.
- Is any JS navigation path unmounting Player while fullscreen is
  still Tauri-window-level active? If so: await the fullscreen exit
  before calling `navigate`.
- Is an Arc shared with a background thread? Check its drop order
  against any synchronous cleanup (e.g. `DestroyWindow`) that needs
  the thing the Arc guards to already be gone.

## Resume instructions

When picking this back up:
1. `git checkout feature/native-player`
2. `bd ready` — `prexu-1a8.2` (step 1.4) should be next.
3. Confirm `MPV_SOURCE=C:\libmpv` and `C:\libmpv\64` on PATH. A fresh shell
   `cargo check` inside `src-tauri/` should pass without changes.
4. Implement step 1.4 — real bodies for `player_load_url`, `player_play`,
   `player_pause`, `player_seek` using `state.ensure_init()` then
   `state.with_mpv(|mpv| ...)`.
5. Keep commits atomic per step; update this doc's checkboxes as you go.

## Key files in play

| File | Purpose |
|---|---|
| `src-tauri/src/player/mod.rs` | `PlayerState` + module root |
| `src-tauri/src/player/commands.rs` | 11 Tauri commands |
| `src-tauri/src/player/events.rs` | (will hold) event pump thread |
| `src-tauri/src/lib.rs` | State + handler registration |
| `src-tauri/Cargo.toml` | Will need `libmpv2`, `windows` crates |
| `src-tauri/tauri.conf.json` | Will need transparent window + bundled mpv-2.dll |
| `src-tauri/build.rs` | Will copy mpv-2.dll on `cargo run` |
