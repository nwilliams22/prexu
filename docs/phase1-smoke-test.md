# Phase 1 smoke test (paste in Tauri devtools console)

Run with `npm run tauri dev`. When the window appears, open devtools (F12 or right-click → Inspect) and paste the snippet below.

## What this verifies

- libmpv-2.dll loads at runtime (no STATUS_DLL_NOT_FOUND on first command call)
- All 11 `player_*` tauri commands are reachable across the IPC bridge
- `PlayerState::ensure_init` succeeds (mpv handle constructed with hwdec/vo/keep-open/force-window/volume-max config)
- Event pump thread fires `player://*` events
- `time-pos`, `duration`, `paused`, `buffering`, `eof` events are observable

## What this does NOT verify (Phase 2+)

- Video rendering — mpv was init'd with `force-window=no` and there's no `--wid` yet, so no video surface exists. Audio plays.
- Hardware decoding engagement — needs a render target.
- Plex auth header forwarding end-to-end — uses a public test URL here.

## Snippet

```js
// === Phase 1 smoke test ==================================================
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const log = (k, v) => console.log(`[player] ${k}`, v);

// 1. Subscribe to all player events
const unsubs = await Promise.all([
  listen('player://time-pos',  e => log('time-pos',  e.payload.toFixed(2))),
  listen('player://duration',  e => log('duration',  e.payload)),
  listen('player://paused',    e => log('paused',    e.payload)),
  listen('player://buffering', e => log('buffering', e.payload)),
  listen('player://eof',       _ => log('eof',       null)),
  listen('player://ready',     _ => log('ready',     null)),
  listen('player://error',     e => log('error',     e.payload)),
]);

// Helper to tear everything down at the end
window.__phase1cleanup = async () => {
  for (const u of unsubs) u();
  await invoke('player_unload');
  console.log('[player] cleaned up');
};

// 2. Load a public test stream (Big Buck Bunny, CC-BY)
const TEST_URL = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
console.log('[player] loading test url…');
await invoke('player_load_url', {
  url: TEST_URL,
  headers: {},          // no Plex headers needed for public URL
  startOffsetMs: 0,
});

// You should see within a few seconds:
//   [player] ready
//   [player] duration ~596
//   [player] paused false
//   [player] time-pos 0.25  (then 0.50, 0.75, … updating ~4 Hz)
//
// Audio should also play through the default device.

// 3. Try transport commands manually:
//   await invoke('player_pause');                       // expect: paused true
//   await invoke('player_play');                        // expect: paused false
//   await invoke('player_seek', { seconds: 60 });       // expect: time-pos jumps to ~60
//   await invoke('player_set_volume', { vol: 50 });     // half volume
//   await invoke('player_set_muted', { muted: true });  // silent
//   await invoke('player_set_af_chain', { preset: 'night' });
//
// 4. When done, run:  await window.__phase1cleanup()
```

## Pass criteria

- No DLL-not-found error on first `invoke('player_load_url', …)`.
- `[player] ready` and `[player] duration ~596` appear in the console within ~5 s.
- `[player] time-pos` updates at ~4 Hz once playback starts (rate-limited by the event pump).
- Audio plays.
- Pause/play/seek change `time-pos` reporting accordingly.
- `await window.__phase1cleanup()` at the end exits cleanly (no panic in the dev log).

## If it fails

- **"failed to find … libmpv-2.dll"** at app launch → `target/debug/libmpv-2.dll` is missing. Re-run `cd src-tauri && cargo build --bin prexu` with `MPV_SOURCE` set, then restart `npm run tauri dev`.
- **`mpv init failed: …`** on first invoke → check the dev log; `vo=gpu-next` may be rejected without a window on some drivers. Workaround: temporarily change `force-window=no` to `force-window=yes` in `src-tauri/src/player/mod.rs` (mpv will pop its own window for testing).
- **No `time-pos` events** → event pump didn't start; check the dev log for `Failed to spawn event thread`.
