import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Offset = host QPC milliseconds - browser performance.now(). All bridge
// round trips enclose the browser timestamp. Intersect before AND after rows;
// never select a convenient row or substitute wall-clock time for monotonic time.
export function analyze(sample) {
  const reasons = [];
  if(sample.sampleError) reasons.push('sample collection error');
  const rows = [...(sample.calibrationBefore ?? []), ...(sample.calibrationAfter ?? [])];
  const validRows = rows.length === 10 && rows.every(r =>
    [r.before, r.after, r.browser?.mono, r.browser?.origin].every(Number.isFinite) && r.before <= r.after);
  if (!validRows) reasons.push('invalid calibration rows');
  const origins = new Set(rows.map(r => r.browser?.origin));
  if (origins.size !== 1) reasons.push('browser time origin changed');
  const low = validRows ? Math.max(...rows.map(r => r.before - r.browser.mono)) : null;
  const high = validRows ? Math.min(...rows.map(r => r.after - r.browser.mono)) : null;
  if (validRows && low > high) reasons.push('incompatible clock intervals');
  const clicks = sample.sample?.clicks ?? [], pauses = sample.sample?.pauses ?? [];
  if (clicks.length !== 1 || clicks[0]?.trusted !== true || !Number.isFinite(clicks[0]?.mono)) reasons.push('expected one trusted click');
  if (pauses.length !== 1 || pauses[0]?.paused !== true || !Number.isFinite(pauses[0]?.mono)) reasons.push('expected one paused=true event');
  const t = sample.trace;
  const host = [sample.beforeTimestamp, sample.afterTimestamp, ...(t ?? []), sample.afterFunction];
  if (!Array.isArray(t) || t.length !== 5 || !host.every(Number.isFinite) || host.some((v,i) => i && v < host[i-1])) reasons.push('invalid host marker order');
  const domToPauseMs = clicks.length === 1 && pauses.length === 1 && Number.isFinite(clicks[0].mono) && Number.isFinite(pauses[0].mono) ? pauses[0].mono - clicks[0].mono : null;
  if (domToPauseMs !== null && domToPauseMs < 0) reasons.push('pause precedes click');
  const accepted = reasons.length === 0;
  const range = (browser, host) => [browser + low - host, browser + high - host];
  return {
    mode: sample.mode, iteration: sample.iteration, cold: sample.cold,
    accepted, reasons, offsetMs: [low, high], calibrationWidthMs: validRows && low <= high ? high-low : null,
    domToPauseMs,
    // Do not emit cross-clock latency for a rejected sample. Raw evidence remains.
    ...(accepted ? {
      timestampCallMs: sample.afterTimestamp-sample.beforeTimestamp,
      timestampReturnToEntryMs: t[0]-sample.afterTimestamp,
      entryToDownMs: t[1]-t[0], downCallMs: t[2]-t[1],
      betweenCallsMs: t[3]-t[2], upCallMs: t[4]-t[3], returnMs: sample.afterFunction-t[4],
      outerToClickMs: range(clicks[0].mono,sample.beforeTimestamp),
      outerToPauseMs: range(pauses[0].mono,sample.beforeTimestamp),
      downToClickMs: range(clicks[0].mono,t[1]),
    } : {}),
  };
}

export function analyzeDirectory(directory) {
  return ['legacy','compiled'].flatMap(mode => [1,2,3].map(n => {
    const name = `${mode}-${n}.json`;
    try { return { file: name, ...analyze(JSON.parse(readFileSync(join(directory,name),'utf8').replace(/^\uFEFF/,''))) }; }
    catch { return { file: name, accepted: false, reasons: ['missing or unreadable sample'] }; }
  }));
}
