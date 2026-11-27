/** Real QA search results and pointer selection in the Tauri webview. */
import { getAuth, getServer, saveRelayUrl } from '/src/services/storage/index.ts';
const endpoint = __JOURNEY_ENDPOINT__;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await sleep(20); }
  throw new Error('deadline');
}
async function emit(journey, status = 'PASS') {
  await fetch(endpoint, { method: 'POST', body: JSON.stringify({ journey, status }) });
}
async function run() {
  let stage = 'native-login';
  try {
    await saveRelayUrl('ws://127.0.0.1:1/ws');
    await until(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Sign in with Plex')));
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('Sign in with Plex')).click();
    await until(async () => Boolean((await getAuth())?.authToken));
    await until(async () => {
      const server = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Prexu QA Test Server'));
      if (server) server.click();
      return (await getServer())?.name === 'Prexu QA Test Server';
    });
    await emit(stage);
    stage = 'native-search-selection';
    await until(() => document.querySelector('[role="combobox"]'));
    const input = document.querySelector('[role="combobox"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const type = value => {
      input.focus();
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    type('Prexu QA Seasons');
    const suggestion = () => [...document.querySelectorAll('[role="option"]')].find(el =>
      el.textContent.includes('Prexu QA Seasons') && el.textContent.includes('Show') && !el.textContent.includes('Search all'));
    await until(suggestion);
    // Keep the real service result visible while arming a new navigation timer.
    type('Prexu QA Season');
    const changedAt = performance.now();
    await sleep(20);
    const selected = suggestion();
    if (!selected || performance.now() - changedAt >= 300) throw new Error('selection-window');
    selected.click();
    await until(() => location.pathname === '/item/17', 1000);
    await sleep(500);
    if (location.pathname !== '/item/17') throw new Error('route-overridden');
    await until(() => document.querySelector('main')?.textContent.includes('Prexu QA Seasons'));
    const resized = await fetch(`${endpoint}/resize`, { method: 'POST' });
    if (!resized.ok) throw new Error('resize');
    await sleep(2000);
    if (location.pathname !== '/item/17') throw new Error('route-overridden');
    const response = await fetch(`${endpoint}/screenshot`, { method: 'POST', body: 'search-detail' });
    if (!response.ok) throw new Error('screenshot');
    await emit(stage);
    await emit('native-driver');
  } catch {
    await emit(stage, 'FAIL');
    await emit('native-driver', 'FAIL');
  }
}
void run();
