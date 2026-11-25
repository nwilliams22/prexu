import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for (const missing of ['PREXU_QA_PLEX_AUTH', 'PREXU_QA_PLEX_GUEST_AUTH']) {
  test(`relay fails closed without ${missing}`, () => {
    const env = { ...process.env, PREXU_QA_PLEX_AUTH: 'unused', PREXU_QA_PLEX_GUEST_AUTH: 'unused' };
    delete env[missing]; delete env.PREXU_JOURNEY_REPORT;
    const child = spawnSync(process.execPath, ['scripts/real-journeys/relay.mjs'], { env, encoding: 'utf8', timeout: 15000 });
    assert.equal(child.error, undefined); assert.equal(child.status, 1);
    const report = JSON.parse(child.stdout);
    assert.deepEqual(report.rows[0], { journey: 'prerequisites', status: 'FAIL' });
    assert.deepEqual(report.rows.at(-1), { journey: 'cleanup', status: 'PASS' });
    assert.ok(!child.stdout.includes('unused'));
  });
}
