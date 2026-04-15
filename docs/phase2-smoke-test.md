# Phase 2 smoke test (real Plex playback)

Run with `npm run tauri dev`. Sign in to your Plex server, then exercise the player route normally — no devtools console snippets needed this time.

## Pre-flight

1. Confirm `C:\libmpv\64\libmpv-2.dll` is the **non-v3** shinchiro build (Phase 1 doc explains why).
2. Confirm `target/debug/libmpv-2.dll` exists and is up-to-date (`build.rs` copies on every cargo build).
3. Make sure no other Prexu instance / orphan `prexu.exe` / `cargo.exe` is running.

## What this verifies (Phase 2 acceptance)

- The native host HWND is created next to the Tauri main window (step 2.2).
- Tauri main window is `transparent: true` (step 2.3).
- Window-group sync moves/resizes the host with the main window (step 2.4).
- `useNativePlayer` hook subscribes to `player://*` events and invokes `player_*` commands (step 2.5).
- `usePlayer` dispatches to native path on Tauri Windows (step 2.6).
- Host window is geometry-synced + visible from `ensure_init` (step 2.7).
- Fullscreen toggle calls Tauri's `set_fullscreen` (step 2.8).

## Test plan

### A. Direct play happy path
1. Pick a known **HEVC Main10** file from a Plex library (otherwise libmpv playing isn't being exercised).
2. Click play. Expect:
   - Video appears within ~1–2 s, plays at native framerate.
   - Audio out of the default device.
   - Seekbar advances; chapter markers (if any) render correctly over the video region.
   - No flash of placeholder rect (step 2.7's pre-show geometry sync).

### B. Window-group sync
1. **Drag** the Prexu window around the desktop. Video region should track without lag, no tear-off.
2. **Resize** by dragging an edge. Video region should follow the new content area exactly (no overflow into title bar).
3. **Maximize / restore** via the title bar button. Video region snaps to the new size.
4. **Drag to a different DPI monitor** (if you have one). Video should re-scale cleanly without ghosting.

### C. Transport controls
1. Pause / play (space bar). Audio stops/resumes.
2. Seek forward/back via the seekbar. Video jumps; audio resyncs.
3. Volume slider. mpv volume scales 0–200% (step 1.6).
4. Mute toggle (M). Audio stops; video keeps playing.

### D. Fullscreen
1. Press **F** (or click the fullscreen button). Both Tauri main + host HWND should fullscreen together.
2. ESC. Should exit. (Note: `isFullscreen` may briefly drift if you ESC out — known limitation flagged in step 2.8 commit.)

### E. Navigation cleanup
1. While a video is playing, press the back button to leave the player route.
2. Expect the host window to disappear immediately (no ghost rectangle).
3. Audio should stop within ~1 s (mpv tear-down).
4. Navigate back into another item. Should start cleanly.

### F. Watch Together (optional, only if you have a partner)
1. Start a session, both connect.
2. Verify play / pause / seek sync still works (step 3.5 in beads will polish this).

## Pass criteria

Every test in A–E completes without:
- A blank/black region where video should be
- Window flicker or tearing during resize/drag
- App crash, freeze, or stuck-buffering
- Audio out of sync with video
- HEVC playback at < native framerate (the original problem we're fixing)

## If something fails

- **Black region in player route, no video:** check the dev log for `mpv error: …` and `[player] error` events. Likely an mpv config issue (`vo=gpu-next` vs `vo=d3d11`), report verbatim.
- **Host window won't move with main:** the on_window_event listener didn't fire. Confirm in dev log that geometry sync messages would have been logged (we currently log warnings on `set_geometry` failures only).
- **App crashes when leaving player route:** event-pump thread didn't shut down cleanly. Stack trace from Windows Event Viewer (Application log, fault bucket) helps.
- **HEVC plays at < native framerate:** hwdec didn't engage. We can dump mpv's log via `mpv.set_property("log-file", "...")` to confirm `Using hardware decoding (d3d11va)` is in there.

Report whatever you observe — the implementation is provisional until A–E all pass.
