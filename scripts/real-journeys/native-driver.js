/** Loaded only by the native journey launcher's private Vite instance. */
import { getAuth, getServer, saveRelayUrl, getDownloadItems, saveServer } from '/src/services/storage/index.ts';
import { listen } from '/node_modules/@tauri-apps/api/event.js';
import { getLocalFilePath, deleteDownload } from '/src/services/downloads.ts';
const endpoint = __JOURNEY_ENDPOINT__;
const baseline = __JOURNEY_BASELINE__;
const offlineOnly = __JOURNEY_OFFLINE_ONLY__;
const queueOnly = __JOURNEY_QUEUE_ONLY__;
const restarted = __JOURNEY_RESTARTED__;
let nativeError = 'none';
await listen('player://error', event => { nativeError = /^Raw\(-?\d+\)$/.test(event.payload) ? event.payload : ['InvalidUtf8','Null'].includes(event.payload) ? event.payload : 'other'; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(200);
  }
  throw new Error('deadline');
}
async function emit(journey, status) {
  await fetch(endpoint, { method: 'POST', body: JSON.stringify({ journey, status }) });
}
const button = label => [...document.querySelectorAll('button')].find(b =>
  b.getAttribute('aria-label') === label || b.title === label || b.textContent.trim() === label);
async function click(label) { await until(() => button(label)); button(label).click(); }
async function watch(expectedMs) { return (await fetch(`${endpoint}/watch`, { method: 'POST', body: JSON.stringify({ expectedMs }) })).json(); }
async function diagnose(stage, time) {
  const text = document.body.textContent;
  await fetch(`${endpoint}/diagnostic`, { method: 'POST', body: JSON.stringify({
    stage, time, nativeError, retry: Boolean(button('Retry')), missing: text.includes('Downloaded file is missing or unavailable'),
    scheme: text.includes('URL scheme'), noMedia: text.includes('No playable media'),
    loadFailed: text.includes('Failed to load'), invalidUrl: text.includes('Invalid URL'),
    errorWords: ['mpv','file','invalid','permission','denied','download','resolve','stream','load','format','argument','fetch','network','http','empty','scheme','protocol','channel','closed','ipc','undefined','null','cannot','video','media','abort','timeout','connection','refused','failed','error'].filter(word => text.toLowerCase().includes(word)),
  }) });
}
async function run() {
  let stage = 'native-login';
  try {
    // Set only the relay destination; login and server selection use real UI/auth.
    await saveRelayUrl('ws://127.0.0.1:1/ws');
    if (!restarted && !localStorage.getItem('journey-login')) {
      await until(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Sign in with Plex'));
      [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign in with Plex').click();
      await until(async () => Boolean((await getAuth())?.authToken));
      await until(async () => {
        const button = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Prexu QA Test Server'));
        if (button) button.click();
        return (await getServer())?.name === 'Prexu QA Test Server';
      });
      await emit(stage, 'PASS');
      localStorage.setItem('journey-login', 'done');
      location.assign('/item/2');
      return;
    }
    if (!restarted && localStorage.getItem('journey-queue') && !localStorage.getItem('journey-offline')) {
      stage = 'native-queue-start';
      await until(() => [...document.querySelectorAll('h1,h2')].some(h => h.textContent === 'Prexu QA Pattern'));
      let time = 0, eof = false;
      const unlistenTime = await listen('player://time-pos', event => { time = event.payload; });
      const unlistenEof = await listen('player://eof', () => { eof = true; });
      try {
        const start = button('Play from Beginning') || [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '▶ Play');
        if (!start) throw new Error('play');
        start.click();
        await until(() => time > 1 || button('Retry'));
        if (time <= 1) throw new Error('startup');
        await emit(stage, 'PASS');
        stage = 'native-queue-eof';
        const slider = document.querySelector('[role="slider"][aria-label="Seek"]');
        if (!slider) throw new Error('seek');
        const rect = slider.getBoundingClientRect();
        const x = rect.left + rect.width * .94, y = rect.top + rect.height / 2;
        slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y, button: 0 }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y, button: 0 }));
        await until(() => eof && document.querySelector('[role="dialog"][aria-label="Playing next"]'));
        await emit(stage, 'PASS');
        stage = 'native-queue-postplay';
        await click('Play Now');
        await until(() => JSON.parse(localStorage.getItem('prexu_playback_queue'))?.currentIndex === 1 && time > 1 && time < 10);
        await click('Stop');
        await emit(stage, 'PASS');
      } catch {
        await diagnose(stage, time);
        await emit(stage, 'FAIL');
        if (button('Stop')) button('Stop').click();
      } finally { unlistenTime(); unlistenEof(); }
      await saveServer({ ...await getServer(), uri: 'http://127.0.0.1:1' });
      localStorage.setItem('journey-offline', 'yes');
      await fetch(`${endpoint}/restart`, { method: 'POST', body: '' });
      return;
    }
    if (restarted || localStorage.getItem('journey-offline')) {
      if ((await getServer())?.uri !== 'http://127.0.0.1:1') throw new Error('offline-server-not-restored');
      if (location.pathname !== '/downloads') { location.assign('/downloads'); return; }
      stage = 'native-offline';
      let time = 0;
      const unlisten = await listen('player://time-pos', event => { time = event.payload; });
      try {
        await click('Play');
        await until(() => time > 2 || (button('Retry') && button('Go Back')));
        if (time <= 2) await diagnose(stage, time);
        await emit(stage, time > 2 ? 'PASS' : 'FAIL');
        if (time > 2) {
          await click('Stop');
          // Stop closes the player asynchronously. Do not click the downloads
          // button underneath the closing player or inspect its stale errors.
          await until(() => !button('Stop') && !button('Retry') && button('Play'));
          // Leave the completed record intact while removing only its file.
          stage = 'native-offline-missing-file';
          await deleteDownload('2');
          if (await getLocalFilePath('2')) throw new Error('file-still-present');
          time = 0;
          await click('Play');
          await until(() => button('Retry') && button('Go Back'));
          const clearError = document.body.textContent.includes('Downloaded file is missing or unavailable');
          await emit(stage, clearError && time === 0 ? 'PASS' : 'FAIL');
          await click('Go Back');
        } else await click('Go Back');
        await emit('native-driver', 'PASS');
      } finally { unlisten(); }
      return;
    }
    stage = 'native-session-restore';
    await until(() => [...document.querySelectorAll('h1,h2')].some(h => h.textContent === 'Prexu QA Pattern'));
    if (!(await getAuth())?.authToken || (await getServer())?.name !== 'Prexu QA Test Server') throw new Error('auth');
    await emit(stage, 'PASS');
    let time = 0;
    const unlisten = await listen('player://time-pos', event => { time = event.payload; });
    try {
      if (!offlineOnly && !queueOnly) {
        stage = 'native-play-advance';
        const start = button('Play from Beginning') || [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '▶ Play');
        if (!start) throw new Error('play');
        start.click();
        await until(() => time >= 8 && time < 25);
        await emit(stage, 'PASS');
        stage = 'native-play-pause';
        await click('Pause');
        await until(() => button('Play'));
        await emit(stage, 'PASS');
        stage = 'native-early-stop-watch-state';
        await click('Stop');
        // Stops before 60 seconds preserve watched state on a rewatch; they do
        // not establish a new resume marker.
        await until(async () => {
          const value = await watch(baseline.offset);
          return value.offset === baseline.offset && value.watched === baseline.watched;
        });
        await emit(stage, 'PASS');
        stage = 'native-resume';
        if (baseline.duration < 90000) throw new Error('resume-fixture-too-short');
        await until(() => !button('Stop'));
        time = 0;
        const replay = button('Play from Beginning') || button('▶ Play');
        if (!replay) throw new Error('play');
        replay.click();
        await until(() => time >= 65 && time < 80, 90000);
        await click('Pause');
        await until(() => button('Play'));
        const stoppedMs = Math.round(time * 1000);
        await click('Stop');
        await until(async () => {
          const value = await watch(stoppedMs);
          return Math.abs(value.offset - stoppedMs) < 2000 && value.watched === baseline.watched;
        });
        await until(() => !button('Stop'));
        const resumeButton = () => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Resume from'));
        await until(resumeButton);
        time = 0;
        resumeButton().click();
        await until(() => time * 1000 >= stoppedMs - 2000 && time * 1000 < stoppedMs + 6000);
        await emit(stage, 'PASS');
        // Complete the resumed movie through the player so Plex clears its
        // resume marker before the queue and offline checks.
        stage = 'native-resume-completion';
        await until(() => !button('Stop'), 70000);
        await until(async () => {
          const value = await watch(0);
          return value.offset === 0 && value.watched === baseline.watched;
        });
        await emit(stage, 'PASS');
      }
      stage = 'native-download';
      await click('Download for offline');
      await until(async () => (await getDownloadItems()).some(item => item.ratingKey === '2' && item.status === 'complete'), 90000);
      const downloaded = (await getDownloadItems()).find(item => item.ratingKey === '2');
      if (!downloaded || downloaded.fileSize <= 0 || downloaded.bytesDownloaded !== downloaded.fileSize || !await getLocalFilePath('2')) throw new Error('download');
      await emit(stage, 'PASS');
      if (offlineOnly) {
        await saveServer({ ...await getServer(), uri: 'http://127.0.0.1:1' });
        localStorage.setItem('journey-offline', 'yes');
        await fetch(`${endpoint}/restart`, { method: 'POST', body: '' });
        return;
      }
      const item = { ratingKey: '2', title: 'Prexu QA Pattern', subtitle: '', thumb: '', duration: baseline.duration, type: 'movie' };
      // Exercise restoration and advancement of a persisted user queue. This
      // does not claim coverage of playlist creation or distinct-item identity.
      localStorage.setItem('prexu_playback_queue', JSON.stringify({ items: [item, item], currentIndex: 0, source: 'user-built' }));
      localStorage.setItem('journey-queue', 'yes');
      location.assign('/item/2');
    } finally { unlisten(); }
  } catch {
    await emit(stage, 'FAIL');
    await emit('native-driver', 'FAIL');
  }
}
void run();
