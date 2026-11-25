/** Disposable native guest controlled through a nonce-scoped, loopback-only driver. */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pinCode } from './native-contract.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function nativeClient(token, relayUrl) {
  const endpoint = `/__relay_guest/${randomBytes(24).toString('hex')}`;
  const commands = [], pending = new Map(), children = [];
  let nextId = 0, generation = 0, root, linked = false, openAttempted = false, linkStatus = 0, clientIdentifier;
  const driver = `
void (async () => { if (window.__TAURI_INTERNALS__) {
 const endpoint = ${JSON.stringify(endpoint)};
 const { saveRelayUrl, getAuth, getServer } = await import('/src/services/storage/index.ts');
 const sleep = ms => new Promise(r => setTimeout(r, ms));
 await saveRelayUrl(${JSON.stringify(relayUrl)});
 if (!localStorage.getItem('relay-guest-login')) {
  const end = Date.now() + 90000;
  let clicked = false;
  while (Date.now() < end) {
   const buttons = [...document.querySelectorAll('button')];
   if (!clicked) { const b = buttons.find(b => b.textContent.trim() === 'Sign in with Plex'); if (b) { b.click(); clicked = true; } }
   if ((await getAuth())?.authToken) {
    const b = buttons.find(b => b.textContent.includes('Prexu QA Test Server')); if (b) b.click();
    if ((await getServer())?.name === 'Prexu QA Test Server') { localStorage.setItem('relay-guest-login','yes'); break; }
   }
   await sleep(200);
  }
 }
 await fetch(endpoint + '/ready', { method:'POST', body: JSON.stringify({ authenticated: Boolean((await getAuth())?.authToken), qaServer: (await getServer())?.name === 'Prexu QA Test Server' }) });
 while (true) {
  try {
   const command = await (await fetch(endpoint + '/poll')).json();
   if (command.id) {
    let result;
    try { result = { id: command.id, ok: true, value: await (0,eval)('(' + command.source + ')')(command.arg) }; }
    catch { result = { id: command.id, ok:false }; }
    await fetch(endpoint + '/result', { method:'POST', body:JSON.stringify(result) });
   }
  } catch { /* Reload shuts down this loop with its document. */ }
  await sleep(50);
 }
} })();
`;
  let authenticated = false;
  const plugin = {
    name: 'isolated-real-relay-native-guest',
    transformIndexHtml() { return [{ tag:'script', attrs:{type:'module',src:`${endpoint}/driver.js`}, injectTo:'body' }]; },
    configureServer(vite) {
      vite.middlewares.use(async (req,res,next) => {
        if (!req.url?.startsWith(endpoint)) return next();
        try {
          if (req.url === `${endpoint}/driver.js` && req.method === 'GET') { res.setHeader('Content-Type','text/javascript'); res.end(driver); return; }
          if (req.url === `${endpoint}/poll` && req.method === 'GET') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(commands.shift() || {})); return; }
          if (req.method !== 'POST') throw Error();
          let body=''; for await (const chunk of req) { body+=chunk; if(body.length>16384) throw Error(); }
          if (req.url === `${endpoint}/open`) {
            openAttempted = true; if(linked) throw Error();
            const code=pinCode(body);
            clientIdentifier = new URLSearchParams(new URL(body).hash.slice(2)).get('clientID');
            if (!clientIdentifier || !/^[a-zA-Z0-9_-]{1,128}$/.test(clientIdentifier)) throw Error();
            const response=await fetch('https://plex.tv/api/v2/pins/link',{method:'PUT',headers:{Accept:'application/json','X-Plex-Token':token,'X-Plex-Client-Identifier':'prexu-relay-native-guest','X-Plex-Product':'Plex Web','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code}),redirect:'error',signal:AbortSignal.timeout(15000)});
            linkStatus=response.status; if(!response.ok) throw Error(); linked=true;
          } else if(req.url === `${endpoint}/ready`) {
            const data=JSON.parse(body); authenticated=linked && data.authenticated === true && data.qaServer === true; generation++;
          } else if(req.url === `${endpoint}/result`) {
            const result=JSON.parse(body); const callback=pending.get(result.id); if(callback) { pending.delete(result.id); callback(result); }
          } else throw Error();
          res.end('ok');
        } catch { res.statusCode=400; res.end('failed'); }
      });
    },
  };
  async function until(fn, timeout=60000) { const end=Date.now()+timeout; while(Date.now()<end) { if(await fn()) return; await sleep(100); } throw Error('native-client-deadline'); }
  async function evaluate(fn,arg) {
    const id=++nextId;
    return new Promise((ok,fail) => {
      const timer=setTimeout(()=>{pending.delete(id); const index=commands.findIndex(c=>c.id===id); if(index>=0) commands.splice(index,1); fail(Error('native-rpc-deadline'));},60000);
      pending.set(id,result=>{clearTimeout(timer); if(result.ok) ok(result.value); else fail(Error('native-rpc'));});
      commands.push({id,source:fn.toString(),arg});
    });
  }
  function locator(role, options={}) {
    const spec={role,name:options.name,pattern:null};
    const action=kind=>evaluate(({spec,kind})=>{
      const selector=spec.role==='button'?'button':spec.role==='heading'?'h1,h2,h3':`[role="${spec.role}"]`;
      const nodes=[...document.querySelectorAll(selector)].filter(e=> (!spec.name || [e.getAttribute('aria-label'),e.title,e.textContent.trim()].includes(spec.name)) && (!spec.pattern || new RegExp(spec.pattern).test(e.textContent.trim())));
      const visible=e=>e.getBoundingClientRect().width>0 && getComputedStyle(e).visibility!=='hidden' && getComputedStyle(e).display!=='none';
      if(kind==='click') { const node=nodes.find(visible); if(!node) throw Error(); node.click(); return; }
      if(kind==='detached') return nodes.length===0;
      return nodes.some(visible);
    },{spec,kind});
    return {
      filter({hasText}) { spec.pattern=hasText.source; return this; },
      isVisible:()=>action('visible'),
      async waitFor(options={}) { await until(()=>action(options.state==='detached'?'detached':'visible')); },
      async click() { await until(()=>action('visible')); await action('click'); },
    };
  }
  const page={evaluate,getByRole:locator,
    async goto(url) { const before=generation; await evaluate(url=>{setTimeout(()=>location.assign(new URL(url).pathname + new URL(url).search),100);},url); await until(()=>generation>before && authenticated); },
    async reload() { const before=generation; await evaluate(()=>{setTimeout(()=>location.reload(),100);}); await until(()=>generation>before && authenticated); },
  };
  return {plugin,page, clientIdentifier: () => clientIdentifier, diagnostics: () => ({openAttempted, linkStatus, linked, authenticated, generation}),
    async start() {
      root=await mkdtemp(`${tmpdir()}/prexu-relay-native-`); await mkdir(`${root}/bin`);
      await writeFile(`${root}/bin/xdg-open`, `#!/usr/bin/python3\nimport sys, urllib.request\ntry:\n r=urllib.request.Request('http://127.0.0.1:1420${endpoint}/open',data=sys.argv[1].encode(),method='POST')\n urllib.request.urlopen(r,timeout=20).read()\nexcept Exception:\n sys.exit(1)\n`,{mode:0o700});
      const displayFile=`${root}/display`; const display=await open(displayFile,'wx',0o600);
      const xvfb=spawn('Xvfb',['-displayfd','3','-screen','0','1280x800x24','-nolisten','tcp','-ac'],{detached:true,stdio:['ignore','ignore','ignore',display.fd]}); children.push(xvfb); xvfb.on('error',()=>{}); await display.close();
      let number; await until(async()=>{number=(await readFile(displayFile,'utf8')).trim();return /^\d+$/.test(number);},5000);
      const env={}; for(const key of ['PATH','LANG','LD_LIBRARY_PATH']) if(process.env[key]) env[key]=process.env[key];
      Object.assign(env,{PATH:`${root}/bin:${env.PATH}`,HOME:root,XDG_CONFIG_HOME:`${root}/config`,XDG_DATA_HOME:`${root}/data`,XDG_CACHE_HOME:`${root}/cache`,XDG_RUNTIME_DIR:root,DISPLAY:`:${number}`,GDK_BACKEND:'x11',LIBGL_ALWAYS_SOFTWARE:'1'});
      const app=spawn('dbus-run-session',['--',resolve(process.env.PREXU_JOURNEY_APP || 'src-tauri/target/debug/prexu')],{env,detached:true,stdio:'ignore'});children.push(app);app.on('error',()=>{});
      await until(()=>authenticated,100000);
    },
    async close() {
      let clean=true;
      for(const p of children.reverse()) {
        if(!p.pid) continue;
        try {process.kill(-p.pid,'SIGKILL');} catch(e) {if(e.code!=='ESRCH') clean=false;}
      }
      await Promise.all(children.map(p=>p.exitCode!==null || p.signalCode!==null?Promise.resolve():new Promise(ok=>{p.once('close',ok);setTimeout(ok,3000).unref();})));
      if(root) {spawnSync('fusermount3',['-u',`${root}/doc`],{stdio:'ignore'});await rm(root,{recursive:true,force:true,maxRetries:3});}
      if(!clean) throw Error('native-cleanup');
    },
  };
}
