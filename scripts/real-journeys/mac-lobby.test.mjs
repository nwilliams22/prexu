import test from 'node:test';
import assert from 'node:assert/strict';
import { safariPin, macLogExcerpt } from './mac-lobby-contract.mjs';

test('Safari canonical path remains restricted to the Plex PIN endpoint', () => {
  assert.equal(safariPin('https://app.plex.tv/auth/#?code=ABCD'), 'ABCD');
  assert.equal(safariPin('https://app.plex.tv/auth#?code=ABCD'), 'ABCD');
  for (const url of ['https://evil.test/auth/#?code=ABCD', 'https://app.plex.tv/other/#?code=ABCD', 'https://app.plex.tv/auth/#?code=ABCD&code=EFGH', 'https://user:secret@app.plex.tv/auth/#?code=ABCD']) {
    assert.throws(() => safariPin(url));
  }
});

test('log evidence excludes raw URLs, tokens, payloads and unrelated events', () => {
  const raw = '[2026-11-26][17:25:00][webview][INFO] [playback] canDirectPlay {"canDirectPlay": true,"url":"https://secret.test/?token=PRIVATE"}\n' +
    '[watch:sync] Connected to relay https://secret.test PRIVATE\n[playback] raw PRIVATE\n';
  assert.equal(macLogExcerpt(raw), '[2026-11-26][17:25:00] [playback] canDirectPlay {"canDirectPlay":true}\n[watch:sync] Connected to relay\n');
});
