/** Real-service browser slice. Never serialize browser state or raw errors. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer as createSocketServer } from 'node:net';

if (process.env.DEBUG) {
  process.stderr.write('Unset DEBUG before running credential-bearing journeys.\n');
  process.exit(1);
}
async function unusedPort() {
  const socket = createSocketServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}
const rows = [];
let browser, vite;
let stage = 'qa-discovery';
const token = process.env.PREXU_QA_PLEX_AUTH;
const reportPath = process.env.PREXU_JOURNEY_REPORT;
const add = (journey, status, reason) => rows.push({ journey, status, reason });
const check = (condition) => { if (!condition) throw new Error('assertion'); };
async function request(url, credential) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Plex-Token': credential,
      'X-Plex-Client-Identifier': 'prexu-real-journeys' },
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  check(response.ok);
  return response.json();
}
async function step(name, action) {
  try { await action(); add(name, 'PASS', 'Observed in isolated browser against QA service'); }
  catch { add(name, 'FAIL', 'Assertion or bounded operation failed; raw errors suppressed'); }
}
async function until(action, timeout = 20000) {
  const end = Date.now() + timeout;
  do {
    if (await action()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < end);
  throw new Error('deadline');
}
try {
  if (!token) {
    add('prerequisites', process.argv.includes('--allow-missing-service') ? 'SKIP' : 'FAIL',
      'PREXU_QA_PLEX_AUTH is missing');
  } else {
    const resources = await request('https://plex.tv/api/v2/resources?includeHttps=1', token);
    const resource = resources.find(item => item.name === 'Prexu QA Test Server' && item.provides === 'server');
    check(resource);
    let server, fixture;
    for (const connection of resource.connections) {
      try {
        const candidate = new URL(connection.uri);
        // Only connections returned for the explicitly named QA server are eligible.
        check(['http:', 'https:'].includes(candidate.protocol) && !candidate.username && !candidate.password);
        const result = await request(`${candidate.origin}/library/metadata/2`, resource.accessToken);
        const item = result.MediaContainer.Metadata?.[0];
        check(item?.title === 'Prexu QA Pattern' && item.ratingKey === '2');
        server = { name: resource.name, uri: candidate.origin, accessToken: resource.accessToken,
          machineIdentifier: resource.clientIdentifier, owned: resource.owned };
        fixture = item;
        break;
      } catch { /* Try the next advertised QA connection without exposing its URL. */ }
    }
    check(server && fixture);
    add('qa-fixture', 'PASS', 'Named QA server and synthetic pattern verified');
    stage = 'qa-user';
    const user = await request('https://plex.tv/api/v2/user', token);
    // Bind an ephemeral port ourselves; never attach to somebody else's Vite.
    stage = 'vite-start';
    vite = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: await unusedPort(), strictPort: true, open: false } });
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    stage = 'browser-start';
    browser = await chromium.launch({ headless: true, timeout: 30000 });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    // Browser logs, screenshots, video, traces and storageState are deliberately never saved.
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    stage = 'app-load';
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
    stage = 'seed-profile';
    const clientIdentifier = randomUUID();
    await page.evaluate(({ token, server, user, clientIdentifier }) => {
      localStorage.clear();
      localStorage.setItem('auth_data', JSON.stringify({ authToken: token, clientIdentifier }));
      localStorage.setItem('client_identifier', JSON.stringify(clientIdentifier));
      localStorage.setItem('server_data', JSON.stringify(server));
      localStorage.setItem('active_user', JSON.stringify({ id: user.id, title: user.username,
        thumb: user.thumb, isAdmin: true, token }));
      // Prevent auto-discovery from connecting to a non-test relay.
      localStorage.setItem('prexu_relay_url', JSON.stringify('ws://127.0.0.1:1/ws'));
    }, { token, server, user, clientIdentifier });
    await step('session-restore', async () => {
      await page.reload();
      await page.goto(`${origin}/item/2`);
      await page.getByRole('heading', { name: 'Prexu QA Pattern', exact: true }).waitFor();
      await page.reload();
      await page.getByRole('heading', { name: 'Prexu QA Pattern', exact: true }).waitFor();
    });
    await step('browse-search-detail', async () => {
      check(/^\d+$/.test(String(fixture.librarySectionID)));
      await page.goto(`${origin}/library/${fixture.librarySectionID}`);
      await page.getByText(fixture.title, { exact: true }).first().waitFor();
      await page.goto(`${origin}/search?q=Prexu%20QA%20Pattern`);
      await page.getByText('Prexu QA Pattern', { exact: true }).first().click();
      await until(async () => new URL(page.url()).pathname === '/item/2');
      await page.getByRole('heading', { name: fixture.title, exact: true }).waitFor();
      const current = await request(`${server.uri}/library/metadata/2`, server.accessToken);
      check(current.MediaContainer.Metadata[0].title === fixture.title);
    });
    await step('settings-persistence', async () => {
      await page.goto(`${origin}/settings/playback`);
      const quality = page.locator('select').filter({ has: page.locator('option[value="original"]') });
      await quality.selectOption('720p');
      await until(async () => page.evaluate(() => Object.entries(localStorage).some(([key, value]) =>
        key.startsWith('prexu_preferences') && JSON.parse(value)?.playback?.quality === '720p')));
      await page.reload();
      await until(async () => (await quality.inputValue()) === '720p');
    });
    add('login', 'NOT_RUN', 'Native shell PIN opening is not exercised by browser storage seeding');
    add('play-resume-watch-state', 'NOT_RUN', 'Native playback and service watch-state restoration still need a desktop adapter');
    add('queue-postplay', 'NOT_RUN', 'Playback completion and queue advancement still need a desktop adapter');
    add('downloads-offline', 'UNSUPPORTED', 'Browser cannot invoke the Tauri download backend; desktop adapter required');
    add('two-client-relay', process.env.PREXU_QA_PLEX_GUEST_AUTH ? 'NOT_RUN' : 'SKIP', 'Pending second account; relay acceptance remains required');
  }
} catch {
  add('setup', 'FAIL', `Failed during ${stage}; raw errors suppressed`);
} finally {
  let cleanup = true;
  try { await browser?.close(); } catch { cleanup = false; }
  try { await vite?.close(); } catch { cleanup = false; }
  add('cleanup', cleanup ? 'PASS' : 'FAIL', 'Run-owned browser and Vite closed; no persistent browser profile');
}
const report = { schema: 1, scope: 'real-service browser slice; NOT full journey acceptance', rows };
const output = JSON.stringify(report, null, 2) + '\n';
if (reportPath) await writeFile(reportPath, output, { mode: 0o600 });
process.stdout.write(output);
// Partial coverage must never masquerade as the required full acceptance gate.
process.exitCode = rows.some(row => ['FAIL', 'BLOCKED', 'NOT_RUN', 'UNSUPPORTED'].includes(row.status)) ? 1 : 0;
