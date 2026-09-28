// Connect to the installed application's real WebView2, never a browser stub.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const [mode, report] = process.argv.slice(2);
if (!['seed', 'retain', 'fresh'].includes(mode) || !report) throw new Error('Invalid arguments');
const deadline = Date.now() + 60_000;
let browser;
let connectionError;
while (!browser && Date.now() < deadline) {
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: Math.max(1, Math.min(10_000, deadline - Date.now())) });
  } catch (error) {
    connectionError = error;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
if (!browser) throw new Error('WebView2 connection failed within 60 seconds', { cause: connectionError });
try {
  let page;
  while (!page && Date.now() < deadline) {
    page = browser.contexts().flatMap(context => context.pages())
      .find(candidate => new URL(candidate.url()).hostname === 'tauri.localhost');
    if (!page) await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!page) throw new Error('Installed application page did not become available');
  await page.getByRole('button', { name: 'Sign in with Plex', exact: true })
    .waitFor({ state: 'visible', timeout: Math.max(1, deadline - Date.now()) });
  // Visibility alone accepts a button covered by the startup splash.
  // Trial click checks hit-testing/actionability without starting Plex auth.
  await page.getByRole('button', { name: 'Sign in with Plex', exact: true })
    .click({ trial: true, timeout: Math.max(1, deadline - Date.now()) });
  const result = await page.evaluate((operation) => {
    if (!window.__TAURI_INTERNALS__) throw new Error('Not the real Tauri runtime');
    const key = 'prexu_preferences';
    const saved = localStorage.getItem(key);
    if (operation === 'fresh' && saved !== null) throw new Error('Fresh profile contains preferences');
    if (operation === 'seed') {
      localStorage.setItem(key, JSON.stringify({
        playback: { quality: '720p', audioOffsetMs: 125 },
        appearance: { theme: 'dark', posterSize: 'small' },
      }));
    }
    if (operation === 'retain') {
      const value = JSON.parse(saved ?? 'null');
      if (value?.playback?.quality !== '720p' || value?.playback?.audioOffsetMs !== 125 ||
          value?.appearance?.theme !== 'dark' || value?.appearance?.posterSize !== 'small') {
        throw new Error('Upgrade lost saved preferences');
      }
    }
    return { operation, origin: location.origin, loginVisible: true, loginActionable: true, realTauri: true,
      preferencesRetained: operation === 'retain' };
  }, mode);
  await page.screenshot({ path: report.replace(/\.json$/, '.png') });
  await writeFile(report, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`PASS frontend readiness (${mode}); real WebView2 login screen`);
} finally {
  // For a CDP attachment this disconnects; Windows WM_CLOSE owns app shutdown.
  await browser.close();
}
