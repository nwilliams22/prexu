import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const allowSkip of [false, true]) {
  test(`missing credentials ${allowSkip ? 'explicitly skip' : 'fail closed'}`, () => {
    const env = { ...process.env };
    delete env.PREXU_QA_PLEX_AUTH;
    delete env.PREXU_JOURNEY_REPORT;
    const child = spawnSync(process.execPath,
      ['scripts/real-journeys/run.mjs', ...(allowSkip ? ['--allow-missing-service'] : [])],
      { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(child.error, undefined);
    assert.equal(child.status, allowSkip ? 0 : 1);
    const report = JSON.parse(child.stdout);
    assert.equal(report.rows[0].status, allowSkip ? 'SKIP' : 'FAIL');
    assert.equal(report.rows[0].journey, 'prerequisites');
    assert.equal(report.rows.at(-1).status, 'PASS');
    assert.equal(child.stderr, '');
    assert.equal(report.rows.some(row => row.journey === 'session-restore'), false);
  });
}
