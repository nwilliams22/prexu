import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from './click-timing.mjs';
function sample() {
  const row={before:100,after:102,browser:{mono:10,origin:1000}};
  return { calibrationBefore:Array(5).fill(row),calibrationAfter:Array(5).fill(row),
    beforeTimestamp:103,afterTimestamp:104,trace:[105,106,107,108,109],afterFunction:110,
    sample:{clicks:[{mono:20,trusted:true}],pauses:[{mono:25,paused:true}]} };
}
test('bounded clock conversion and independent DOM latency',()=>{
 const result=analyze(sample());
 assert.equal(result.accepted,true);assert.deepEqual(result.offsetMs,[90,92]);
 assert.deepEqual(result.outerToPauseMs,[12,14]);assert.equal(result.domToPauseMs,5);
 assert.equal(result.downCallMs,1);
});
test('reject incompatible before/after bridge; retain DOM latency',()=>{
 const s=sample();s.calibrationAfter=[{before:200,after:202,browser:{mono:10,origin:1000}},...s.calibrationAfter.slice(1)];
 const result=analyze(s);assert.equal(result.accepted,false);assert.equal(result.domToPauseMs,5);
 assert.ok(result.reasons.includes('incompatible clock intervals'));assert.equal(result.outerToPauseMs,undefined);
});
test('reject reload, untrusted click, duplicate event, resume and malformed markers',()=>{
 for(const mutate of [
  s=>s.calibrationAfter=[{before:100,after:102,browser:{mono:10,origin:1001}},...s.calibrationAfter.slice(1)],
  s=>s.sample.clicks[0].trusted=false,
  s=>s.sample.pauses.push({...s.sample.pauses[0]}),
  s=>s.sample.pauses[0].paused=false,
  s=>s.trace[2]=NaN,
  s=>s.trace[3]=100,
  s=>s.calibrationBefore=[],
 ]) {const s=sample();mutate(s);assert.equal(analyze(s).accepted,false);}
});
