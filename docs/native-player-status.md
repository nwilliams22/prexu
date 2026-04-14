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

### 🟨 Phase 1 — Rust FFI foundation (5–7 days total)

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

#### ⬜ Step 1.2 — install libmpv dev files (user action needed)
**Prerequisite for all further Rust work on this phase.**

Windows options:
- **Recommended:** download `mpv-dev-x86_64-v3-*.7z` from
  <https://sourceforge.net/projects/mpv-player-windows/files/libmpv/>
  (maintainer: shinchiro). Extract to e.g. `C:\libmpv\`. Set env vars:
  ```
  LIBMPV_HEADERS=C:\libmpv\include
  LIBMPV_LIB=C:\libmpv\
  ```
  Add `C:\libmpv` to `PATH` so `mpv-2.dll` is discoverable at runtime.
- Alternative: `vcpkg install mpv:x64-windows` then point pkg-config.
- Alternative: enable the `libmpv2` crate's `build-libmpv` feature, which
  downloads and builds mpv from source on first `cargo build` (~30 min).

#### ⬜ Step 1.3 — add libmpv2 crate (blocked on 1.2)
Add to `src-tauri/Cargo.toml`:
```toml
libmpv2 = "4"
```
Implement `PlayerState::init()` — create `libmpv2::Mpv::new()` with config:
`hwdec=auto-safe`, `vo=gpu-next`, `keep-open=always`, `force-window=no`,
`volume-max=200`. Replace `Err(NOT_IMPLEMENTED)` in `player_unload` with
real `destroy`. Everything else still stubs.

#### ⬜ Step 1.4 — implement core playback commands
Real bodies for `player_load_url`, `player_play`, `player_pause`,
`player_seek`. Use `mpv.command("loadfile", ...)`, `set_property("pause", ...)`,
`command("seek", ...)`. Headers go via `mpv.set_property("http-header-fields", ...)`.

#### ⬜ Step 1.5 — event pump thread
In `player/events.rs`, spawn a thread that calls `mpv_wait_event`,
translates events to JSON payloads, and emits via `app.emit("player://...", ...)`.
Throttle time-pos events to 4 Hz.

#### ⬜ Step 1.6 — remaining commands
`player_set_volume`, `player_set_muted`, `player_set_audio_track`,
`player_set_sub_track`, `player_set_audio_delay_ms`, `player_set_af_chain`.

#### ⬜ Step 1.7 — bundle mpv-2.dll
- Copy `mpv-2.dll` into `src-tauri/bin/`
- Declare in `tauri.conf.json` `bundle.resources`
- Add `src-tauri/build.rs` step that copies the DLL next to the built exe
  for `cargo run`/`tauri dev`

### ⬜ Phase 2 — Two-window composition + swap `<video>` (5–7 days)
Target state after this phase: HEVC plays smoothly on Windows in Prexu.
See plan for details. Not started.

### ⬜ Phase 3 — Feature parity (4–5 days)
Audio enhancements rewrite, stream selection via mpv props, Watch
Together, offline downloads, subtitle styling via libass. Not started.

### ⬜ Phase 4 — PiP replacement + polish (3–4 days)
Mini-player mode. Not started.

### ⬜ Phase 5 — macOS + Linux (5–7 days, deferred)

## Resume instructions

When picking this back up:
1. `git checkout feature/native-player`
2. Confirm step 1.2 prerequisites (libmpv-dev on PATH, env vars set).
   `cargo check` inside `src-tauri/` after adding `libmpv2` should succeed.
3. Proceed with step 1.3 — add the crate and implement init/destroy.
4. Keep commits atomic per step; update this doc's checkboxes as you go.

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
