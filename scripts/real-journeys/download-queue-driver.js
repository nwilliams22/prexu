/** Actual desktop UI actions; only read-only storage/file checks use service imports. */
import { getAuth, getServer, saveRelayUrl, getDownloadItems } from '/src/services/storage/index.ts';
import { getLocalFilePath } from '/src/services/downloads.ts';
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
  await sleep(300);
  const response = await fetch(`${endpoint}/screenshot`, { method: 'POST', body: label });
  if (!response.ok) throw new Error('screenshot');
}
async function run() {
  let stage = 'native-login';
  try {
    await saveRelayUrl('ws://127.0.0.1:1/ws');
    if (!sessionStorage.getItem('download-queue-login')) {
      await click('Sign in with Plex');
      await until(async () => Boolean((await getAuth())?.authToken));
      await until(async () => {
        const server = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Prexu QA Test Server'));
        if (server) server.click();
        return (await getServer())?.name === 'Prexu QA Test Server';
      });
      await emit(stage);
      sessionStorage.setItem('download-queue-login', 'yes');
      location.assign(`/item/${fixtures[0].key}`);
      return;
    }
    stage = 'download-queue-paused';
    if (!sessionStorage.getItem('download-queue-first')) {
      await click('Download for offline');
      await nav('/downloads');
      await click('Pause all');
      await until(async () => (await getDownloadItems()).some(d => d.ratingKey === fixtures[0].key && d.status === 'paused'));
      sessionStorage.setItem('download-queue-first', 'yes');
      // Reload into the second detail page also proves paused state survives a full page reload.
      location.assign(`/item/${fixtures[1].key}`);
      return;
    }
    await click('Download for offline');
    await nav('/downloads');
    await click('Pause all');
    await until(async () => {
      const items = await getDownloadItems();
      return fixtures.every(f => items.some(d => d.ratingKey === f.key && d.status === 'paused'));
    });
    await emit(stage);
    stage = 'download-queue-reordered';
    await click(`Move ${fixtures[1].title} up`);
    await until(async () => (await getDownloadItems())[0]?.ratingKey === fixtures[1].key);
    await shot('paused');
    await emit(stage);
    stage = 'download-queue-complete';
    await click(`Resume ${fixtures[1].title}`);
    await click('Resume all');
    await until(async () => {
      const items = await getDownloadItems();
      return fixtures.every(f => items.some(d => d.ratingKey === f.key && d.status === 'complete' && d.bytesDownloaded === d.fileSize && d.fileSize > 0));
    }, 120000);
    for (const fixture of fixtures) if (!await getLocalFilePath(fixture.key)) throw new Error('file');
    await shot('complete');
    await emit(stage);
    stage = 'download-queue-settings';
    await nav('/settings');
    await nav('/settings/connections');
    await until(() => document.getElementById('download-concurrency'));
    const select = document.getElementById('download-concurrency');
    if (!select || select.value !== '1') throw new Error('setting');
    select.value = '3';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => localStorage.getItem('prexu.downloadConcurrency') === '3');
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => localStorage.getItem('prexu.downloadConcurrency') === '1');
    await emit(stage);
    await emit('native-driver');
  } catch {
    await emit(stage, 'FAIL');
    await emit('native-driver', 'FAIL');
  }
}
void run();
