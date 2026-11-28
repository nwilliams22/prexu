/** Slow real QA file responses without changing metadata, bytes or Range semantics. */
import { createServer } from 'node:http';
import { once } from 'node:events';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function downloadProxy({ uri, token, onResume, delayMs = 30 }) {
  const origin = new URL(uri).origin;
  const server = createServer(async (req, res) => {
    try {
      // Reachability and metadata use browser fetch. Preserve the run-owned
      // endpoint across auth startup without exposing it to arbitrary origins.
      if (req.headers.origin) {
        if (!['http://localhost:1420', 'http://127.0.0.1:1420'].includes(req.headers.origin)) {
          res.writeHead(403).end(); return;
        }
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'GET');
          res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '');
          res.writeHead(204).end(); return;
        }
      }
      if (req.method !== 'GET' || !req.url?.startsWith('/') || req.url.startsWith('//')) {
        res.writeHead(400).end(); return;
      }
      const target = new URL(req.url, origin);
      if (target.origin !== origin) { res.writeHead(400).end(); return; }
      const headers = { 'X-Plex-Token': token, Accept: req.headers.accept || '*/*', 'Accept-Encoding': 'identity' };
      if (req.headers.range) headers.Range = req.headers.range;
      const upstream = await fetch(target, { headers, redirect: 'error', signal: AbortSignal.timeout(120000) });
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        if (upstream.headers.has(name)) res.setHeader(name, upstream.headers.get(name));
      }
      res.statusCode = upstream.status;
      const part = target.pathname.startsWith('/library/parts/');
      const offset = /^bytes=([0-9]+)-$/.exec(req.headers.range || '')?.[1];
      if (part && upstream.status === 206 && Number(offset) > 0) onResume(Number(offset));
      for await (const chunk of upstream.body) {
        for (let offset = 0; offset < chunk.length; offset += 65536) {
          if (res.destroyed) return;
          if (!res.write(chunk.subarray(offset, offset + 65536))) {
            await new Promise(resolve => {
              const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
              res.once('drain', done); res.once('close', done);
            });
          }
          if (part) await sleep(delayMs);
        }
      }
      res.end();
    } catch { res.destroy(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
