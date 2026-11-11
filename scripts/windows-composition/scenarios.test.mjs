import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requiredScenarios, verifyScenarios } from './scenarios.mjs';

function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'scenario-gate-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const save=(name,value)=>writeFileSync(join(root,name),JSON.stringify(value));
 const session={schema:'prexu.windows.scenarios.v1',sessionId:1,capture:'Win32 CopyFromScreen',displays:[{bounds:[0,0,1280,800]}],gpu:[{Name:'Microsoft Basic Render Driver'}],backend:'test',utc:new Date().toISOString()};
 save('session.json',session);
 const metrics=requiredScenarios.map(name=>({name,pass:true,videoPresent:true,chrome:true,chromeWhiteFraction:.08,chromeWhiteFractionB:.08,moving:name!=='fault-detected',metrics:[1,1,name==='fault-detected'?0:.1],firstUtc:'2026-11-11T00:00:00Z',secondUtc:'2026-11-11T00:00:01.100Z'}));
 save('metrics.json',metrics);
 // Header fixture tests completeness only; native pixel detection is exercised on Windows.
 const png=Buffer.alloc(100);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(1280,16);png.writeUInt32BE(800,20);
 for(const name of requiredScenarios){const n=name==='fault-detected'?'injected-freeze':name;for(const file of name==='stop'?['stop.png']:[`${n}-a.png`,`${n}-b.png`])writeFileSync(join(root,file),png);}
 return {root,save,session,metrics};
}
test('complete evidence passes',t=>assert.equal(verifyScenarios(fixture(t).root).pass,true));
test('missing composed capture fails closed',t=>{const f=fixture(t);rmSync(join(f.root,'mini-a.png'));assert.throws(()=>verifyScenarios(f.root));});
test('session zero is rejected',t=>{const f=fixture(t);f.session.sessionId=0;f.save('session.json',f.session);assert.throws(()=>verifyScenarios(f.root),/metadata/);});
test('failed, duplicate, incomplete and untimed matrices are rejected',t=>{const f=fixture(t);for(const mutate of [m=>m[0].pass=false,m=>m[0].name='seek',m=>m.pop(),m=>m[0].secondUtc='2026-11-11T00:01:00Z']){const m=structuredClone(f.metrics);mutate(m);f.save('metrics.json',m);assert.throws(()=>verifyScenarios(f.root));}});
test('native fault requires captured frozen video',t=>{const f=fixture(t);f.metrics.find(m=>m.name==='fault-detected').moving=true;f.save('metrics.json',f.metrics);assert.throws(()=>verifyScenarios(f.root),/freeze/);});

test('bright colored video cannot impersonate visible chrome',t=>{const f=fixture(t);f.metrics[0].chromeWhiteFraction=0;f.save('metrics.json',f.metrics);assert.throws(()=>verifyScenarios(f.root),/observation/);});
