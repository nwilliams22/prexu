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
- **PiP:** replaced by a "mini-player" mode (resize two-window pair to corner).
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

### ⬜ Phase 4 — Mini-player + polish (Windows)
Tracked as epic `prexu-a6z` with steps 4.1–4.5. Replaces browser PiP
with a Rust-driven mini-player mode (resize both windows to corner +
always-on-top + minimal chrome).

### ⬜ Phase 5 — Cross-platform research (deferred)
Tracked as epic `prexu-efy` (single research issue). ADR-style decision
on whether to extend native player to macOS (NSView + VideoToolbox) and
Linux (X11/Wayland). Output goes back into this doc.

### ⬜ Phase 6 — Release/CI for bundled libmpv
Tracked as epic `prexu-2zo` with steps 6.1–6.4. Without this, Phase 2–4
work isn't shippable: release.yml needs to install/cache libmpv on the
Windows runner, generate `mpv.lib`, export `MPV_SOURCE`, and ship
`libmpv-2.dll` inside the NSIS installer. Includes code-signing impact
assessment for the third-party DLL.

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
