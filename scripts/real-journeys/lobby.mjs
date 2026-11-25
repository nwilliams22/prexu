/** Two real native clients, QA-only identities/media, production relay and UI actions. */
import { nativeClient } from './native-client.mjs';
import { createServer } from 'vite';
import { createServer as socketServer } from 'node:net';
import { spawn } from 'node:child_process';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const rows = [], accounts = [], clients = [];
const cacheDir = resolve(`.journey-cache/node_modules/.vite-${randomUUID()}`);
let vite, relay, stage = 'prerequisites', active = 0, touched = false, applicationSha256;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = value => { if (!value) throw Error('assertion'); };
const add = (journey, status) => { rows.push({ journey, status }); process.stderr.write(`${journey}: ${status}\n`); };
async function until(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await sleep(200); }
  throw Error('deadline');
}
async function request(url, token) {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'X-Plex-Token': token, 'X-Plex-Client-Identifier': 'prexu-lobby-journey' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  check(r.ok); return r.json();
}
async function observe(page) {
  return page.evaluate(async () => {
    const p = (await import('/src/services/probe-live.ts')).probeLive.player?.player;
    return { lobby: !!document.querySelector('.watch-lobby'), prepared: !!p?.isPrepared,
      playing: !!p?.isPlaying, time: p?.currentTime ?? 0, error: !!p?.playbackError,
      invited: [...document.querySelectorAll('.watch-lobby-state')].some(e => e.textContent === 'Invited'),
      ready: [...document.querySelectorAll('.watch-lobby-state')].filter(e => e.textContent === 'Ready').length };
  });
}
async function screenshot(index, name) {
  if (process.env.PREXU_JOURNEY_SCREENSHOTS) {
    await mkdir(process.env.PREXU_JOURNEY_SCREENSHOTS, { recursive: true });
    await clients[index].screenshot(resolve(process.env.PREXU_JOURNEY_SCREENSHOTS, `${name}.png`));
  }
}
async function createLobby() {
  const host = clients[0].page;
  await host.getByRole('button', { name: 'Watch Together' }).click();
  await until(() => host.evaluate(target => {
    const b = [...document.querySelectorAll('[role="checkbox"]')].find(e => e.textContent.includes(target));
    if (!b) return false; b.click(); return true;
  }, accounts[1].user.username));
  await host.getByRole('button', { name: 'Start Session' }).click();
  touched = true;
  await until(async () => { const s = await observe(host); check(!s.error); return s.lobby && s.prepared && s.invited && s.ready === 1; });
}
try {
  check(!process.env.DEBUG && process.env.PREXU_QA_PLEX_AUTH && process.env.PREXU_QA_PLEX_GUEST_AUTH);
  applicationSha256 = createHash('sha256').update(await readFile(resolve(process.env.PREXU_JOURNEY_APP || 'src-tauri/target/debug/prexu'))).digest('hex');
  for (const token of [process.env.PREXU_QA_PLEX_AUTH, process.env.PREXU_QA_PLEX_GUEST_AUTH]) {
    const resources = (await request('https://plex.tv/api/v2/resources?includeHttps=1', token)).filter(r => r.provides.split(',').includes('server'));
    check(resources.length === 1 && resources[0].name === 'Prexu QA Test Server');
    const resource = resources[0]; let server, baseline;
    for (const c of resource.connections) {
      try {
        const u = new URL(c.uri); check(['http:', 'https:'].includes(u.protocol) && !u.username && !u.password);
        const d = await request(`${u.origin}/library/metadata/2`, resource.accessToken);
        const item = d.MediaContainer.Metadata?.[0]; check(item?.title === 'Prexu QA Pattern');
        baseline = { offset: item.viewOffset || 0, duration: item.duration, watched: Boolean(item.viewCount) };
        server = { uri: u.origin, token: resource.accessToken }; break;
      } catch { /* Only the QA resource's connections are eligible. */ }
    }
    check(server); accounts.push({ server, baseline, token, user: await request('https://plex.tv/api/v2/user', token) });
  }
  check(accounts[0].user.id !== accounts[1].user.id);
  stage = 'qa-service-idle';
  const sessions = await request(`${accounts[0].server.uri}/status/sessions`, accounts[0].server.token);
  check(!(sessions.MediaContainer.Metadata || []).some(i => i.Player?.state !== 'stopped'));
  const socket = socketServer(); await new Promise(ok => socket.listen(0, '127.0.0.1', ok));
  const port = socket.address().port; await new Promise(ok => socket.close(ok));
  const relayUrl = `ws://127.0.0.1:${port}/ws`;
  relay = spawn(resolve(process.env.PREXU_JOURNEY_RELAY || 'relay-server/target/debug/prexu-relay'), ['--host', '127.0.0.1', '--port', String(port), '--public-url', relayUrl], { env: { PATH: process.env.PATH, RUST_LOG: 'off' }, stdio: 'ignore' });
  relay.on('error', () => {});
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { return false; } });
  accounts.forEach(a => clients.push(nativeClient(a.token, relayUrl)));
  vite = await createServer({ logLevel: 'silent', cacheDir, plugins: clients.map((client, i) => ({
    ...client.plugin, name: `native-lobby-${i}`,
    transformIndexHtml: () => active === i ? client.plugin.transformIndexHtml() : [],
  })), server: { host: '127.0.0.1', port: 1420, strictPort: true, open: false } });
  await vite.listen();
  stage = 'native-two-client-login';
  for (let i = 0; i < clients.length; i++) {
    active = i; await clients[i].start();
    await clients[i].page.goto('http://127.0.0.1:1420/item/2');
    await until(() => clients[i].page.evaluate(async () => (await import('/src/services/watch-sync.ts')).watchSync.isConnected));
  }
  add(stage, 'PASS');
  const [host, guest] = clients.map(c => c.page);
  stage = 'lobby-stopped-no-show';
  await createLobby();
  const before = await observe(host); await sleep(3000); const after = await observe(host);
  check(!before.playing && !after.playing && Math.abs(after.time - before.time) < .1 && after.lobby);
  await screenshot(0, 'host-lobby-no-show'); add(stage, 'PASS');
  stage = 'lobby-resend';
  await host.getByRole('button', { name: `Resend invite to ${accounts[1].user.username}` }).click();
  await guest.getByRole('button', { name: 'Join Session' }).waitFor(); add(stage, 'PASS');
  stage = 'lobby-all-ready-auto-start';
  await guest.getByRole('button', { name: 'Join Session' }).click();
  await until(async () => {
    const a = await observe(host), b = await observe(guest); check(!a.error && !b.error);
    return a.playing && b.playing && !a.lobby && !b.lobby && a.time > 1 && b.time > 1;
  });
  await screenshot(0, 'host-auto-playback'); await screenshot(1, 'guest-auto-playback'); add(stage, 'PASS');
  stage = 'session-remove-guest';
  await host.getByRole('button', { name: 'Manage session' }).click();
  await host.getByRole('button', { name: `Remove ${accounts[1].user.username}` }).click();
  await until(() => guest.evaluate(async () => !(await import('/src/services/probe-live.ts')).probeLive.player));
  await screenshot(0, 'host-removed-guest'); add(stage, 'PASS');
  await host.getByRole('button', { name: 'Cancel session' }).click();
  await until(() => guest.evaluate(async () => !(await import('/src/services/probe-live.ts')).probeLive.player));
  stage = 'lobby-start-now-no-show';
  await createLobby();
  await host.getByRole('button', { name: 'Start now' }).click();
  await until(async () => { const s = await observe(host); return !s.lobby && s.playing && s.time > 1; });
  await screenshot(0, 'host-start-now'); add(stage, 'PASS');
  await host.getByRole('button', { name: 'Stop' }).click();
} catch { add(stage, 'NOT_VERIFIED'); }
finally {
  let clean = true;
  for (const client of clients) {
    try { await client.page.evaluate(async () => { const p = (await import('/src/services/probe-live.ts')).probeLive.player; if (p) await p.stop(); }); } catch { /* Startup may not have reached the driver. */ }
    try { await client.close(); } catch { clean = false; }
  }
  if (touched) {
    for (let i = 0; i < accounts.length; i++) {
      try {
        const { server, baseline } = accounts[i];
        const sessions = await request(`${server.uri}/status/sessions`, server.token);
        check(!(sessions.MediaContainer.Metadata || []).some(s => s.Player?.state !== 'stopped' && !clients.some(c => c.clientIdentifier() === s.Player?.machineIdentifier)));
        const q = new URLSearchParams({ ratingKey: '2', key: '/library/metadata/2', state: 'stopped', time: String(baseline.offset), duration: String(baseline.duration) });
        const r = await fetch(`${server.uri}/:/timeline?${q}`, { headers: { 'X-Plex-Token': server.token, 'X-Plex-Client-Identifier': clients[i].clientIdentifier() }, redirect: 'error', signal: AbortSignal.timeout(15000) });
        check(r.ok);
        const d = await request(`${server.uri}/library/metadata/2`, server.token), item = d.MediaContainer.Metadata[0];
        check((item.viewOffset || 0) === baseline.offset && Boolean(item.viewCount) === baseline.watched);
      } catch { clean = false; }
    }
  }
  if (relay?.exitCode === null) { const ended = new Promise(ok => relay.once('close', ok)); relay.kill('SIGKILL'); await ended; }
  await vite?.close(); await rm(cacheDir, { recursive: true, force: true });
  add('cleanup-and-restore', clean ? 'PASS' : 'NOT_VERIFIED');
}
const report = { schema: 1, applicationSha256, scope: 'Two real native clients, UI creator/invite/join/start/stop, QA fixture 2, production relay', rows };
const output = JSON.stringify(report, null, 2) + '\n';
if (process.env.PREXU_JOURNEY_REPORT) await writeFile(process.env.PREXU_JOURNEY_REPORT, output, { mode: 0o600 });
process.stdout.write(output);
process.exitCode = rows.some(r => r.status !== 'PASS') ? 1 : 0;
