import { clickSignIn } from '/scripts/real-journeys/driver-ui.js';
/** Real native UI folder picker/migration; service imports only inspect results. */
import { getAuth, getServer, saveRelayUrl, getDownloadItems } from '/src/services/storage/index.ts';
import { getDownloadsDir, getLocalFilePath } from '/src/services/downloads.ts';
import { listen } from '/node_modules/@tauri-apps/api/event.js';
const endpoint = __JOURNEY_ENDPOINT__;
const fixtures = __QUEUE_FIXTURES__;
const destination = __MOVE_DIRECTORY__;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await sleep(50); }
  throw new Error('deadline');
}
const button = label => [...document.querySelectorAll('button')].find(b => !b.disabled &&
  (b.getAttribute('aria-label') === label || b.title === label || b.textContent.trim() === label));
async function click(label) { await until(() => button(label)); button(label).click(); }
async function emit(journey, status = 'PASS') {
  await fetch(endpoint, { method: 'POST', body: JSON.stringify({ journey, status }) });
}
async function shot(label) {
  await sleep(2500);
  if (!(await fetch(`${endpoint}/screenshot`, { method: 'POST', body: label })).ok) throw new Error('screenshot');
}
async function run() {
  let stage = 'native-login';
  try {
    await saveRelayUrl('ws://127.0.0.1:1/ws');
    if (!sessionStorage.getItem('download-move-login')) {
      await clickSignIn();
      await until(async () => Boolean((await getAuth())?.authToken), 120000);
      await until(async () => {
        const server = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Prexu QA Test Server'));
        if (server) server.click();
        return (await getServer())?.name === 'Prexu QA Test Server';
      });
      await emit(stage);
      sessionStorage.setItem('download-move-login', 'yes');
      location.assign(`/item/${fixtures[0].key}`);
      return;
    }
    stage = 'native-download';
    if (!sessionStorage.getItem('download-move-ready')) {
      await click('Download for offline');
      await until(async () => (await getDownloadItems()).some(d => d.ratingKey === fixtures[0].key && d.status === 'complete'), 120000);
      await emit(stage);
      sessionStorage.setItem('download-move-ready', 'yes');
      location.assign('/settings/connections');
      return;
    }
    stage = 'download-move-confirm';
    await click('Choose folder…');
    if (!(await fetch(`${endpoint}/choose-folder`, { method: 'POST', body: '' })).ok) throw new Error('picker');
    await until(() => button('Move downloads'), 180000);
    if (!document.body.textContent.includes(destination)) throw new Error('wrong-folder');
    await shot('move-confirm');
    await emit(stage);
    stage = 'download-move-complete';
    await click('Move downloads');
    await until(() => document.body.textContent.includes('Downloads moved and verified.'));
    if (await getDownloadsDir() !== `${destination}/Prexu`) throw new Error('location');
    if (!(await getLocalFilePath(fixtures[0].key))?.startsWith(`${destination}/Prexu/`)) throw new Error('local-file');
    await shot('move-complete');
    await emit(stage);
    await click('Downloads');
    await click('Open folder');
    stage = 'download-move-playback';
    let time = 0;
    const stop = await listen('player://time-pos', e => { time = e.payload; });
    try {
      await click('Play');
      await until(() => time > 3);
      await shot('move-playback');
      await click('Stop');
      await emit(stage);
    } finally { stop(); }
    await emit('native-driver');
  } catch { await emit(stage, 'FAIL'); await emit('native-driver', 'FAIL'); }
}
void run();
