# Native-player IPC smoke test

Updated 2026-09-20 for the current Windows/Linux render-API player. This is a
small command/event diagnostic, not the old audio-only Phase 1 acceptance test.
Use [normal playback smoke tests](phase2-smoke-test.md) for UI and rendering.

Run `npm run tauri dev` after installing native dependencies. Stop ordinary
playback before invoking commands directly. In desktop devtools, import the
API modules from the Vite dev server (the global `window.__TAURI__` is not
enabled in this app). These imports are for `tauri dev`, not packaged builds:

```js
const { invoke } = await import('/node_modules/@tauri-apps/api/core.js');
const { listen } = await import('/node_modules/@tauri-apps/api/event.js');
const events = ['ready', 'duration', 'time-pos', 'paused', 'buffering', 'eof', 'error'];
const unsubs = await Promise.all(events.map(name =>
  listen(`player://${name}`, event => console.log(name, event.payload))
));
window.__playerSmokeCleanup = async () => {
  for (const unsubscribe of unsubs) unsubscribe();
  await invoke('player_unload');
};
await invoke('player_load_url', {
  url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  headers: {},
  startOffsetMs: 0,
});
// Run individually after playback begins:
// await invoke('player_pause');
// await invoke('player_play');
// await invoke('player_seek', { seconds: 60 });
// await invoke('player_set_volume', { vol: 50 });
// await invoke('player_set_muted', { muted: true });
// Always finish with:
// await window.__playerSmokeCleanup();
```

The public sample depends on network availability. Success means the command
bridge and native initialization work, playback events arrive, transport changes
are observable, and cleanup stops audio without hanging. Direct IPC bypasses
the React player session/overlay, so a hidden video surface is not a visual
acceptance failure for this snippet. Do not change `vo` or `force-window` to
repair it: production uses the render API, not a standalone mpv window.

For failures, retain the exact command error and native logs. On Windows check
[libmpv and ANGLE staging](../src-tauri/bin/README.md). On Linux check system
libmpv, the GL context/compositor logs, and [diagnostic modes](linux-dev.md).
For deterministic signal-chain coverage, use the configured headless-mpv tests
in [validation coverage](test-automation-plan.md).
