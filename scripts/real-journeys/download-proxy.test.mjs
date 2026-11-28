import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { downloadProxy } from './download-proxy.mjs';

test('QA proxy preserves bytes and Range responses and refuses alternate destinations', async () => {
  const ranges = [], seen = [];
  const bytes = Buffer.from([0, 255, 10, 13, 128, 42]);
  const upstream = createServer((req, res) => {
    seen.push({ token: req.headers['x-plex-token'], range: req.headers.range });
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://127.0.0.1:1/leak' }).end(); return; }
    const resumed = req.headers.range === 'bytes=2-';
    const body = resumed ? bytes.subarray(2) : bytes;
    res.writeHead(resumed ? 206 : 200, { 'Content-Length': body.length, ...(resumed ? { 'Content-Range': 'bytes 2-5/6' } : {}) });
    res.end(body);
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const proxy = await downloadProxy({ uri: `http://127.0.0.1:${upstream.address().port}`, token: 'test-only', onResume: n => ranges.push(n), delayMs: 0 });
  try {
    assert.deepEqual(Buffer.from(await (await fetch(proxy.url + '/library/parts/1/file')).arrayBuffer()), bytes);
    const response = await fetch(proxy.url + '/library/parts/1/file', { headers: { Range: 'bytes=2-' } });
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 2-5/6');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(2));
    assert.deepEqual(ranges, [2]);
    assert.deepEqual(seen, [{ token: 'test-only', range: undefined }, { token: 'test-only', range: 'bytes=2-' }]);
    const preflight = await fetch(proxy.url + '/identity', { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:1420', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-plex-token',
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:1420');
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'x-plex-token');
    assert.equal((await fetch(proxy.url, { headers: { Origin: 'https://example.invalid' } })).status, 403);
    assert.equal((await fetch(proxy.url, { method: 'POST' })).status, 400);
    const status = await new Promise((resolve, reject) => {
      const req = request(proxy.url, { path: '//example.invalid/steal' }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(status, 400); assert.equal(seen.length, 2);
    await assert.rejects(fetch(proxy.url + '/redirect'));
  } finally {
    await proxy.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
  }
});
