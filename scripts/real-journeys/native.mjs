/** Linux native login slice. Raw app output and credentials are never exported. */
import { createServer } from 'vite';
import { pinCode, validEvent } from './native-contract.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

const offlineOnly = process.env.PREXU_JOURNEY_OFFLINE_ONLY === '1';
const rows = [];
const add = (journey, status) => { const reason = status === 'UNSUPPORTED' ? 'QA fixture is too short for the 60-second resume threshold' : status === 'BLOCKED' ? 'Second authorized QA identity is not provisioned' : status === 'NOT_RUN' ? 'Required scenario did not complete' : undefined; rows.push({ journey, status, ...(reason ? { reason } : {}) }); if (process.env.PREXU_JOURNEY_PROGRESS === '1') process.stderr.write(`${journey}: ${status}\n`); };
const token = process.env.PREXU_QA_PLEX_AUTH;
const appPath = resolve(process.env.PREXU_JOURNEY_APP || 'src-tauri/target/debug/prexu');
let applicationSha256;
let server, baseline, watchComparison, appClient;
let serviceContended = false;
let root, vite, app, xvfb, stage = 'prerequisites';
let finish, restartApp;
let restarted = false, ending = false;
const completed = new Promise(resolve => { finish = resolve; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => finish('interrupted'));
const children = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function child(command, args, env) {
  const process = spawn(command, args, { env, detached: true, stdio: 'ignore' });
  children.push(process);
  process.on('error', () => finish('child-start'));
  return process;
}
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Accept: 'application/json', 'X-Plex-Token': token,
      'X-Plex-Client-Identifier': 'prexu-native-journeys', ...options.headers } });
  if (!response.ok) throw new Error(`service-${response.status}`);
  return response;
}
async function serviceIsExclusive() {
  const data = await (await request(`${server.uri}/status/sessions`, { headers: { 'X-Plex-Token': server.token } })).json();
  const other = (data.MediaContainer.Metadata || []).some(item => item.Player?.state !== 'stopped' && item.Player?.machineIdentifier !== appClient);
  serviceContended ||= other;
  return !other && !serviceContended;
}

try {
  if (process.env.DEBUG || !token || process.platform !== 'linux') throw new Error('prerequisites');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(appPath)) hash.update(chunk);
  applicationSha256 = hash.digest('hex');
  // Refuse accounts with other servers: normal native discovery must stay QA-only.
  stage = 'qa-account-scope';
  const resources = await (await request('https://plex.tv/api/v2/resources?includeHttps=1')).json();
  const servers = resources.filter(r => r.provides.split(',').includes('server'));
  if (servers.length !== 1 || servers[0].name !== 'Prexu QA Test Server') throw new Error('scope');
  stage = 'qa-fixture';
  for (const connection of servers[0].connections) {
    try {
      const uri = new URL(connection.uri);
      if (!['http:', 'https:'].includes(uri.protocol) || uri.username || uri.password) continue;
      const candidate = { uri: uri.origin, token: servers[0].accessToken };
      const data = await (await request(`${candidate.uri}/library/metadata/2`, { headers: { 'X-Plex-Token': candidate.token } })).json();
      const item = data.MediaContainer.Metadata?.[0];
      if (item?.title !== 'Prexu QA Pattern' || item.duration < 30000 || item.duration >= 120000) continue;
      server = candidate;
      baseline = { offset: item.viewOffset || 0, duration: item.duration, watched: Boolean(item.viewCount) };
      break;
    } catch { /* Only the named QA resource's connections are eligible. */ }
  }
  if (!server) throw new Error('fixture');
  stage = 'qa-service-idle';
  const sessions = await (await request(`${server.uri}/status/sessions`, { headers: { 'X-Plex-Token': server.token } })).json();
  if ((sessions.MediaContainer.Metadata || []).some(item => item.Player?.state !== 'stopped')) {
    // Do not restore or otherwise mutate a fixture owned by another session.
    server = undefined;
    baseline = undefined;
    throw new Error('busy');
  }
  stage = 'qa-fixture-state';
  if (!offlineOnly && (!baseline.watched || baseline.offset)) { server = undefined; baseline = undefined; throw new Error('fixture-state'); }
  root = await mkdtemp(`${tmpdir()}/prexu-native-journey-`);
  await mkdir(`${root}/bin`);
  const nonce = randomBytes(24).toString('hex');
  const endpoint = `/__journey/${nonce}`;
  let linked = false;
  stage = 'vite-start';
  vite = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 1420, strictPort: true, open: false }, plugins: [{
    name: 'isolated-native-journey',
    transformIndexHtml() { return [{ tag: 'script', attrs: { type: 'module', src: `${endpoint}/driver.js` }, injectTo: 'body' }]; },
    configureServer(viteServer) {
      viteServer.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(endpoint)) return next();
        try {
          if (req.url === `${endpoint}/driver.js` && req.method === 'GET') {
            res.setHeader('Content-Type', 'text/javascript');
            res.end((await readFile(new URL('./native-driver.js', import.meta.url), 'utf8')).replace('__JOURNEY_ENDPOINT__', JSON.stringify(endpoint)).replace('__JOURNEY_BASELINE__', JSON.stringify(baseline)).replace('__JOURNEY_OFFLINE_ONLY__', JSON.stringify(offlineOnly)).replace('__JOURNEY_RESTARTED__', JSON.stringify(restarted)));
            return;
          }
          if (req.method !== 'POST') throw new Error('method');
          let body = '';
          for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error('size'); }
          if (req.url === `${endpoint}/open`) {
            if (linked) throw new Error('duplicate');
            const code = pinCode(body);
            appClient = new URLSearchParams(new URL(body).hash.slice(2)).get('clientID');
            if (!appClient || !/^[a-zA-Z0-9_-]{1,128}$/.test(appClient)) throw new Error('pin');
            await request('https://plex.tv/api/v2/pins/link', { method: 'PUT',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Plex-Product': 'Plex Web' }, body: new URLSearchParams({ code }) });
            linked = true;
          } else if (req.url === `${endpoint}/restart`) {
            if (!linked || !restartApp || !rows.some(row => row.journey === 'native-download' && row.status === 'PASS')) throw new Error('event');
            const restart = restartApp;
            restartApp = undefined;
            res.end('ok');
            await restart();
            return;
          } else if (req.url === `${endpoint}/watch`) {
            if (!await serviceIsExclusive()) throw new Error('service-busy');
            const data = await (await request(`${server.uri}/library/metadata/2`, { headers: { 'X-Plex-Token': server.token } })).json();
            const item = data.MediaContainer.Metadata?.[0];
            if (item?.title !== 'Prexu QA Pattern') throw new Error('event');
            res.setHeader('Content-Type', 'application/json');
            const input = JSON.parse(body);
            if (!Number.isFinite(input.expectedMs) || input.expectedMs < 0 || input.expectedMs > 120000) throw new Error('event');
            watchComparison = { expectedMs: input.expectedMs, observedMs: item.viewOffset || 0, watched: Boolean(item.viewCount) };
            res.end(JSON.stringify({ offset: item.viewOffset || 0, watched: Boolean(item.viewCount) }));
            return;
          } else if (req.url === endpoint) {
            const event = JSON.parse(body);
            if (!validEvent(event)) throw new Error('event');
            if (event.journey === 'native-login' && !linked) throw new Error('unlinked');
            add(event.journey, event.status);
            if (event.journey === 'native-driver') finish(event.status);
          } else throw new Error('route');
          res.end('ok');
        } catch (error) { res.statusCode = 400; res.end('failed'); finish('bridge-' + (/^(service-[0-9]{3}|service-busy|method|size|duplicate|origin|pin|event|unlinked|route)$/.test(error.message) ? error.message : 'failed')); }
      });
    },
  }] });
  await vite.listen();
  // The real shell-open command reaches this per-run desktop URL handler. It
  // links only the newly-created PIN using the authorized protected QA token.
  await writeFile(`${root}/bin/xdg-open`, `#!/usr/bin/python3\nimport sys, urllib.request\ntry:\n r=urllib.request.Request('http://127.0.0.1:1420${endpoint}/open', data=sys.argv[1].encode(), method='POST')\n urllib.request.urlopen(r, timeout=20).read()\nexcept Exception:\n sys.exit(1)\n`, { mode: 0o700 });
  // Xvfb allocates an unused display itself, avoiding another run's display.
  stage = 'display-start';
  const displayFile = `${root}/display`;
  const { open } = await import('node:fs/promises');
  const display = await open(displayFile, 'wx', 0o600);
  xvfb = spawn('Xvfb', ['-displayfd','3','-screen','0','1280x800x24','-nolisten','tcp','-ac'],
    { detached: true, stdio: ['ignore','ignore','ignore',display.fd] });
  children.push(xvfb);
  xvfb.on('error', () => finish('display-start'));
  await display.close();
  let number;
  for (let i=0; i<50; i++) { number = (await readFile(displayFile,'utf8')).trim(); if (/^\d+$/.test(number)) break; await sleep(100); }
  if (!/^\d+$/.test(number)) throw new Error('display');
  const env = {};
  for (const name of ['PATH','LANG','LD_LIBRARY_PATH']) if (process.env[name]) env[name] = process.env[name];
  Object.assign(env, { PATH: `${root}/bin:${env.PATH}`, HOME: root, XDG_CONFIG_HOME: `${root}/config`,
    XDG_DATA_HOME: `${root}/data`, XDG_CACHE_HOME: `${root}/cache`, XDG_RUNTIME_DIR: root,
    DISPLAY: `:${number}`, GDK_BACKEND: 'x11', LIBGL_ALWAYS_SOFTWARE: '1' });
  stage = 'native-run';
  function launch() {
    const launched = child('dbus-run-session', ['--', appPath], env);
    app = launched;
    launched.on('exit', (code, signal) => {
      if (app === launched) finish(`app-exit-${Number.isInteger(code) ? code : signal === 'SIGABRT' ? 'abort' : 'signal'}`);
    });
  }
  restartApp = async () => {
    // Allow WebKit localStorage and the native secure store to flush to disk.
    await sleep(2000);
    if (ending) return;
    restarted = true;
    const previous = app;
    app = undefined;
    const closed = new Promise(resolve => previous.once('close', resolve));
    globalThis.process.kill(-previous.pid, 'SIGTERM');
    const force = setTimeout(() => {
      try { globalThis.process.kill(-previous.pid, 'SIGKILL'); } catch { /* Already exited. */ }
    }, 3000);
    await closed;
    clearTimeout(force);
    if (!ending) launch();
  };
  launch();
  const timer = setTimeout(() => finish('deadline'), 300000);
  const result = await completed;
  clearTimeout(timer);
  if (result !== 'PASS') { stage = result === 'FAIL' ? 'native-run' : result; throw new Error('native'); }
} catch { add(stage, 'FAIL'); }
finally {
  ending = true;
  let clean = true;
  for (const process of children.reverse()) {
    if (!process.pid) continue;
    try { globalThis.process.kill(-process.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') { add('process-cleanup-' + (['EPERM','EINVAL'].includes(error.code) ? error.code : 'error'), 'FAIL'); clean = false; } }
  }
  await Promise.all(children.map(p => p.exitCode !== null || p.signalCode !== null ? Promise.resolve() : new Promise(resolve => { p.once('close', resolve); setTimeout(resolve, 3000).unref(); })));
  try { await vite?.close(); } catch { clean = false; }
  if (server && baseline && app) {
    try {
      const exclusive = await serviceIsExclusive();
      if (!exclusive) {
        add('service-state-restoration-skipped-busy', 'FAIL');
        clean = false;
      } else {
      const query = new URLSearchParams({ ratingKey: '2', key: '/library/metadata/2', state: 'stopped',
        time: String(baseline.offset), duration: String(baseline.duration) });
      await request(`${server.uri}/:/timeline?${query}`, { headers: { 'X-Plex-Token': server.token } });
      const data = await (await request(`${server.uri}/library/metadata/2`, { headers: { 'X-Plex-Token': server.token } })).json();
      const item = data.MediaContainer.Metadata?.[0];
      const restored = item?.title === 'Prexu QA Pattern' && (item.viewOffset || 0) === baseline.offset && Boolean(item.viewCount) === baseline.watched;
      add('service-state-restored', restored ? 'PASS' : 'FAIL');
      if (!restored) clean = false;
      }
    } catch { add('service-state-restored', 'FAIL'); clean = false; }
  }
  try { if (root) { spawnSync('fusermount3', ['-u', `${root}/doc`], { stdio: 'ignore' }); await rm(root, { recursive: true, force: true, maxRetries: 3 }); } } catch (error) { add('profile-cleanup-' + (/^[A-Z_]+$/.test(error.code || '') ? error.code : 'error'), 'FAIL'); clean = false; }
  add('cleanup', clean ? 'PASS' : 'FAIL');
}
if (!offlineOnly && rows.some(row => row.journey === 'native-login')) {
  if (!rows.some(row => row.journey === 'native-queue-postplay')) add('queue-postplay', 'NOT_RUN');
  add('two-client-relay', 'BLOCKED');
}
if (offlineOnly && rows.some(row => row.journey === 'native-login')) {
  for (const journey of ['native-download', 'native-offline', 'native-offline-missing-file']) {
    if (!rows.some(row => row.journey === journey)) add(journey, 'NOT_RUN');
  }
}
const report = { schema: 1, applicationSha256, watchComparison, binarySourceRevision: 'not independently verified', scope: offlineOnly ? 'native offline slice; NOT full journey acceptance' : 'native single-user slice; NOT full journey acceptance', rows };
const output = JSON.stringify(report, null, 2) + '\n';
if (process.env.PREXU_JOURNEY_REPORT) await writeFile(process.env.PREXU_JOURNEY_REPORT, output, { mode: 0o600 });
process.stdout.write(output);
process.exitCode = rows.some(row => ['FAIL', 'UNSUPPORTED', 'NOT_RUN', 'BLOCKED'].includes(row.status)) ? 1 : 0;
