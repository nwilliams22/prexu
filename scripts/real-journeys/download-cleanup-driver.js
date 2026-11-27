import { getAuth, getServer, saveRelayUrl, getDownloadItems } from '/src/services/storage/index.ts';
import { getLocalFilePath } from '/src/services/downloads.ts';
import { listen } from '/node_modules/@tauri-apps/api/event.js';
const endpoint = __JOURNEY_ENDPOINT__;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms=60000) { const end=Date.now()+ms; while(Date.now()<end) { if(await fn()) return; await sleep(100); } throw Error('deadline'); }
const button = label => [...document.querySelectorAll('button,a')].find(b => !b.disabled && (b.title===label || b.getAttribute('aria-label')===label || b.textContent.trim()===label));
async function click(label) { await until(()=>button(label)); button(label).click(); }
async function nav(path) {
 if(path==='/settings') {
  await until(()=>document.querySelector('button[aria-haspopup="true"]'));
  document.querySelector('button[aria-haspopup="true"]').click();
  await click('Settings');
 } else if(path==='/downloads') { await click('Downloads'); }
 else { await until(()=>document.querySelector(`a[href="${path}"]`)); document.querySelector(`a[href="${path}"]`).click(); }
}
async function emit(journey,status='PASS') { await fetch(endpoint,{method:'POST',body:JSON.stringify({journey,status})}); }
async function shot(label) { await until(()=>!document.querySelector('.loading-screen')); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); await sleep(2500); if (!(await fetch(endpoint+'/screenshot',{method:'POST',body:label})).ok) throw Error('screenshot'); }
async function settings() { await nav('/settings'); await click('Connections & notifications'); await until(()=>document.getElementById('download-auto-delete')); const toggle=document.getElementById('download-auto-delete'); toggle.scrollIntoView({block:'center'}); await sleep(400); return toggle; }
async function present() { return (await getDownloadItems()).some(d=>d.ratingKey==='12' && d.status==='complete') && Boolean(await getLocalFilePath('12')); }
async function watchDownloaded() {
 let time=0,eof=false;
 const untime=await listen('player://time-pos',e=>{time=e.payload});
 const uneof=await listen('player://eof',()=>{eof=true});
 try {
  await click('Play');
  await until(()=>time>1);
  const slider=document.querySelector('[role="slider"][aria-label="Seek"]');
  if(!slider) throw Error('seek');
  const rect=slider.getBoundingClientRect(), x=rect.left+rect.width*.96,y=rect.top+rect.height/2;
  slider.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:y,button:0}));
  document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:x,clientY:y,button:0}));
  await until(()=>eof);
  if(button('Stop')) await click('Stop');
  await sleep(1000);
 } finally { untime(); uneof(); }
}
async function restart(next) { localStorage.setItem('qa-cleanup-stage',next); await sleep(1200); await fetch(endpoint+'/restart',{method:'POST',body:'restart'}); }
async function run() {
 let stage='native-login';
 try {
  await saveRelayUrl('ws://127.0.0.1:1/ws');
  const phase=localStorage.getItem('qa-cleanup-stage');
  if(!phase) {
   await click('Sign in with Plex'); await until(async()=>Boolean((await getAuth())?.authToken));
   await until(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Prexu QA Test Server')); if(b)b.click(); return (await getServer())?.name==='Prexu QA Test Server';});
   await emit(stage); localStorage.setItem('qa-cleanup-stage','prepare-on'); location.assign('/item/12'); return;
  }
  if(phase==='prepare-on' || phase==='prepare-off') {
   stage='cleanup-download';
   await click('Download for offline'); await until(present,120000); await emit(stage+'-'+(phase==='prepare-on'?'on':'off'));
   stage='cleanup-settings';
   const toggle=await settings();
   if(toggle.checked) throw Error('default-not-off');
   if(phase==='prepare-on') { toggle.click(); await until(()=>toggle.checked); }
   await shot(phase==='prepare-on'?'setting-on':'setting-off');
   await nav('/downloads');
   if (phase === 'prepare-on') {
    stage = 'download-movie-grouping';
    await until(() => [...document.querySelectorAll('h3')].some(h => h.textContent.trim() === 'Movies'));
    if (!document.body.textContent.includes('Prexu QA HEVC8') || document.querySelector('section[aria-label="Prexu QA HEVC8"]')) throw Error('movie-group');
    await emit(stage);
   }
   stage='cleanup-playback'; await watchDownloaded(); await emit(stage+'-'+(phase==='prepare-on'?'on':'off'));
   stage='cleanup-current-session-kept'; if(!await present()) throw Error('removed');
   await shot('same-session-'+(phase==='prepare-on'?'on':'off')); await emit('cleanup-current-session-'+(phase==='prepare-on'?'on':'off'));
   await restart(phase==='prepare-on'?'verify-on':'verify-off'); return;
  }
  await nav('/downloads');
  if(phase==='verify-on') {
   stage='cleanup-enabled-relaunch';
   await until(async()=>!(await getDownloadItems()).some(d=>d.ratingKey==='12') && !await getLocalFilePath('12'));
   await until(()=>document.body.textContent.includes('No downloads'));
   await shot('enabled-removed'); await emit(stage);
   stage='cleanup-settings';
   const toggle=await settings(); if(!toggle.checked) throw Error('not-persisted'); toggle.click();
   await until(()=>!toggle.checked);
   localStorage.setItem('qa-cleanup-stage','prepare-off'); location.assign('/item/12'); return;
  }
  stage='cleanup-disabled-relaunch';
  await until(present); await sleep(2000);
  if(!document.body.textContent.includes('Prexu QA HEVC8')) throw Error('not-listed');
  await shot('disabled-retained'); await emit(stage); await emit('native-driver');
 } catch { await shot('failure'); await emit(stage,'FAIL'); await emit('native-driver','FAIL'); }
}
void run();
