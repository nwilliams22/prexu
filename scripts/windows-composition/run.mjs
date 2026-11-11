// Run only against the disposable win11-test VM. Never attach to an occupied VM.
import { chromium } from '@playwright/test';
import { requiredScenarios, verifyScenarios } from './scenarios.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const [candidateArg, outputArg, mode] = process.argv.slice(2);
if (mode && mode !== "--scenarios") throw new Error("Unknown runner mode");
const scenarios = mode === "--scenarios";
if (!candidateArg || !outputArg) throw new Error('Usage: node scripts/windows-composition/run.mjs CANDIDATE_DIRECTORY EVIDENCE_DIRECTORY [--scenarios]');
const candidate = resolve(candidateArg), output = resolve(outputArg);
const scripts = dirname(fileURLToPath(import.meta.url));
const remote = 'C:\\Users\\baddong\\qa-composition';
const port = 19346;
const sshArgs = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'win11-test'];
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 180_000, ...options });
const ssh = (command) => run('ssh', [...sshArgs, command]);
const ps = value => `'${value.replaceAll("'", "''")}'`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const token = process.env.PREXU_QA_PLEX_AUTH;
if (!token) throw new Error('PREXU_QA_PLEX_AUTH is required; do not pass it on the command line');
if (existsSync(output) && readdirSync(output).length) throw new Error('Evidence directory must be empty; stale captures cannot establish a new verdict');
mkdirSync(output, { recursive: true });
const manifest = readFileSync(join(candidate, 'SHA256SUMS.txt'), 'utf8');
const installer = readdirSync(candidate).find(name => name.endsWith('x64-setup.exe'));
if (!installer) throw new Error('Candidate NSIS installer missing');
const expected = manifest.split(/\r?\n/).find(line => line.endsWith(installer))?.split(/\s+/)[0];
if (!/^[a-fA-F0-9]{64}$/.test(expected ?? '')) throw new Error('Installer missing from checksum manifest');
if (createHash('sha256').update(readFileSync(join(candidate, installer))).digest('hex') !== expected.toLowerCase()) throw new Error('Installer checksum mismatch');
writeFileSync(join(output, 'BUILD.txt'), readFileSync(join(candidate, 'BUILD.txt')));
let browser, tunnel, desktop, fixtureServer, fixturePort, started = false;
const scratch = mkdtempSync(join(tmpdir(), 'prexu-composition-'));
try {
 const status = run('sudo', ['-n', 'win11-vm', 'status']);
 if (!status.includes('state: shut off')) throw new Error('VM is occupied; coordinate its owner before running');
 started = true;
 writeFileSync(join(output, 'hardware.txt'), run('sudo', ['-n', 'win11-vm', 'start'], { timeout: 600_000 }));
 ssh(`New-Item -ItemType Directory -Force ${ps(remote)} | Out-Null`);
 run('scp', ['-o','BatchMode=yes',join(candidate,installer), 'win11-test:C:/Users/baddong/qa-composition/setup.exe']);
 run('scp', ['-o','BatchMode=yes',join(scripts,'desktop.ps1'), 'win11-test:C:/Users/baddong/qa-composition/desktop.ps1']);
 if(scenarios) run('scp', ['-o','BatchMode=yes',join(scripts,'scenarios.ps1'), 'win11-test:C:/Users/baddong/qa-composition/scenarios.ps1']);
 run('scp', ['-o','BatchMode=yes',join(scripts,'probe.ps1'), 'win11-test:C:/Users/baddong/qa-composition/probe.ps1']);
 let probe,probeError;
 try {probe=ssh(`C:\\ProgramData\\EvalBuild\\gui-run.ps1 powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File ${remote}\\probe.ps1" -Wait`);} catch(error){probe=String(error.stdout || error.message);probeError=error;}
 writeFileSync(join(output,'probe-launch.txt'),probe);
 run('scp',['-o','BatchMode=yes','win11-test:C:/Users/baddong/qa-composition/probe.txt',join(output,'probe.txt')]);
 if(probeError)throw new Error('D3D11 prerequisite failed; see probe.txt');
 try {writeFileSync(join(output,'pixel-selftest.txt'),ssh(`powershell -NoProfile -ExecutionPolicy Bypass -File ${remote}\\desktop.ps1 -SelfTest -Output ${remote}\\selftest`));}
 catch(error){
  run('scp',['-o','BatchMode=yes','win11-test:C:/Users/baddong/qa-composition/selftest/error.txt',join(output,'pixel-selftest-error.txt')]);
  throw error;
 }
 run('python3',[join(scripts,'fixture.py'),scratch],{timeout:180_000});
 writeFileSync(join(output,'fixture.json'),readFileSync(join(scratch,'fixture.json')));
 fixtureServer=spawn('python3',[join(scripts,'serve.py'),join(scratch,'pattern-loop.mkv'),join(scratch,'port.txt')],{stdio:'ignore'});
 const serverDeadline=Date.now()+15_000;
 while(!existsSync(join(scratch,'port.txt'))){if(fixtureServer.exitCode!==null || Date.now()>serverDeadline)throw new Error('Fixture server failed to bind loopback');await sleep(100);}
 fixturePort=Number(readFileSync(join(scratch,'port.txt'),'utf8'));
 if(!Number.isInteger(fixturePort) || fixturePort<1)throw new Error('Invalid fixture port');
 const clientIdentifier = randomUUID();
 const response = await fetch('https://clients.plex.tv/api/v2/user', { headers: { 'X-Plex-Token': token, 'X-Plex-Client-Identifier': clientIdentifier, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
 if (!response.ok) throw new Error(`QA identity lookup failed: HTTP ${response.status}`);
 const user = await response.json();
 const store = join(scratch, 'secure-store.json');
 writeFileSync(store, JSON.stringify({ auth_data: { authToken: token, clientIdentifier }, active_user: { id: user.id, title: user.friendlyName || user.username, username: user.username, thumb: user.thumb || '', isAdmin: true, isHomeUser: false } }), { mode: 0o600 });
 ssh('New-Item -ItemType Directory -Force "$env:APPDATA\\com.prexu.client" | Out-Null');
 run('scp', ['-o','BatchMode=yes',store,'win11-test:C:/Users/baddong/AppData/Roaming/com.prexu.client/secure-store.json']);
 rmSync(store);
 const install = ssh(`$p=Start-Process -Wait -PassThru ${ps(remote+'\\setup.exe')} -ArgumentList '/S'; if($p.ExitCode -ne 0){throw "Installer exit $($p.ExitCode)"}; 'INSTALL_EXIT=0'; $k='HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments'; New-Item $k -Force | Out-Null; New-ItemProperty $k -Name Prexu.exe -Value '--remote-debugging-port=9222' -PropertyType String -Force | Out-Null; C:\\ProgramData\\EvalBuild\\gui-run.ps1 "$env:LOCALAPPDATA\\Prexu\\Prexu.exe"`);
 writeFileSync(join(output,'install.txt'),install);
 tunnel = spawn('ssh', ['-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-N','-L',`127.0.0.1:${port}:127.0.0.1:9222`,'-R',`127.0.0.1:18446:127.0.0.1:${fixturePort}`,'win11-test'], { stdio: 'ignore' });
 const deadline=Date.now()+90_000;
 while (!browser && Date.now()<deadline) {
  if(tunnel.exitCode!==null) throw new Error('CDP tunnel failed (port occupied?)');
  try { browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:3000}); } catch { await sleep(500); }
 }
 if(!browser)throw new Error('Installed WebView2 not ready');
 const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('tauri.localhost'));
 if(!page)throw new Error('Real application page missing');
 await page.getByText('Prexu QA Pattern',{exact:true}).last().waitFor({timeout:60_000});
 await page.getByText('Prexu QA Pattern',{exact:true}).last().click();
 await page.getByRole('button',{name:/^▶ (Play|Resume from .+)$/}).waitFor({timeout:60_000});
 const composition=ssh('Get-Content "$env:LOCALAPPDATA\\com.prexu.client\\logs\\Prexu.log" | Select-String "DComp tree committed|render thread up" | ForEach-Object {$_.Line}');
 writeFileSync(join(output,'composition.txt'),composition);
 if(!composition.includes('DComp tree committed') || !composition.includes('render thread up'))throw new Error('Composition/render prerequisite not ready; see composition.txt');
 desktop=spawn('ssh',[...sshArgs,`C:\\ProgramData\\EvalBuild\\gui-run.ps1 conhost.exe -ArgumentList "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${remote}\\desktop.ps1 ${scenarios ? "-Scenarios" : ""} -Output ${remote}\\evidence" -Wait -TimeoutSec 1200`],{stdio:['ignore','pipe','pipe']});
 let desktopOutput='';desktop.stdout.on('data',b=>desktopOutput+=b);desktop.stderr.on('data',b=>desktopOutput+=b);
 const readyDeadline=Date.now()+180_000;
 while(!ssh(`Test-Path ${ps(remote+'\\evidence\\ready')}`).includes('True')){if(Date.now()>readyDeadline)throw new Error('Desktop worker initialization timed out');await sleep(500);}
 const beginning=page.getByRole('button',{name:'Play from Beginning',exact:true});
 if(await beginning.count()) await beginning.click();
 else await page.getByRole('button',{name:'▶ Play',exact:true}).click();
 // The native load may still be preparing a remote source after the click.
 await page.getByRole('button',{name:'Pause',exact:true}).waitFor({state:'attached',timeout:90_000});
 const loadDeadline=Date.now()+90_000;
 while(!ssh('Get-Content "$env:LOCALAPPDATA\\com.prexu.client\\logs\\Prexu.log" | Select-String -SimpleMatch "received ready event"').includes('received ready event')){if(Date.now()>loadDeadline)throw new Error('Original QA source did not reach ready');await sleep(500);}
 await page.evaluate(async()=>{
  await window.__TAURI_INTERNALS__.invoke('player_load_url',{url:'http://127.0.0.1:18446/pattern.mkv',headers:{'X-Plex-Client-Identifier':'prexu-local-fixture'},startOffsetMs:0});
  await window.__TAURI_INTERNALS__.invoke('player_pause');
 });
 ssh(`Set-Content ${ps(remote+'\\evidence\\go')} start`);
 const finishDeadline=Date.now()+1200_000;
 while(desktop.exitCode===null && Date.now()<finishDeadline)await sleep(1000);
 writeFileSync(join(output,'desktop.txt'),desktopOutput);
 if(desktop.exitCode===null)throw new Error('Desktop worker did not finish');
 run('scp',['-o','BatchMode=yes','-r','win11-test:C:/Users/baddong/qa-composition/evidence',output]);
 writeFileSync(join(output,'playback-events.txt'),ssh('Get-Content "$env:LOCALAPPDATA\\com.prexu.client\\logs\\Prexu.log" | Select-String -SimpleMatch "[player:cmd] pause","[player:cmd] play","[player:events] paused=" | ForEach-Object {$_.Line}'));
 if(desktop.exitCode!==0)throw new Error(`Desktop worker exited ${desktop.exitCode}; see desktop.txt`);
 if(existsSync(join(output,'evidence','error.txt')))throw new Error('Desktop script failed; see evidence/error.txt');
 if(!existsSync(join(output,'evidence','complete')))throw new Error('Desktop evidence did not finish saving');
 const metrics=JSON.parse(readFileSync(join(output,'evidence','metrics.json'),'utf8').replace(/^\uFEFF/,''));
 console.log(JSON.stringify(metrics.map(({name,pass})=>({name,pass})),null,2));
 const required=scenarios ? requiredScenarios : ['baseline','alt-tab','away-focus','occlusion-focus','minimize-state','return-focus','return','space-paused','space-resumed','uncovered','restored',...['scale-150','scale-100','monitor-2','monitor-1'].flatMap(n=>[n,`${n}-video-bounds`,`${n}-dpi`,`controls-${n}-paused`,`controls-${n}-resumed`])];
 if(required.some(name=>!metrics.some(m=>m.name===name)))throw new Error('Incomplete matrix: a required verdict is missing');
 if(scenarios) writeFileSync(join(output,'verdict.json'), JSON.stringify(verifyScenarios(join(output,'evidence')),null,2));
 if(metrics.some(m=>!m.pass))process.exitCode=1;
} catch(error) {
 writeFileSync(join(output,'failure.txt'),String(error));
 if(started) {
  try {run('scp',['-o','BatchMode=yes','-r','win11-test:C:/Users/baddong/qa-composition/evidence',output]);} catch {}
  try {writeFileSync(join(output,'failure-playback.txt'),ssh('Get-Content "$env:LOCALAPPDATA\\com.prexu.client\\logs\\Prexu.log" | Select-String -SimpleMatch "FileLoaded","paused=","destroy:","stop_playback:","player:init","warmup","received ready","load_url returned" | ForEach-Object {$_.Line}'));} catch {}
 }
 throw error;
} finally {
 await browser?.close().catch(()=>{});
 tunnel?.kill();desktop?.kill();fixtureServer?.kill();
 rmSync(scratch,{recursive:true,force:true});
 if(started) {
  writeFileSync(join(output,'reset.txt'),run('sudo',['-n','win11-vm','reset'],{timeout:360_000}));
  writeFileSync(join(output,'final-status.txt'),run('sudo',['-n','win11-vm','status']));
 }
}
