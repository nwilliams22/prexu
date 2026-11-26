/** Interactive real Mac host / Linux guest acceptance support. No Mac DOM injection. */
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { createServer } from 'vite';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { nativeClient } from './native-client.mjs';
import { safariPin, macLogExcerpt } from './mac-lobby-contract.mjs';
const output = resolve(process.env.PREXU_MAC_EVIDENCE || '/tmp/prexu-mac-lobby');
const relayUrl = 'ws://127.0.0.1:18787/ws';
const accounts = [], children = [], rows = [], restoration = [];
let guest, vite, ownsMac = false, touched = false, stage = 'preflight';
const check = v => { if (!v) throw Error('check'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ssh = command => execFileSync('ssh', ['-n', '-o', 'BatchMode=yes', 'mac-vm', command], { encoding: 'utf8', timeout: 30000 });
const record = (name, status) => { rows.push({ name, status }); console.log(`${name}: ${status}`); };
async function request(url, token) {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'X-Plex-Token': token, 'X-Plex-Client-Identifier': 'prexu-mac-lobby' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  check(r.ok); return r.json();
}
async function until(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await sleep(250); }
  throw Error('deadline');
}
function start(file, args, env = { PATH: process.env.PATH }) {
  const child = spawn(file, args, { env, stdio: 'ignore' });
  child.on('error', () => {}); children.push(child); return child;
}
async function state() {
  return guest.page.evaluate(async () => {
    const p = (await import('/src/services/probe-live.ts')).probeLive.player?.player;
    return { playing: !!p?.isPlaying, time: p?.currentTime || 0, error: !!p?.playbackError };
  });
}
async function capture(name) {
  ssh('open -a Prexu');
  await sleep(750);
  ssh(`screencapture -x /tmp/prexu-${name}.png`);
  execFileSync('scp', ['-o', 'BatchMode=yes', `mac-vm:/tmp/prexu-${name}.png`, `${output}/${name}.png`], { stdio: 'ignore', timeout: 30000 });
}
let interrupted = false;
const input = createInterface({ input: process.stdin, output: process.stdout });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; input.close(); });
try {
  check(!process.env.DEBUG && process.env.PREXU_QA_PLEX_AUTH && process.env.PREXU_QA_PLEX_GUEST_AUTH);
  check(process.env.PREXU_MAC_APP_REVISION && process.env.PREXU_JOURNEY_RELAY && process.env.PREXU_JOURNEY_APP);
  await mkdir(output, { recursive: true, mode: 0o700 });
  for (const token of [process.env.PREXU_QA_PLEX_AUTH, process.env.PREXU_QA_PLEX_GUEST_AUTH]) {
    stage = `account-${accounts.length}-resources`;
    const resources = (await request('https://plex.tv/api/v2/resources?includeHttps=1', token)).filter(r => r.provides.split(',').includes('server'));
    check(resources.length === 1 && resources[0].name === 'Prexu QA Test Server');
    stage = `account-${accounts.length}-fixture`;
    const resource = resources[0]; let server, baseline;
    for (const c of resource.connections) {
      try {
        const u = new URL(c.uri); check(['http:', 'https:'].includes(u.protocol) && !u.username && !u.password);
        const item = (await request(`${u.origin}/library/metadata/16`, resource.accessToken)).MediaContainer.Metadata?.[0];
        check(item?.title === 'Prexu QA MP4 H264 AC3');
        baseline = { offset: item.viewOffset || 0, duration: item.duration, watched: Boolean(item.viewCount) };
        server = { uri: u.origin, token: resource.accessToken }; break;
      } catch { /* Never fall back to a different server. */ }
    }
    check(server); stage = `account-${accounts.length}-identity`; accounts.push({ token, server, baseline, user: await request('https://plex.tv/api/v2/user', token) });
  }
  stage = 'distinct-accounts';
  check(accounts[0].user.id !== accounts[1].user.id);
  stage = 'qa-service-idle';
  const sessions = await request(`${accounts[0].server.uri}/status/sessions`, accounts[0].server.token);
  check(!(sessions.MediaContainer.Metadata || []).some(s => s.Player?.state !== 'stopped'));
  await writeFile(`${output}/before.json`, JSON.stringify(accounts.map(a => a.baseline), null, 2), { mode: 0o600 });
  // Strict port checks prevent attaching to a pre-existing service.
  const { createServer: socketServer } = await import('node:net');
  for (const port of [1420, 18787]) {
    stage = `port-${port}-available`;
    const socket = socketServer();
    await new Promise((ok, fail) => { socket.once('error', fail); socket.listen(port, '127.0.0.1', ok); });
    await new Promise(ok => socket.close(ok));
  }
  const relay = start(resolve(process.env.PREXU_JOURNEY_RELAY), ['--host', '127.0.0.1', '--port', '18787', '--public-url', relayUrl], { PATH: process.env.PATH, RUST_LOG: 'off' });
  await until(async () => { check(relay.exitCode === null); try { return (await fetch('http://127.0.0.1:18787/health')).ok; } catch { return false; } });
  stage = 'production-relay-auth';
  const socket = new WebSocket(relayUrl);
  try {
    check(await new Promise(ok => {
      const timer = setTimeout(() => ok(false), 15000);
      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', plex_token: 'prexu-qa-invalid-credential' }));
      socket.onmessage = e => { clearTimeout(timer); try { ok(JSON.parse(e.data).type === 'auth_error'); } catch { ok(false); } };
      socket.onerror = () => { clearTimeout(timer); ok(false); };
    }));
  } finally { socket.close(); }
  record(stage, 'PASS');
  const tunnel = start('ssh', ['-n', '-N', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-R', '127.0.0.1:18787:127.0.0.1:18787', 'mac-vm']);
  await sleep(1500); check(tunnel.exitCode === null);
  check(ssh('curl -fsS http://127.0.0.1:18787/health').startsWith('OK'));
  ownsMac = true; touched = true; // From here the operator may use the Mac UI.
  guest = nativeClient(accounts[1].token, relayUrl);
  vite = await createServer({ logLevel: 'silent', cacheDir: '.journey-cache/node_modules/.vite-mac-lobby', plugins: [guest.plugin], server: { host: '127.0.0.1', port: 1420, strictPort: true } });
  await vite.listen();
  console.log('Ready. Mac is HOST. Commands: pin, guest, lobby, join, finish. Keep VM muted.');
  for (;;) {
    if (interrupted) break;
    stage = (await input.question('mac-lobby> ')).trim();
    if (stage === 'finish') break;
    if (stage === 'pin') {
      // Safari URL and PIN remain in memory; neither is printed or persisted.
      const url = ssh(`osascript -e 'tell application "Safari" to get URL of current tab of front window'`).trim();
      const code = safariPin(url);
      const r = await fetch('https://plex.tv/api/v2/pins/link', { method: 'PUT', headers: { Accept: 'application/json', 'X-Plex-Token': accounts[0].token, 'X-Plex-Client-Identifier': 'prexu-mac-lobby', 'X-Plex-Product': 'Plex Web', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code }), redirect: 'error', signal: AbortSignal.timeout(15000) });
      check(r.ok); touched = true; record(stage, 'PASS');
    } else if (stage === 'guest') {
      await guest.start();
      await guest.page.goto('http://127.0.0.1:1420/item/16');
      await until(() => guest.page.evaluate(async () => (await import('/src/services/watch-sync.ts')).watchSync.isConnected));
      record(stage, 'PASS');
    } else if (stage === 'lobby') {
      touched = true;
      const tree = ssh('axui dump Prexu 25');
      check(tree.includes('Playback starts when everyone is ready.') && tree.includes('Ready') && tree.includes('Invited'));
      await capture('mac-lobby'); record(stage, 'PASS');
    } else if (stage === 'join') {
      touched = true;
      await guest.page.getByRole('button', { name: 'Join Session' }).click();
      await until(async () => { const s = await state(); check(!s.error); return s.playing && s.time > 1; });
      record(stage, 'PASS');
      // This codec fixture is short: capture immediately after joining.

      const before = await state(); await capture('mac-playback'); await sleep(3000); const after = await state();
      check(before.playing && after.playing && after.time > before.time + 1);
      await capture('mac-playback-later'); record('guest-time-advance', 'PASS');
      // Human verifies two Mac frames and the visible clock; a guest pass is not a Mac pass.
      record('mac-visual-playback', 'REQUIRES_REVIEW');
    } else console.log('Unknown command.');
  }
} catch { record(stage, 'NOT_VERIFIED'); if (guest) console.log(JSON.stringify(guest.diagnostics())); }
finally {
  input.close();
  // Stop writers before restoring service state, including when the operator aborts.
  try { if (ownsMac) ssh(`osascript -e 'tell application "Prexu" to quit'`); } catch { record('mac-stop', 'NOT_VERIFIED'); }
  if (guest) try { await guest.close(); } catch { record('guest-stop', 'NOT_VERIFIED'); }
  if (touched) for (let i = 0; i < accounts.length; i++) {
    try {
      const { server, baseline } = accounts[i];
      await until(async () => {
        const sessions = await request(`${accounts[0].server.uri}/status/sessions`, accounts[0].server.token);
        return !(sessions.MediaContainer.Metadata || []).some(s => s.Player?.state !== 'stopped');
      }, 30000);
      const headers = { 'X-Plex-Token': server.token };
      const mutate = async path => { const r = await fetch(`${server.uri}${path}`, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) }); check(r.ok); };
      if (baseline.offset === 0) await mutate('/:/unscrobble?key=16&identifier=com.plexapp.plugins.library');
      const item = (await request(`${server.uri}/library/metadata/16`, server.token)).MediaContainer.Metadata[0];
      if (Boolean(item.viewCount) !== baseline.watched) await mutate(`/:/${baseline.watched ? 'scrobble' : 'unscrobble'}?key=16&identifier=com.plexapp.plugins.library`);
      if (baseline.offset > 0) await mutate(`/:/timeline?${new URLSearchParams({ ratingKey: '16', key: '/library/metadata/16', state: 'stopped', time: String(baseline.offset), duration: String(baseline.duration) })}`);
      const after = (await request(`${server.uri}/library/metadata/16`, server.token)).MediaContainer.Metadata[0];
      const comparison = { account: i === 0 ? 'mac-host' : 'linux-guest', beforeOffset: baseline.offset, afterOffset: after.viewOffset || 0, beforeWatched: baseline.watched, afterWatched: Boolean(after.viewCount) };
      restoration.push(comparison);
      check(comparison.beforeOffset === comparison.afterOffset && comparison.beforeWatched === comparison.afterWatched);
      record(`restore-${i}`, 'PASS');
    } catch { record(`restore-${i}`, 'NOT_VERIFIED'); }
  }
  if (ownsMac) try {
    const logs = ssh('cat ~/Library/Logs/com.prexu.client/*.log');
    const excerpt = macLogExcerpt(logs);
    check(excerpt.trim());
    await writeFile(`${output}/mac-log-excerpt.txt`, excerpt, { mode: 0o600 });
  } catch { record('log-excerpt', 'NOT_VERIFIED'); }
  for (const child of children.reverse()) if (child.exitCode === null) {
    const ended = new Promise(ok => child.once('close', ok)); child.kill('SIGTERM'); await ended;
  }
  await vite?.close(); await rm('.journey-cache/node_modules/.vite-mac-lobby', { recursive: true, force: true });
  const report = { schema: 1, fixture: { ratingKey: '16', title: 'Prexu QA MP4 H264 AC3' }, macAppRevision: process.env.PREXU_MAC_APP_REVISION, topology: 'Mac host / Linux native guest / production relay over reverse SSH loopback tunnel', rows, restoration,
    linuxBinarySha256: process.env.PREXU_JOURNEY_APP ? createHash('sha256').update(await readFile(process.env.PREXU_JOURNEY_APP)).digest('hex') : null };
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log('Report saved. Capture redacted logs, review Mac frames, then reset VM.');
}
process.exitCode = rows.some(r => r.status !== 'PASS') ? 1 : 0;
