/** Real native IPC preparation contract; no lobby/UI acceptance claim. */
import { getAuth, getServer, getPreferences, saveRelayUrl } from '/src/services/storage/index.ts';
import { prepareSource } from '/src/services/plex-playback.ts';
import { invoke } from '/node_modules/@tauri-apps/api/core.js';
import { listen } from '/node_modules/@tauri-apps/api/event.js';
const endpoint = __JOURNEY_ENDPOINT__;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await sleep(100); }
  throw new Error('deadline');
}
async function emit(journey, status) {
  await fetch(endpoint, { method: 'POST', body: JSON.stringify({ journey, status }) });
}
async function run() {
  let stage = 'native-login';
  const unlisteners = [];
  try {
    await saveRelayUrl('ws://127.0.0.1:1/ws');
    if (!sessionStorage.getItem('journey-login')) {
      let button;
      await until(() => (button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign in with Plex')));
      button.click();
      await until(async () => Boolean((await getAuth())?.authToken));
      await until(async () => {
        const serverButton = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Prexu QA Test Server'));
        serverButton?.click();
        return (await getServer())?.name === 'Prexu QA Test Server';
      });
      await emit(stage, 'PASS');
      sessionStorage.setItem('journey-login', 'done');
      location.assign('/item/2');
      return;
    }
    stage = 'native-paused-prepare';
    const server = await getServer();
    if (server?.name !== 'Prexu QA Test Server') throw new Error('scope');
    const prepared = await prepareSource({ server, ratingKey: '2', preferences: (await getPreferences()).playback,
      offsetOverride: 0, skipCodecCheck: true });
    let ready = false, paused = true, time = 0;
    unlisteners.push(await listen('player://prepared', () => { ready = true; }));
    unlisteners.push(await listen('player://paused', e => { paused = e.payload; }));
    unlisteners.push(await listen('player://time-pos', e => { time = e.payload; }));
    await invoke('player_load_url', { url: prepared.url, headers: {}, startOffsetMs: 0, initiallyPaused: true });
    await until(() => ready);
    const start = time;
    await sleep(3000);
    if (!paused || Math.abs(time - start) > 0.05 || time > 0.1) throw new Error('advanced');
    await emit(stage, 'PASS');
    stage = 'native-prepared-explicit-start';
    await invoke('player_play');
    await until(() => !paused && time > start + 2);
    await emit(stage, 'PASS');
    stage = 'native-solo-autoplay';
    await invoke('player_pause');
    await until(() => paused);
    ready = false;
    time = 0;
    await invoke('player_load_url', { url: prepared.url, headers: {}, startOffsetMs: 0 });
    await until(() => ready && !paused && time > 2);
    await emit(stage, 'PASS');
    await invoke('player_unload');
    await emit('native-driver', 'PASS');
  } catch {
    await emit(stage, 'FAIL');
    await invoke('player_unload').catch(() => {});
    await emit('native-driver', 'FAIL');
  } finally { for (const unlisten of unlisteners) unlisten(); }
}
run();
