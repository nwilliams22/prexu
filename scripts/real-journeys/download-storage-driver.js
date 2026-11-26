/** Actual desktop UI actions; only read-only storage/file checks use service imports. */
import { getAuth, getServer, saveRelayUrl, getDownloadItems } from '/src/services/storage/index.ts';
const endpoint = __JOURNEY_ENDPOINT__;
const fixtures = __QUEUE_FIXTURES__;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await sleep(20); }
  throw new Error('deadline');
}
const button = label => [...document.querySelectorAll('button')].find(b => !b.disabled &&
  (b.getAttribute('aria-label') === label || b.title === label || b.textContent.trim() === label));
async function click(label) { await until(() => button(label)); button(label).click(); }
async function nav(path) {
  await until(() => document.querySelector(`a[href="${path}"]`));
  document.querySelector(`a[href="${path}"]`).click();
}
async function emit(journey, status = 'PASS') {
  await fetch(endpoint, { method: 'POST', body: JSON.stringify({ journey, status }) });
}
async function shot(label) {
  const response = await fetch(`${endpoint}/screenshot`, { method: 'POST', body: label });
  if (!response.ok) throw new Error('screenshot');
}
async function run() {
  let stage = 'native-login';
  try {
    await saveRelayUrl('ws://127.0.0.1:1/ws');
    if (!sessionStorage.getItem('download-storage-login')) {
      await click('Sign in with Plex');
      await until(async () => Boolean((await getAuth())?.authToken));
      await until(async () => {
        const server = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Prexu QA Test Server'));
        if (server) server.click();
        return (await getServer())?.name === 'Prexu QA Test Server';
      });
      await emit(stage);
      sessionStorage.setItem('download-storage-login', 'yes');
      location.assign('/downloads');
      return;
    }
    if (!sessionStorage.getItem('download-storage-summary')) {
      stage = 'download-storage-summary';
      await until(() => document.body.textContent.includes('0 B used by downloads · 1 B free on download drive'));
      await shot('storage-summary');
      await emit(stage);
      sessionStorage.setItem('download-storage-summary', 'yes');
      location.assign(`/item/${fixtures[0].seasonKey}`);
      return;
    }
    stage = 'download-storage-warning-cancel';
    await click('Download Season');
    await until(() => document.querySelector('[aria-label="Confirm season download"]'));
    const confirm = [...document.querySelectorAll('[aria-label="Confirm season download"] button')].find(b => /^Download [0-9]+$/.test(b.textContent.trim()));
    if (!confirm) throw new Error('confirm');
    confirm.click();
    await until(() => document.querySelector('dialog[open][aria-label="Download storage warning"]'));
    if (!document.querySelector('dialog').textContent.includes('Only 1 B is free')) throw new Error('warning');
    await shot('storage-warning');
    await click('Cancel');
    await sleep(500);
    if ((await getDownloadItems()).length) throw new Error('queued-after-cancel');
    await emit(stage);
    await emit('native-driver');
  } catch { await emit(stage, 'FAIL'); await emit('native-driver', 'FAIL'); }
}
void run();
