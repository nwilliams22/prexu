/** Linux native login slice. Raw app output and credentials are never exported. */
import { createServer } from 'vite';
import { downloadProxy } from './download-proxy.mjs';
import { pinCode, validEvent } from './native-contract.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

const cleanupMode = process.env.PREXU_JOURNEY_DOWNLOAD_CLEANUP === '1';
const fixtureKey = cleanupMode ? '12' : '2';
const fixtureTitle = cleanupMode ? 'Prexu QA HEVC8' : 'Prexu QA Pattern';
const searchMode = process.env.PREXU_JOURNEY_SEARCH_SELECTION === '1';
const pausedMode = process.env.PREXU_JOURNEY_PAUSED_LOAD === '1';
const offlineOnly = process.env.PREXU_JOURNEY_OFFLINE_ONLY === '1';
const queueOnly = process.env.PREXU_JOURNEY_QUEUE_ONLY === '1';
const storageMode = process.env.PREXU_JOURNEY_DOWNLOAD_STORAGE === '1';
const moveMode = process.env.PREXU_JOURNEY_DOWNLOAD_MOVE === '1';
const queueMode = moveMode || process.env.PREXU_JOURNEY_DOWNLOAD_QUEUE === '1';
let queueFixtures, queueProxy, queueProxyUrl;
const resumedRanges = [];
let displayNumber;
const rows = [];
const watchComparisons = [];
const diagnostics = [];
const add = (journey, status) => { const reason = status === 'UNSUPPORTED' ? 'QA fixture is too short for the 60-second resume threshold' : status === 'SKIP' ? 'Pending second account: PREXU_QA_PLEX_GUEST_AUTH is not provisioned' : status === 'NOT_RUN' ? 'Required scenario did not complete' : undefined; rows.push({ journey, status, ...(reason ? { reason } : {}) }); if (process.env.PREXU_JOURNEY_PROGRESS === '1') process.stderr.write(`${journey}: ${status}\n`); };
const token = process.env.PREXU_QA_PLEX_AUTH;
const appPath = resolve(process.env.PREXU_JOURNEY_APP || 'src-tauri/target/debug/prexu');
let applicationSha256;
let server, baseline, watchComparison, appClient;
let serviceContended = false;
let root, vite, app, xvfb, stage = 'prerequisites';
let finish, restartApp;
let restarted = false, ending = false, restartCount = 0;
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
  if (process.env.DEBUG || !token || process.platform !== 'linux' || ((cleanupMode || queueMode || storageMode) && !process.env.PREXU_JOURNEY_SCREENSHOTS)) throw new Error('prerequisites');
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
      const data = await (await request(`${candidate.uri}/library/metadata/${fixtureKey}`, { headers: { 'X-Plex-Token': candidate.token } })).json();
      const item = data.MediaContainer.Metadata?.[0];
      if (item?.title !== fixtureTitle || item.duration < 30000 || item.duration >= 120000) continue;
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
  if (!cleanupMode && !searchMode && !queueMode && !storageMode && !offlineOnly && !baseline.watched) { server = undefined; baseline = undefined; throw new Error('fixture-state'); }
  if (moveMode) {
    stage = 'qa-download-fixtures';
    queueFixtures = [];
    for (const [key, title] of [['13', 'Prexu QA Lossless Surround'], ['3', 'Prexu QA Surround']]) {
      const data = await (await request(`${server.uri}/library/metadata/${key}`, { headers: { 'X-Plex-Token': server.token } })).json();
      const item = data.MediaContainer.Metadata?.[0];
      if (item?.title !== title || item.type !== 'movie' || !(item.Media?.[0]?.Part?.[0]?.size > 50000000)) throw new Error('fixtures');
      queueFixtures.push({ key, title });
    }
  }
  if (storageMode || (queueMode && !moveMode)) {
    stage = queueMode ? 'qa-download-fixtures' : 'qa-storage-fixtures';
    const data = await (await request(`${server.uri}/library/metadata/17/allLeaves`, { headers: { 'X-Plex-Token': server.token } })).json();
    const episodes = data.MediaContainer.Metadata || [];
    queueFixtures = episodes.filter(item => item.grandparentTitle === 'Prexu QA Seasons' && item.parentIndex === 1 && [1, 2].includes(item.index))
      .sort((a, b) => a.index - b.index).map(item => ({ key: item.ratingKey, title: item.title, seasonKey: item.parentRatingKey, offset: item.viewOffset || 0, watched: Boolean(item.viewCount) }));
    if (queueFixtures.length !== 2 || !queueFixtures[0].seasonKey) throw new Error('fixtures');
  }
  if (queueMode && !moveMode) {
    // Real QA bytes, bounded to a repeatable speed so Pause can interrupt a
    // nonempty transfer. No metadata, file contents, or download state is seeded.
    queueProxy = await downloadProxy({ uri: server.uri, token: server.token, onResume: offset => resumedRanges.push(offset) });
    queueProxyUrl = queueProxy.url;
  }
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
            res.end((await readFile(new URL(cleanupMode ? './download-cleanup-driver.js' : searchMode ? './search-selection-driver.js' : moveMode ? './download-move-driver.js' : storageMode ? './download-storage-driver.js' : pausedMode ? './paused-load-driver.js' : queueMode ? './download-queue-driver.js' : './native-driver.js', import.meta.url), 'utf8')).replace('__QUEUE_PROXY__', JSON.stringify(queueProxyUrl)).replace('__MOVE_DIRECTORY__', JSON.stringify(`${root}/moved`)).replace('__JOURNEY_ENDPOINT__', JSON.stringify(endpoint)).replace('__QUEUE_FIXTURES__', JSON.stringify(queueFixtures)).replace('__JOURNEY_BASELINE__', JSON.stringify(baseline)).replace('__JOURNEY_OFFLINE_ONLY__', JSON.stringify(offlineOnly)).replace('__JOURNEY_QUEUE_ONLY__', JSON.stringify(queueOnly)).replace('__JOURNEY_RESTARTED__', JSON.stringify(restarted)));
            return;
          }
          if (req.method !== 'POST') throw new Error('method');
          let body = '';
          for await (const chunk of req) { body += chunk; if (body.length > 4096) throw new Error('size'); }
          if (req.url === `${endpoint}/open`) {
            if (moveMode && body === `${root}/moved/Prexu`) {
              add('download-move-open-folder', 'PASS'); res.end('ok'); return;
            }
            if (linked) throw new Error('duplicate');
            const code = pinCode(body);
            appClient = new URLSearchParams(new URL(body).hash.slice(2)).get('clientID');
            if (!appClient || !/^[a-zA-Z0-9_-]{1,128}$/.test(appClient)) throw new Error('pin');
            await request('https://plex.tv/api/v2/pins/link', { method: 'PUT',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Plex-Product': 'Plex Web' }, body: new URLSearchParams({ code }) });
            linked = true;
            if (queueMode) add('download-pin-linked', 'PASS');
          } else if (moveMode && req.url === `${endpoint}/choose-folder`) {
            await mkdir(`${root}/moved`, { recursive: true });
            await sleep(1500);
            const env = { ...process.env, DISPLAY: `:${displayNumber}` };
            const dialog = spawnSync('xdotool', ['search', '--onlyvisible', '--name', '^Choose an empty folder for downloads$'], { env, encoding: 'utf8', timeout: 5000 }).stdout?.trim().split('\n').at(-1);
            if (!/^\d+$/.test(dialog || '')) throw new Error('event');
            spawnSync('xdotool', ['windowfocus', dialog], { env, stdio: 'ignore', timeout: 5000 });
            // GTK's Recent view does not accept an empty typed folder reliably.
            // Home is the isolated profile; select its existing moved folder.
            for (const args of [['key', 'alt+Home'], ['key', 'ctrl+l'], ['type', '--clearmodifiers', `${root}/moved`]]) {
              if (spawnSync('xdotool', args, { env, stdio: 'ignore', timeout: 5000 }).status !== 0) throw new Error('event');
              await sleep(500);
            }
            spawnSync('xdotool', ['key', 'Return'], { env, stdio: 'ignore', timeout: 5000 });
            await sleep(1000);
            spawnSync('xdotool', ['key', 'alt+o'], { env, stdio: 'ignore', timeout: 5000 });
          } else if (req.url === `${endpoint}/restart`) {
            if (!linked || !restartApp || restartCount >= (cleanupMode ? 2 : 1) || !rows.some(row => ['native-download', 'download-queue-reordered', 'cleanup-current-session-on', 'cleanup-current-session-off'].includes(row.journey) && row.status === 'PASS')) throw new Error('event');
            const restart = restartApp;
            restartCount++;
            res.end('ok');
            await restart();
            return;
          } else if (req.url === `${endpoint}/diagnostic`) {
            const input = JSON.parse(body);
            if (!['native-login', 'native-queue-start', 'native-queue-eof', 'native-queue-postplay', 'native-offline'].includes(input.stage) ||
                !Number.isFinite(input.time) || input.time < 0 || input.time > 130 ||
                Object.keys(input).sort().join(',') !== 'errorWords,invalidUrl,loadFailed,missing,nativeError,noMedia,retry,scheme,stage,time' ||
                ['retry','missing','scheme','noMedia','loadFailed','invalidUrl'].some(key => typeof input[key] !== 'boolean')) throw new Error('event');
            if (!Array.isArray(input.errorWords) || input.errorWords.some(word => !['mpv','file','invalid','permission','denied','download','resolve','stream','load','format','argument','fetch','network','http','empty','scheme','protocol','channel','closed','ipc','undefined','null','cannot','video','media','abort','timeout','connection','refused','failed','error'].includes(word))) throw new Error('event');
            if (!/^Raw\(-?\d+\)$/.test(input.nativeError) && !['none','other','InvalidUtf8','Null'].includes(input.nativeError)) throw new Error('event');
            diagnostics.push(input);
          } else if (req.url === `${endpoint}/watch`) {
            if (!await serviceIsExclusive()) throw new Error('service-busy');
            const data = await (await request(`${server.uri}/library/metadata/${fixtureKey}`, { headers: { 'X-Plex-Token': server.token } })).json();
            const item = data.MediaContainer.Metadata?.[0];
            if (item?.title !== fixtureTitle) throw new Error('event');
            res.setHeader('Content-Type', 'application/json');
            const input = JSON.parse(body);
            if (!Number.isFinite(input.expectedMs) || input.expectedMs < 0 || input.expectedMs > 120000) throw new Error('event');
            watchComparison = { expectedMs: input.expectedMs, observedMs: item.viewOffset || 0, watched: Boolean(item.viewCount) };
            if (watchComparisons.length < 20 && JSON.stringify(watchComparisons.at(-1)) !== JSON.stringify(watchComparison)) watchComparisons.push(watchComparison);
            res.end(JSON.stringify({ offset: item.viewOffset || 0, watched: Boolean(item.viewCount) }));
            return;
          } else if ((cleanupMode || queueMode || storageMode || searchMode) && req.url === `${endpoint}/resize`) {
            const env = { PATH: process.env.PATH, DISPLAY: `:${displayNumber}` };
            const windows = spawnSync('xdotool', ['search', '--onlyvisible', '--name', '^Prexu$'], { env, encoding: 'utf8', timeout: 1000 });
            const windowId = windows.stdout?.trim().split('\n').at(-1);
            if (!/^\d+$/.test(windowId || '')) throw new Error('event');
            const resized = spawnSync('xdotool', ['windowsize', windowId, searchMode ? '1200' : '1900', searchMode ? '760' : '1000', 'windowmove', windowId, '0', '0'], { env, stdio: 'ignore', timeout: 1000 });
            if (resized.status !== 0) throw new Error('event');
          } else if ((cleanupMode || queueMode || storageMode || searchMode) && req.url === `${endpoint}/screenshot`) {
            if (!['setting-on', 'setting-off', 'same-session-on', 'same-session-off', 'enabled-removed', 'disabled-retained', 'failure', 'grouped', 'search-detail', 'paused', 'complete', 'diagnostic', 'storage-summary', 'storage-warning', 'move-confirm', 'move-complete', 'move-playback'].includes(body) || !displayNumber || !process.env.PREXU_JOURNEY_SCREENSHOTS) throw new Error('event');
            await mkdir(process.env.PREXU_JOURNEY_SCREENSHOTS, { recursive: true });
            const shot = spawnSync('import', ['-display', `:${displayNumber}`, '-window', 'root', resolve(process.env.PREXU_JOURNEY_SCREENSHOTS, `${body}.png`)], { stdio: 'ignore', timeout: 10000 });
            if (shot.status !== 0) throw new Error('event');
          } else if (req.url === endpoint) {
            const event = JSON.parse(body);
            if (!validEvent(event)) throw new Error('event');
            if (event.journey === 'native-login' && event.status === 'PASS' && !linked) throw new Error('unlinked');
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
  xvfb = spawn('Xvfb', ['-displayfd','3','-screen','0',queueMode ? '1920x1080x24' : '1280x800x24','-nolisten','tcp','-ac'],
    { detached: true, stdio: ['ignore','ignore','ignore',display.fd] });
  children.push(xvfb);
  xvfb.on('error', () => finish('display-start'));
  await display.close();
  let number;
  for (let i=0; i<50; i++) { number = (await readFile(displayFile,'utf8')).trim(); if (/^\d+$/.test(number)) break; await sleep(100); }
  if (!/^\d+$/.test(number)) throw new Error('display');
  displayNumber = number;
  const env = {};
  for (const name of ['PATH','LANG','LD_LIBRARY_PATH']) if (process.env[name]) env[name] = process.env[name];
  Object.assign(env, { PATH: `${root}/bin:${env.PATH}`, HOME: root, XDG_CONFIG_HOME: `${root}/config`,
    XDG_DATA_HOME: `${root}/data`, XDG_CACHE_HOME: `${root}/cache`, XDG_RUNTIME_DIR: root,
    DISPLAY: `:${number}`, GDK_BACKEND: 'x11', LIBGL_ALWAYS_SOFTWARE: '1' });
  if (storageMode) env.PREXU_QA_DOWNLOAD_FREE_BYTES = '1';
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
  const timer = setTimeout(() => finish('deadline'), 480000);
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
  if (queueProxy) await queueProxy.close();
  if (queueMode && !moveMode && rows.some(row => row.journey === 'download-queue-complete' && row.status === 'PASS')) add('download-queue-range-resume', resumedRanges.length ? 'PASS' : 'FAIL');
  try { await vite?.close(); } catch { clean = false; }
  if (server && baseline && app && !queueMode && !storageMode && !searchMode) {
    try {
      const exclusive = await serviceIsExclusive();
      if (!exclusive) {
        add('service-state-restoration-skipped-busy', 'FAIL');
        clean = false;
      } else {
      if (cleanupMode) await request(`${server.uri}/:/${baseline.watched ? 'scrobble' : 'unscrobble'}?identifier=com.plexapp.plugins.library&key=${fixtureKey}`, { headers: { 'X-Plex-Token': server.token } });
      const query = new URLSearchParams({ ratingKey: fixtureKey, key: `/library/metadata/${fixtureKey}`, state: 'stopped',
        time: String(baseline.offset), duration: String(baseline.duration), 'X-Plex-Client-Identifier': appClient });
      // The offline-only slice never plays against the live server. Verify
      // its state without issuing a synthetic timeline mutation.
      if (!offlineOnly) await request(`${server.uri}/:/timeline?${query}`, { headers: { 'X-Plex-Token': server.token, 'X-Plex-Client-Identifier': appClient } });
      const data = await (await request(`${server.uri}/library/metadata/${fixtureKey}`, { headers: { 'X-Plex-Token': server.token } })).json();
      const item = data.MediaContainer.Metadata?.[0];
      const restored = item?.title === fixtureTitle && (item.viewOffset || 0) === baseline.offset && Boolean(item.viewCount) === baseline.watched;
      add('service-state-restored', restored ? 'PASS' : 'FAIL');
      if (!restored) clean = false;
      }
    } catch { add('service-state-restored', 'FAIL'); clean = false; }
  }
  if (queueMode && !moveMode && queueFixtures && server && app) {
    try {
      let unchanged = await serviceIsExclusive();
      for (const fixture of queueFixtures) {
        const data = await (await request(`${server.uri}/library/metadata/${fixture.key}`, { headers: { 'X-Plex-Token': server.token } })).json();
        const item = data.MediaContainer.Metadata?.[0];
        unchanged &&= item?.title === fixture.title && (item.viewOffset || 0) === fixture.offset && Boolean(item.viewCount) === fixture.watched;
      }
      add('service-state-restored', unchanged ? 'PASS' : 'FAIL');
      if (!unchanged) clean = false;
    } catch { add('service-state-restored', 'FAIL'); clean = false; }
  }
  try { if (root) { spawnSync('fusermount3', ['-u', `${root}/doc`], { stdio: 'ignore' }); await rm(root, { recursive: true, force: true, maxRetries: 3 });
    let absent = false;
    try { await lstat(root); } catch (error) { if (error.code === 'ENOENT') absent = true; else throw error; }
    if (!absent) throw new Error('profile-remains');
    if (moveMode) add('download-move-folders-cleaned', 'PASS');
  } } catch (error) { add('profile-cleanup-' + (/^[A-Z_]+$/.test(error.code || '') ? error.code : 'error'), 'FAIL'); clean = false; }
  add('cleanup', clean ? 'PASS' : 'FAIL');
}
if (!cleanupMode && !searchMode && !pausedMode && !queueMode && !storageMode && !offlineOnly && rows.some(row => row.journey === 'native-login')) {
  if (!rows.some(row => row.journey === 'native-queue-postplay')) add('queue-postplay', 'NOT_RUN');
  add('two-client-relay', 'NOT_RUN');
}
if (!queueMode && offlineOnly && rows.some(row => row.journey === 'native-login')) {
  for (const journey of ['native-download', 'native-offline', 'native-offline-missing-file']) {
    if (!rows.some(row => row.journey === journey)) add(journey, 'NOT_RUN');
  }
}
if (queueMode && !moveMode && rows.some(row => row.journey === 'native-login')) {
  for (const journey of ['download-queue-paused', 'download-queue-reordered', 'download-queue-restart', 'download-grouping', 'download-queue-complete', 'download-queue-delete', 'download-queue-settings']) {
    if (!rows.some(row => row.journey === journey)) add(journey, 'NOT_RUN');
  }
}
const report = { schema: 1, applicationSha256, fixtureDurationMs: baseline?.duration, watchComparison, watchComparisons, diagnostics, binarySourceRevision: 'not independently verified', scope: cleanupMode ? 'real desktop watched download cleanup across two process restarts; QA HEVC8 only' : searchMode ? 'real desktop rapid search suggestion selection; detail retained after 500 ms' : moveMode ? 'real desktop folder picker, verified move, open-folder dispatch and local playback from QA download' : storageMode ? 'real desktop storage summary and QA season warning/cancel; debug free-space override of 1 byte' : pausedMode ? 'real desktop native IPC paused preparation; lobby integration not exercised' : queueMode ? 'real desktop download queue controls with QA season episodes' : offlineOnly ? 'native offline slice; NOT full journey acceptance' : queueOnly ? 'native queue/offline slice; NOT full journey acceptance' : 'native single-user slice; NOT full journey acceptance', rows };
const output = JSON.stringify(report, null, 2) + '\n';
if (process.env.PREXU_JOURNEY_REPORT) await writeFile(process.env.PREXU_JOURNEY_REPORT, output, { mode: 0o600 });
process.stdout.write(output);
process.exitCode = rows.some(row => ['FAIL', 'UNSUPPORTED', 'NOT_RUN', 'BLOCKED', 'SKIP'].includes(row.status)) ? 1 : 0;
