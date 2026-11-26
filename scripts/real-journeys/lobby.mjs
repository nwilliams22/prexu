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
let diagnostic, operation = "setup";
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
async function rejectsInvalidCredential(url) {
  const socket = new WebSocket(url);
  try {
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 15000);
      const done = value => { clearTimeout(timer); resolve(value); };
      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', plex_token: 'prexu-qa-invalid-credential' }));
      socket.onmessage = event => {
        try { const data = JSON.parse(event.data); if (data.type === 'auth_error') done(true); else if (data.type === 'auth_ok') done(false); }
        catch { done(false); }
      };
      socket.onerror = () => done(false);
    });
  } finally { socket.close(); }
}
async function observe(page) {
  return page.evaluate(async () => {
    const p = (await import('/src/services/probe-live.ts')).probeLive.player?.player;
    return { lobby: !!document.querySelector('.watch-lobby'), prepared: !!p?.isPrepared,
      creatorOpen: !!document.querySelector('[aria-labelledby="session-creator-title"]'),
      friendCount: document.querySelectorAll('[role="checkbox"]').length,
      errorWords: ['timed out', 'not connected', 'failed', 'session not found'].filter(t => document.body.textContent.toLowerCase().includes(t)),
      playing: !!p?.isPlaying, time: p?.currentTime ?? 0, error: !!p?.playbackError, inviteEvents: window.lobbyInviteEvents || 0,
      invited: [...document.querySelectorAll('.watch-lobby-state')].some(e => e.textContent === 'Invited'),
      recoveryLabels: window.recoveryLabels || [],
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
  await until(async () => { const s = await observe(host); check(!s.error); return s.lobby && s.prepared && s.invited && s.ready === 1 && s.time < .1; });
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
  stage = 'relay-production-auth';
  check(await rejectsInvalidCredential(relayUrl)); add(stage, 'PASS');
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
    check(await clients[i].page.evaluate(async expected => {
      const auth = await (await import('/src/services/storage/index.ts')).getAuth();
      const user = await (await import('/src/services/plex-api.ts')).getPlexUser(auth.authToken);
      const { watchSync } = await import('/src/services/watch-sync.ts');
      window.lobbyInviteEvents = 0;
      watchSync.on('invite_received', () => { window.lobbyInviteEvents++; });
      return user.username === expected;
    }, accounts[i].user.username));
  }
  check(await (await fetch(`http://127.0.0.1:${port}/health`)).text() === 'OK — 0 sessions, 2 connections');
  add(stage, 'PASS');
  const [host, guest] = clients.map(c => c.page);
  stage = 'lobby-stopped-no-show';
  operation = 'create-lobby'; await createLobby();
  operation = 'measure-stopped';
  const before = await observe(host); await sleep(3000); const after = await observe(host);
  check(!before.playing && !after.playing && Math.abs(after.time - before.time) < .1 && after.lobby);
  operation = 'capture-host-lobby'; await screenshot(0, 'host-lobby-no-show'); add(stage, 'PASS');
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
  if (process.env.PREXU_JOURNEY_WATCH_CONNECTIONS === '1') {
    const text = (page, label) => page.evaluate(label => document.body.textContent.includes(label), label);
    const drop = (page, delay) => page.evaluate(async delay => {
      const { watchSync } = await import('/src/services/watch-sync.ts');
      // Close a real socket and defer its first retry to exercise both grace
      // windows. The production authentication/rejoin path remains unchanged.
      watchSync.reconnectDelay = delay;
      watchSync.ws.close();
    }, delay);
    await guest.evaluate(() => {
      window.recoveryLabels = [];
      new MutationObserver(() => {
        for (const label of ['Re-syncing', 'Having trouble keeping up']) {
          if (document.body.textContent.includes(label) && !window.recoveryLabels.includes(label)) window.recoveryLabels.push(label);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    stage = 'drift-viewer-only';
    for (let i = 0; i < 3; i++) {
      await until(async () => (await observe(host)).time > 10);
      operation = `drift-${i + 1}-inject`;
      const before = await observe(host);
      await guest.evaluate(async () => {
        window.recoveryLabels = [];
        const p = (await import('/src/services/probe-live.ts')).probeLive.player.player;
        p.seek(Math.max(0, p.currentTime - 8));
      });
      await until(async () => (await observe(host)).time - (await observe(guest)).time > 4);
      operation = `drift-${i + 1}-badge`;
      await until(() => guest.evaluate(label => window.recoveryLabels.includes(label), i === 2 ? 'Having trouble keeping up' : 'Re-syncing'));
      const after = await observe(host);
      check(after.time >= before.time && after.time - before.time < 6);
      await until(async () => Math.abs((await observe(host)).time - (await observe(guest)).time) < 2);
      if (i < 2) await until(async () => !await text(guest, 'Re-syncing'));
    }
    await clients[1].revealControls();
    await screenshot(1, 'guest-repeated-correction'); add(stage, 'PASS');
    stage = 'host-grace-return'; operation = 'host-drop-waiting';
    await drop(host, 8000);
    await clients[1].revealControls();
    await until(async () => await text(guest, 'Waiting for host...') && !(await observe(guest)).playing);
    await screenshot(1, 'guest-waiting-for-host'); operation = 'host-return-resume';
    await until(async () => (await observe(host)).playing && (await observe(guest)).playing);
    await until(async () => Math.abs((await observe(host)).time - (await observe(guest)).time) < 2);
    add(stage, 'PASS');
    stage = 'guest-grace-rejoin'; operation = 'guest-drop-rejoin';
    await drop(guest, 8000);
    await clients[0].revealControls();
    await until(() => text(host, 'Reconnecting'));
    await screenshot(0, 'host-guest-reconnecting');
    check((await observe(host)).playing);
    await until(async () => (await observe(guest)).playing && !await text(host, 'Reconnecting'));
    await until(async () => Math.abs((await observe(host)).time - (await observe(guest)).time) < 2);
    add(stage, 'PASS');
    stage = 'host-grace-expiry'; operation = 'host-timeout';
    await drop(host, 70000);
    await until(async () => await text(guest, 'Waiting for host...') && !(await observe(guest)).playing);
    await until(() => text(guest, 'Session ended - host left'), 75000);
    await screenshot(1, 'guest-host-left');
    check(!(await observe(guest)).playing); add(stage, 'PASS');
  } else {
  stage = 'session-remove-guest';
  await clients[0].revealControls();
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
  stage = 'lobby-cancel-invite';
  await createLobby();
  await guest.getByRole('button', { name: 'Join Session' }).waitFor();
  await host.getByRole('button', { name: `Cancel invite for ${accounts[1].user.username}` }).click();
  await guest.getByRole('button', { name: 'Join Session' }).waitFor({ state: 'detached' });
  await until(async () => { const s = await observe(host); return !s.lobby && s.playing; });
  add(stage, 'PASS');
  await clients[0].revealControls();
  await host.getByRole('button', { name: 'Stop' }).click();
  }
} catch {
  add(stage, 'NOT_VERIFIED');
  diagnostic = [];
  for (let i = 0; i < clients.length; i++) {
    if (!clients[i].diagnostics().authenticated) continue;
    try { diagnostic.push({ client: i, ...await observe(clients[i].page) }); await screenshot(i, `incomplete-${i}`); } catch { /* No raw errors or identities in reports. */ }
  }
}
finally {
  let clean = true;
  for (const client of clients) {
    try { await client.page.evaluate(async () => { const p = (await import('/src/services/probe-live.ts')).probeLive.player; if (p) await p.stop(); }); } catch { /* Startup may not have reached the driver. */ }
    try { await client.close(); } catch { add("client-cleanup", "NOT_VERIFIED"); clean = false; }
  }
  if (touched) {
    for (let i = 0; i < accounts.length; i++) {
      try {
        const { server, baseline } = accounts[i];
        const sessions = await request(`${accounts[0].server.uri}/status/sessions`, accounts[0].server.token);
        check(!(sessions.MediaContainer.Metadata || []).some(s => s.Player?.state !== 'stopped' && !clients.some(c => c.clientIdentifier() === s.Player?.machineIdentifier)));
        // Plex ignores a zero-position timeline for clearing an existing
        // resume marker; unscrobble clears it, then restore watched state.
        if (baseline.offset === 0) {
          const cleared = await fetch(`${server.uri}/:/unscrobble?key=2&identifier=com.plexapp.plugins.library`, {
            headers: { 'X-Plex-Token': server.token }, redirect: 'error', signal: AbortSignal.timeout(15000),
          });
          check(cleared.ok);
        }
        const current = (await request(`${server.uri}/library/metadata/2`, server.token)).MediaContainer.Metadata[0];
        if (Boolean(current.viewCount) !== baseline.watched) {
          const action = baseline.watched ? 'scrobble' : 'unscrobble';
          const response = await fetch(`${server.uri}/:/${action}?key=2&identifier=com.plexapp.plugins.library`, {
            headers: { 'X-Plex-Token': server.token }, redirect: 'error', signal: AbortSignal.timeout(15000),
          });
          check(response.ok);
        }
        const q = new URLSearchParams({ ratingKey: '2', key: '/library/metadata/2', state: 'stopped', time: String(baseline.offset), duration: String(baseline.duration) });
        const r = i === 1 && !rows.some(row => row.journey === 'lobby-all-ready-auto-start') ? { ok: true } : await fetch(`${server.uri}/:/timeline?${q}`, { headers: { 'X-Plex-Token': server.token, 'X-Plex-Client-Identifier': clients[i].clientIdentifier() }, redirect: 'error', signal: AbortSignal.timeout(15000) });
        check(r.ok);
        const d = await request(`${server.uri}/library/metadata/2`, server.token), item = d.MediaContainer.Metadata[0];
        const comparison = { client: i, beforeOffset: baseline.offset, afterOffset: item.viewOffset || 0,
          beforeWatched: baseline.watched, afterWatched: Boolean(item.viewCount) };
        diagnostic ??= []; diagnostic.push({ restoration: comparison });
        check(comparison.afterOffset === comparison.beforeOffset && comparison.afterWatched === comparison.beforeWatched);
      } catch { add(`restore-client-${i}`, "NOT_VERIFIED"); clean = false; }
    }
  }
  if (relay?.exitCode === null) { const ended = new Promise(ok => relay.once('close', ok)); relay.kill('SIGKILL'); await ended; }
  await vite?.close(); await rm(cacheDir, { recursive: true, force: true });
  add('cleanup-and-restore', clean ? 'PASS' : 'NOT_VERIFIED');
}
const report = { schema: 1, applicationSha256, operation, diagnostic, scope: 'Two real native clients, UI creator/invite/join/start/stop, QA fixture 2, production relay', rows };
const output = JSON.stringify(report, null, 2) + '\n';
if (process.env.PREXU_JOURNEY_REPORT) await writeFile(process.env.PREXU_JOURNEY_REPORT, output, { mode: 0o600 });
process.stdout.write(output);
process.exitCode = rows.some(r => r.status !== 'PASS') ? 1 : 0;
