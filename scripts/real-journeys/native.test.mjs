import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pinCode, validEvent } from './native-contract.mjs';

test('PIN handoff refuses alternate destinations and ambiguous codes', () => {
  assert.equal(pinCode('https://app.plex.tv/auth#?clientID=test&code=ABCD'), 'ABCD');
  for (const value of ['https://example.com/auth#?code=ABCD',
    'http://app.plex.tv/auth#?code=ABCD', 'https://app.plex.tv/other#?code=ABCD',
    'https://user:pass@app.plex.tv/auth#?code=ABCD',
    'https://app.plex.tv/auth?code=ABCD', 'https://app.plex.tv/auth#?code=ABCD&code=EFGH',
    'https://app.plex.tv/auth#?code=AB%26CD', 'not-a-url']) assert.throws(() => pinCode(value));
});

test('reports reject raw payloads and unknown labels', () => {
  assert.ok(validEvent({ journey: 'native-login', status: 'PASS' }));
  assert.ok(!validEvent({ journey: 'native-login', status: 'PASS', token: 'secret' }));
  assert.ok(!validEvent({ journey: 'raw exception', status: 'FAIL' }));
  assert.ok(!validEvent({ journey: 'native-login', status: 'SKIP' }));
});

test('native runner fails before startup when credentials are missing', () => {
  const env = { ...process.env };
  delete env.PREXU_QA_PLEX_AUTH;
  delete env.PREXU_JOURNEY_REPORT;
  const child = spawnSync(process.execPath, ['scripts/real-journeys/native.mjs'],
    { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  const report = JSON.parse(child.stdout);
  assert.deepEqual(report.rows[0], { journey: 'prerequisites', status: 'FAIL' });
  assert.ok(report.rows.some(row => row.journey === 'cleanup' && row.status === 'PASS'));
  assert.equal(report.rows.some(row => row.journey === 'native-login'), false);
  assert.equal(child.stderr, '');
});
