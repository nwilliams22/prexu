import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, REQUIRED } from './full-contract.mjs';
const complete = () => Object.fromEntries(Object.entries(REQUIRED).map(([slice, journeys]) => [slice, { rows: journeys.map(journey => ({ journey, status: 'PASS' })) }]));
test('full gate requires every row and rejects failures and duplicate results', () => {
  assert.equal(assess(complete()).status, 'PASS');
  for (const slice of Object.keys(REQUIRED)) {
    const missing = complete(); missing[slice].rows.pop(); assert.equal(assess(missing).status, 'FAIL');
    const duplicate = complete(); duplicate[slice].rows.push(duplicate[slice].rows[0]); assert.equal(assess(duplicate).status, 'FAIL');
    for (const status of ['FAIL','SKIP','NOT_RUN','UNSUPPORTED']) {
      const partial = complete(); partial[slice].rows[0].status = status; assert.equal(assess(partial).status, 'FAIL');
    }
  }
  const extra = complete(); extra.relay.rows.push({ journey: 'setup', status: 'FAIL' }); assert.equal(assess(extra).status, 'FAIL');
  const hidden = complete(); hidden.browser.rows.push({ journey: 'login', status: 'FAIL' }); assert.equal(assess(hidden).status, 'FAIL');
  assert.equal(assess({}).status, 'FAIL');
});

// Each Downloads behaviour must remain a gate, even when every other slice passes.
test('every Downloads acceptance row is mandatory', () => {
  for (const slice of ['downloadQueue', 'downloadStorage', 'downloadMove', 'downloadCleanup']) {
    for (const journey of REQUIRED[slice]) {
      const report = complete();
      report[slice].rows = report[slice].rows.filter(row => row.journey !== journey);
      assert.equal(assess(report).status, 'FAIL', `${slice}/${journey}`);
    }
  }
});
