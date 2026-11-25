/** Real-account relay journeys. No raw errors, identities or wire payloads leave memory. */
import { nativeClient } from './native-client.mjs';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { createServer as socketServer } from 'node:net';
import { spawn } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const required = ['relay-guest-login', 'relay-production-auth', 'relay-identities', 'relay-auth', 'relay-invite', 'relay-join', 'relay-leave', 'relay-disconnect', 'relay-reconnect', 'relay-network-failure'];
const rows = [];
const accounts = [];
let browser, vite, relay, origin, relayUrl, port;
let guestPlaybackStarted = false, nativeGuest;
const cacheDir = resolve(`.journey-cache/node_modules/.vite-${randomUUID()}`);
let stage = 'prerequisites', operation = 'setup';
let diagnostic;
const add = (journey, status) => { rows.push({ journey, status }); if (process.env.PREXU_JOURNEY_PROGRESS === '1') process.stderr.write(`${journey}: ${status}\n`); };
const check = value => { if (!value) throw Error('assertion'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  do { if (await fn()) return; await sleep(200); } while (Date.now() < end);
  throw Error('deadline');
}
async function request(url, token) {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'X-Plex-Token': token, 'X-Plex-Client-Identifier': 'prexu-relay-journeys' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  check(r.ok); return r.json();
}
async function freePort() {
  const s = socketServer(); await new Promise((ok, fail) => { s.on('error', fail); s.listen(0, '127.0.0.1', ok); });
  const p = s.address().port; await new Promise(ok => s.close(ok)); return p;
}
async function health(sessions, connections) {
  try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }); return await r.text() === `OK — ${sessions} sessions, ${connections} connections`; } catch { return false; }
}
async function startRelay() {
  // Explicit allowlist: never pass protected credentials to the subprocess environment.
  const env = { PATH: process.env.PATH, RUST_LOG: 'off' };
  relay = spawn(resolve(process.env.PREXU_JOURNEY_RELAY || 'relay-server/target/debug/prexu-relay'), ['--host','127.0.0.1','--port',String(port),'--public-url',relayUrl], { env, stdio: 'ignore' });
  let failed = false; relay.on('error', () => { failed = true; });
  await until(async () => { check(!failed && relay.exitCode === null); try { const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }); return r.ok && /^OK — \d+ sessions, \d+ connections$/.test(await r.text()); } catch { return false; } });
}
async function rejectsInvalidCredential() {
  const socket = new WebSocket(relayUrl);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('auth-deadline')), 15000);
      const done = value => { clearTimeout(timer); resolve(value); };
      socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', plex_token: 'prexu-qa-invalid-credential', plex_username: 'invalid', plex_thumb: '' })));
      socket.addEventListener('message', event => { try { const data = JSON.parse(event.data); if (data.type === 'auth_error') done(true); else if (data.type === 'auth_ok') done(false); } catch { done(false); } });
      socket.addEventListener('error', () => done(false));
      socket.addEventListener('close', () => done(false));
    });
  } finally { socket.close(); }
}
async function stopRelay() {
  if (!relay || relay.exitCode !== null) return;
  const ended = new Promise(ok => relay.once('close', ok)); relay.kill('SIGKILL'); await ended;
}
async function connected(page) {
  return page.evaluate(async () => (await import('/src/services/watch-sync.ts')).watchSync.isConnected);
}
async function attachObserver(page) {
  await page.evaluate(async () => {
    const { watchSync } = await import('/src/services/watch-sync.ts');
    window.journeyEvents = {};
    for (const event of ['auth_ok','session_created','session_joined','participant_joined','participant_left','invite_received','disconnected']) {
      watchSync.on(event, data => { window.journeyEvents[event] = (window.journeyEvents[event] || 0) + 1; if (event === 'session_joined') window.journeyEvents.memberCount = data.participants.length; });
    }
  });
}
const eventCount = (page, event) => page.evaluate(e => window.journeyEvents[e] || 0, event);
async function seed(account) {
  account.context = await browser.newContext({ serviceWorkers: 'block' });
  const page = account.page = await account.context.newPage(); page.setDefaultTimeout(30000);
  await page.goto(origin);
  await page.evaluate(({ token, user, server, relayUrl }) => {
    const id = crypto.randomUUID();
    localStorage.setItem('auth_data', JSON.stringify({ authToken: token, clientIdentifier: id }));
    localStorage.setItem('client_identifier', JSON.stringify(id));
    localStorage.setItem('server_data', JSON.stringify(server));
    localStorage.setItem('active_user', JSON.stringify({ id: user.id, title: user.username, thumb: user.thumb, isAdmin: Boolean(server.owned), token }));
    localStorage.setItem('prexu_relay_url', JSON.stringify(relayUrl));
  }, { ...account, context: undefined, page: undefined, relayUrl });
  await page.goto(`${origin}/item/2`);
  await page.getByRole('heading', { name: 'Prexu QA Pattern', exact: true }).waitFor();
  await until(() => connected(page)); await attachObserver(page);
}
try {
  check(!process.env.DEBUG && process.env.PREXU_QA_PLEX_AUTH && process.env.PREXU_QA_PLEX_GUEST_AUTH);
  stage = 'relay-identities';
  for (const token of [process.env.PREXU_QA_PLEX_AUTH, process.env.PREXU_QA_PLEX_GUEST_AUTH]) {
    const resources = (await request('https://plex.tv/api/v2/resources?includeHttps=1', token)).filter(r => r.provides.split(',').includes('server'));
    check(resources.length === 1 && resources[0].name === 'Prexu QA Test Server');
    const resource = resources[0]; let server, baseline;
    for (const c of resource.connections) {
      try {
        const u = new URL(c.uri); check(['http:', 'https:'].includes(u.protocol) && !u.username && !u.password);
        const d = await request(`${u.origin}/library/metadata/2`, resource.accessToken);
        check(d.MediaContainer.Metadata?.[0]?.title === 'Prexu QA Pattern' && d.MediaContainer.Metadata[0].ratingKey === '2');
        const item = d.MediaContainer.Metadata[0]; baseline = { offset: item.viewOffset || 0, watched: Boolean(item.viewCount), duration: item.duration };
        server = { name: resource.name, uri: u.origin, accessToken: resource.accessToken, machineIdentifier: resource.clientIdentifier, owned: resource.owned }; break;
      } catch { /* Only QA-advertised connections. */ }
    }
    check(server);
    const user = await request('https://plex.tv/api/v2/user', token);
    accounts.push({ token, user, server, baseline });
  }
  check(accounts[0].user.id !== accounts[1].user.id && accounts[0].user.username !== accounts[1].user.username);
  add(stage, 'PASS');
  stage = 'qa-service-idle';
  const sessions = await request(`${accounts[0].server.uri}/status/sessions`, accounts[0].server.accessToken);
  check(!(sessions.MediaContainer.Metadata || []).some(i => i.Player?.state !== 'stopped'));
  stage = 'relay-start'; port = await freePort(); relayUrl = `ws://127.0.0.1:${port}/ws`; await startRelay();
  stage = 'relay-production-auth'; check(await rejectsInvalidCredential()); add(stage, 'PASS');
  await until(() => health(0, 0));
  nativeGuest = nativeClient(accounts[1].token, relayUrl);
  vite = await createServer({ logLevel: 'silent', cacheDir, plugins: [nativeGuest.plugin], server: { host: '127.0.0.1', port: 1420, strictPort: true, open: false } });
  await vite.listen(); origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  stage = 'relay-auth';
  operation = 'seed-host'; await seed(accounts[0]);
  operation = 'native-guest-login'; await nativeGuest.start(); accounts[1].page = nativeGuest.page; add('relay-guest-login', 'PASS');
  operation = 'two-authenticated-connections'; await until(() => health(0, 2));
  for (const account of accounts) {
    operation = account === accounts[0] ? 'host-settings' : 'guest-settings';
    await account.page.goto(`${origin}/settings/connections`);
    await account.page.getByRole('status').filter({ hasText: /^Connected to relay$/ }).waitFor();
    await attachObserver(account.page);
  }
  add(stage, 'PASS');
  const [host, guest] = accounts.map(a => a.page);
  // Session creation through the production service keeps media stopped. Invite
  // reception is checked in the actual app UI, without mocking playback hooks.
  stage = 'relay-invite';
  const sessionId = randomUUID().slice(0, 8).toUpperCase();
  await host.evaluate(async sessionId => { const { watchSync } = await import('/src/services/watch-sync.ts'); watchSync.send({ type: 'create_session', session_id: sessionId, media_title: 'Prexu QA Pattern', media_rating_key: '2', media_type: 'movie' }); }, sessionId);
  await until(async () => await eventCount(host, 'session_created') === 1 && await health(1, 2));
  await host.evaluate(async ({ sessionId, target }) => { const { watchSync } = await import('/src/services/watch-sync.ts'); watchSync.send({ type: 'invite', target_username: target, session_id: sessionId, media_title: 'Prexu QA Pattern', media_rating_key: '2', media_type: 'movie' }); }, { sessionId, target: accounts[1].user.username });
  await guest.getByRole('button', { name: 'Join Session', exact: true }).waitFor();
  check(await eventCount(guest, 'invite_received') === 1); add(stage, 'PASS');
  stage = 'relay-join';
  await guest.evaluate(async () => {
    window.journeyTime = 0;
    const { listen } = await import('/node_modules/@tauri-apps/api/event.js');
    await listen('player://time-pos', event => { window.journeyTime = event.payload; });
  });
  guestPlaybackStarted = true;
  operation = 'click-join';
  await guest.getByRole('button', { name: 'Join Session', exact: true }).click();
  operation = 'wait-stop-control';
  await until(async () => await guest.getByRole('button', { name: 'Stop', exact: true }).isVisible() || await guest.getByRole('button', { name: 'Retry', exact: true }).isVisible());
  check(await guest.getByRole('button', { name: 'Stop', exact: true }).isVisible());
  operation = 'compare-join-events';
  await until(() => guest.evaluate(() => window.journeyTime > 1));
  await until(async () => await eventCount(guest, 'session_joined') >= 1 && await eventCount(guest, 'memberCount') === 1 && await eventCount(host, 'participant_joined') >= 1 && await health(1, 2)); add(stage, 'PASS');
  stage = 'relay-leave';
  const leftBefore = await eventCount(host, 'participant_left');
  await guest.getByRole('button', { name: 'Stop', exact: true }).click();
  await guest.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'detached' });
  await guest.goto(`${origin}/settings/connections`);
  await until(async () => await eventCount(host, 'participant_left') > leftBefore && await health(1, 2)); add(stage, 'PASS');
  stage = 'relay-disconnect';
  await guest.evaluate(async () => (await import('/src/services/watch-sync.ts')).watchSync.disconnect());
  await until(async () => !await connected(guest) && await guest.getByRole('status').filter({ hasText: /^Not connected$/ }).isVisible() && await health(1, 1)); add(stage, 'PASS');
  stage = 'relay-reconnect';
  await guest.reload(); await until(async () => await connected(guest) && await guest.getByRole('status').filter({ hasText: /^Connected to relay$/ }).isVisible() && await health(1, 2)); add(stage, 'PASS');
  stage = 'relay-network-failure';
  await stopRelay(); await until(async () => !await connected(host) && !await connected(guest) && await host.getByRole('status').filter({ hasText: /^Not connected$/ }).isVisible() && await guest.getByRole('status').filter({ hasText: /^Not connected$/ }).isVisible());
  await startRelay(); await until(async () => await connected(host) && await connected(guest) && await host.getByRole('status').filter({ hasText: /^Connected to relay$/ }).isVisible() && await guest.getByRole('status').filter({ hasText: /^Connected to relay$/ }).isVisible() && await health(0, 2)); add(stage, 'PASS');
} catch {
  add(stage, 'FAIL');
  diagnostic = { operation, native: nativeGuest?.diagnostics() };
  if (accounts[1]?.page) try {
    diagnostic = { operation, native: nativeGuest?.diagnostics(), ...await accounts[1].page.evaluate(() => ({
      joinedEvents: window.journeyEvents?.session_joined || 0, existingMemberCount: window.journeyEvents?.memberCount || 0,
      stopPresent: Boolean(document.querySelector('button[aria-label="Stop"]')),
      retryPresent: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Retry'),
      errorWords: ['video','hls','decode','demuxer','supported','network','failed','fetch','403','401','500','invoke','undefined','codec','source','format'].filter(t => document.body.textContent.toLowerCase().includes(t)),
      mediaErrorCode: document.querySelector('video')?.error?.code || 0,
      pageError: ['Something went wrong', 'Failed to load', 'No playable media', 'Not connected'].filter(t => document.body.textContent.includes(t)),
    })), hostJoinEvents: await eventCount(accounts[0].page, 'participant_joined') };
  } catch { diagnostic = { operation }; }
}
finally {
  let clean = true;
  if (guestPlaybackStarted && accounts[1]?.page) try {
    const page = accounts[1].page;
    if (await page.getByRole('button', { name: 'Stop', exact: true }).isVisible()) {
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await page.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'detached' });
    }
  } catch { clean = false; }
  try { await nativeGuest?.close(); } catch { clean = false; }
  try { await browser?.close(); } catch { clean = false; }
  if (guestPlaybackStarted) {
    try {
      const host = accounts[0], guest = accounts[1];
      // Only restore after all media sessions have stopped. Refuse contention.
      await until(async () => !(await request(`${host.server.uri}/status/sessions`, host.server.accessToken)).MediaContainer.Metadata?.some(i => i.Player?.state !== 'stopped' && i.Player?.machineIdentifier !== nativeGuest.clientIdentifier()), 15000);
      const query = new URLSearchParams({ ratingKey: '2', key: '/library/metadata/2', state: 'stopped', time: String(guest.baseline.offset), duration: String(guest.baseline.duration) });
      const response = await fetch(`${guest.server.uri}/:/timeline?${query}`, { headers: { 'X-Plex-Token': guest.server.accessToken, 'X-Plex-Client-Identifier': nativeGuest.clientIdentifier() }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      check(response.ok);
      await until(async () => !(await request(`${host.server.uri}/status/sessions`, host.server.accessToken)).MediaContainer.Metadata?.some(i => i.Player?.state !== 'stopped'), 15000);
      const data = await request(`${guest.server.uri}/library/metadata/2`, guest.server.accessToken);
      const item = data.MediaContainer.Metadata[0];
      check((item.viewOffset || 0) === guest.baseline.offset && Boolean(item.viewCount) === guest.baseline.watched);
      add('relay-service-state-restored', 'PASS');
    } catch { add('relay-service-state-restored', 'FAIL'); clean = false; }
  }
  if (relay && relay.exitCode === null) { try { await until(() => health(0, 0), 5000); } catch { clean = false; } }
  try { await stopRelay(); } catch { clean = false; }
  try { await vite?.close(); await rm(cacheDir, { recursive: true, force: true }); } catch { clean = false; }
  for (const journey of required) if (!rows.some(r => r.journey === journey)) add(journey, 'NOT_RUN');
  add('cleanup', clean ? 'PASS' : 'FAIL');
}
const report = { schema: 1, diagnostic, guestBaseline: accounts[1]?.baseline, scope: 'real production relay, browser host and native PIN-authenticated guest; UI invite/join/stop and connection status compared with relay events and health; session creation uses production service', rows };
const output = JSON.stringify(report, null, 2) + '\n';
if (process.env.PREXU_JOURNEY_REPORT) await writeFile(process.env.PREXU_JOURNEY_REPORT, output, { mode: 0o600 });
process.stdout.write(output);
process.exitCode = rows.some(r => r.status !== 'PASS') ? 1 : 0;
