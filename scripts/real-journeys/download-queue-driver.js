/** Actual desktop UI actions; only read-only storage/file checks use service imports. */
import { getAuth, getServer, saveRelayUrl, getDownloadItems, saveServer } from '/src/services/storage/index.ts';
import { getLocalFilePath } from '/src/services/downloads.ts';
const endpoint = __JOURNEY_ENDPOINT__;
const fixtures = __QUEUE_FIXTURES__;
const restarted = __JOURNEY_RESTARTED__;
const queueProxy = __QUEUE_PROXY__;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 60000, interval = 20) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await sleep(interval); }
  throw new Error('deadline');
}
function visible(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return rect.width > 0 && rect.height > 0 && hit && element.contains(hit);
}
const button = label => [...document.querySelectorAll('button')].find(b => !b.disabled && visible(b) &&
  (b.getAttribute('aria-label') === label || b.title === label || b.textContent.trim() === label));
async function click(label) { await until(() => button(label)); button(label).click(); }
async function nav(path) {
  if (path === '/downloads') return click('Downloads');
  if (path === '/settings') {
    await until(() => visible(document.querySelector('button[aria-haspopup="true"]')));
    document.querySelector('button[aria-haspopup="true"]').click();
    return click('Settings');
  }
  await until(() => visible(document.querySelector(`a[href="${path}"]`)));
  document.querySelector(`a[href="${path}"]`).click();
}
async function openAndPauseQueue(label = 'Pause all', afterBytes = false) {
  // Act as soon as the real control mounts; tiny QA files can finish between polls.
  let paused = false, hasBytes = !afterBytes;
  const progress = setInterval(async () => { hasBytes ||= (await getDownloadItems()).some(d => d.status === 'downloading' && d.bytesDownloaded > 0); }, 20);
  const observer = new MutationObserver(() => {
    const control = button(label);
    if (control && !paused && hasBytes) { paused = true; control.click(); }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  try {
    await nav('/downloads');
    await until(() => paused);
  } finally { observer.disconnect(); clearInterval(progress); }
}
async function emit(journey, status = 'PASS') {
  await fetch(endpoint, { method: 'POST', body: JSON.stringify({ journey, status }) });
}
async function shot(label) {
  await until(() => button('Downloads'));
  // Let WebKitGTK present the settled route before the X11 capture.
  await sleep(2500);
  const response = await fetch(`${endpoint}/screenshot`, { method: 'POST', body: label });
  if (!response.ok) throw new Error('screenshot');
}
async function run() {
  let stage = 'native-login';
  try {
    await saveRelayUrl('ws://127.0.0.1:1/ws');
    if (!localStorage.getItem('download-queue-login')) {
      stage = 'download-login-button';
      await click('Sign in with Plex');
      await emit(stage);
      stage = 'download-login-token';
      await until(async () => Boolean((await getAuth())?.authToken), 120000, 200);
      await emit(stage);
      stage = 'download-login-server';
      let selectedServer = false;
      await until(async () => {
        const server = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Prexu QA Test Server'));
        if (server && !selectedServer) { selectedServer = true; server.click(); }
        return (await getServer())?.name === 'Prexu QA Test Server';
      }, 60000, 200);
      await emit(stage);
      await emit('native-login');
      await saveServer({ ...await getServer(), uri: queueProxy });
      localStorage.setItem('download-queue-login', 'yes');
      location.assign(`/item/${fixtures[0].key}`);
      return;
    }
    await until(() => button('Downloads'));
    const resized = await fetch(`${endpoint}/resize`, { method: 'POST' });
    if (!resized.ok) throw new Error('resize');
    await until(() => innerWidth >= 1800);
    if (!restarted) {
    // Visit the actual lazy route before starting a local-network transfer.
    await nav('/downloads');
    await until(() => button('Open folder'));
    await click('Go back');
    await until(() => location.pathname === `/item/${fixtures[0].key}` && button('Download for offline'));
    stage = 'download-queue-paused';
    await click('Download for offline');
    await openAndPauseQueue(`Pause ${fixtures[0].title}`, true);
    await until(async () => (await getDownloadItems()).some(d => d.ratingKey === fixtures[0].key && d.status === 'paused'));
    await emit('download-queue-first-paused');
    // Navigate within the season. Episode titles are not global search results,
    // and a pending search debounce can navigate away after opening Downloads.
    await click('Go back');
    await until(() => location.pathname === `/item/${fixtures[0].key}`);
    await click('Season 1');
    await until(() => location.pathname === `/item/${fixtures[0].seasonKey}`);
    const episodeDetails = () => document.querySelector(`button[aria-label="View details for ${fixtures[1].title}"]`);
    await until(episodeDetails);
    episodeDetails().scrollIntoView({ block: 'center' });
    await click(`View details for ${fixtures[1].title}`);
    stage = 'download-queue-second-detail';
    await until(() => location.pathname === `/item/${fixtures[1].key}`);
    await emit(stage);
    stage = 'download-queue-paused';
    await click('Download for offline');
    await openAndPauseQueue();
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
    const paused = await getDownloadItems();
    if (!paused.some(d => d.bytesDownloaded > 0 && d.bytesDownloaded < d.fileSize)) throw new Error('no-partial-transfer');
    localStorage.setItem('download-queue-paused-state', JSON.stringify(paused.map(d => ({ key: d.ratingKey, bytes: d.bytesDownloaded }))));
    await fetch(`${endpoint}/restart`, { method: 'POST' });
    return;
    }
    stage = 'download-queue-restart';
    await nav('/downloads');
    const saved = JSON.parse(localStorage.getItem('download-queue-paused-state'));
    await until(async () => {
      const items = await getDownloadItems();
      return saved.length === 2 && saved.every((d, i) => items[i]?.ratingKey === d.key && items[i].status === 'paused' && items[i].bytesDownloaded === d.bytes);
    });
    await emit(stage);
    // Exercise two available transfer slots through the real settings control.
    await nav('/settings');
    await nav('/settings/connections');
    await until(() => document.getElementById('download-concurrency'));
    const concurrency = document.getElementById('download-concurrency');
    if (concurrency.value !== '1') throw new Error('default-concurrency');
    concurrency.value = '2';
    concurrency.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => localStorage.getItem('prexu.downloadConcurrency') === '2');
    await nav('/downloads');
    stage = 'download-queue-resume-item';
    await click(`Resume ${fixtures[1].title}`);
    await emit(stage);
    stage = 'download-queue-resume-all';
    await click('Resume all');
    await emit(stage);
    stage = 'download-queue-complete';
    await until(async () => {
      const items = await getDownloadItems();
      return fixtures.every(f => items.some(d => d.ratingKey === f.key && d.status === 'complete' && d.bytesDownloaded === d.fileSize && d.fileSize > 0));
    }, 120000);
    for (const fixture of fixtures) if (!await getLocalFilePath(fixture.key)) throw new Error('file');
    await shot('complete');
    await emit(stage);
    stage = 'download-grouping';
    const show = document.querySelector('section[aria-label="Prexu QA Seasons"]');
    if (!show || !show.querySelector('h4')?.textContent.match(/— .*B/) || !document.body.textContent.includes('TV shows')) throw new Error('show');
    const season = [...show.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent === 'Season 1 (2)');
    if (!season?.open || !fixtures.every(f => season.textContent.includes(f.title))) throw new Error('season');
    season.querySelector('summary').click();
    if (season.open) throw new Error('collapse');
    season.querySelector('summary').click();
    if (!season.open) throw new Error('expand');
    await click('Delete all');
    await until(() => document.querySelector('dialog[open]'));
    if (document.querySelector('dialog').querySelectorAll('li').length !== 2) throw new Error('selection');
    await click('Cancel');
    if ((await getDownloadItems()).length !== 2) throw new Error('cancel');
    await click('Delete watched');
    const watchedCount = fixtures.filter(f => f.watched).length;
    if (watchedCount) {
      await until(() => document.querySelector('dialog[open]'));
      const selected = [...document.querySelectorAll('dialog li')];
      if (selected.length !== watchedCount || !fixtures.filter(f => f.watched).every(f => selected.some(li => li.textContent.includes(f.title)))) throw new Error('watched-selection');
      await click('Cancel');
    } else {
      await until(() => document.body.textContent.includes('No watched downloads in this show.'));
    }
    if ((await getDownloadItems()).length !== 2) throw new Error('watched-cancel');
    await shot('grouped');
    await emit(stage);
    stage = 'download-queue-delete';
    await click('Delete all');
    await click('Delete downloads');
    await until(async () => (await getDownloadItems()).length === 0);
    for (const fixture of fixtures) await until(async () => !await getLocalFilePath(fixture.key));
    await until(async () => (await getDownloadItems()).length === 0);
    await emit(stage);
    stage = 'download-queue-settings';
    await nav('/settings');
    await nav('/settings/connections');
    await until(() => document.getElementById('download-concurrency'));
    const select = document.getElementById('download-concurrency');
    if (!select || select.value !== '2') throw new Error('setting');
    select.value = '3';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => localStorage.getItem('prexu.downloadConcurrency') === '3');
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => localStorage.getItem('prexu.downloadConcurrency') === '1');
    await emit(stage);
    await emit('native-driver');
  } catch {
    if (stage.startsWith('download-queue') && (await getServer())?.name === 'Prexu QA Test Server') await shot('diagnostic').catch(() => {});
    await emit(stage, 'FAIL');
    await emit('native-driver', 'FAIL');
  }
}
void run();
