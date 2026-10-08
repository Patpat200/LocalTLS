import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import selfsigned from 'selfsigned';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { createProxy, parseTarget } from '../src/proxy.js';

// Generate fresh, test-only credentials in memory; never write keys to the repo.
const credentials = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
  algorithm: 'sha256',
  keySize: 2048,
  notBeforeDate: new Date(Date.now() - 60000),
  notAfterDate: new Date(Date.now() + 86400000),
  extensions: [
    { name: 'basicConstraints', cA: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] },
  ],
});
const cert = credentials.cert;
const key = credentials.private;
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
async function setup(t, handler, options = {}) {
  const upstream = http.createServer(handler);
  const targetPort = await listen(upstream);
  const proxy = createProxy({ target: String(targetPort), cert, key, ...options });
  const port = await listen(proxy);
  t.after(async () => { await proxy.stop(); await new Promise(resolve => upstream.close(resolve)); });
  return { upstream, proxy, port };
}
function request(port, path = '/', options = {}, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', port, path, ca: cert, ...options }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('TLS trusted explicitly, POST body, query, cookies and forwarded headers', async t => {
  const { port } = await setup(t, async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    res.setHeader('set-cookie', ['one=1; Secure', 'two=2; Secure']);
    res.end(JSON.stringify({ body, path: req.url, method: req.method, headers: req.headers }));
  });
  const result = await request(port, '/hello?q=one%20two', { method: 'POST', headers: { 'x-forwarded-proto': 'fake', 'x-forwarded-for': 'fake' } }, 'payload');
  const value = JSON.parse(result.body);
  assert.equal(value.body, 'payload');
  assert.equal(value.method, 'POST');
  assert.equal(value.path, '/hello?q=one%20two');
  assert.equal(value.headers['x-forwarded-proto'], 'https');
  assert.equal(value.headers['x-forwarded-for'], '127.0.0.1');
  assert.equal(result.headers['set-cookie'].length, 2);
});

test('rewrites target redirects and strips connection-specific headers', async t => {
  const { port } = await setup(t, (req, res) => {
    assert.equal(req.headers['x-private'], undefined);
    res.writeHead(302, { location: `http://${req.headers.host}/login?next=1`, connection: 'close, x-private', 'x-private': 'secret' });
    res.end();
  });
  const result = await request(port, '/', { headers: { connection: 'close, x-private', 'x-private': 'secret' } });
  assert.equal(result.status, 302);
  assert.equal(result.headers.location, `https://127.0.0.1:${port}/login?next=1`);
  assert.equal(result.headers['x-private'], undefined);
});

test('streams SSE before the upstream ends', { timeout: 5000 }, async t => {
  let finish;
  const { port } = await setup(t, (req, res) => {
    finish = () => res.end('data: second\n\n');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: first\n\n');
  });
  await new Promise((resolve, reject) => {
    https.get({ hostname: '127.0.0.1', port, ca: cert }, res => {
      let body = '';
      res.on('data', chunk => {
        body += chunk;
        if (body === 'data: first\n\n') finish();
      });
      res.on('end', () => { assert.equal(body, 'data: first\n\ndata: second\n\n'); resolve(); });
      res.on('error', reject);
    }).on('error', reject);
  });
});

test('WebSocket handshake and bidirectional bytes', { timeout: 5000 }, async t => {
  const { upstream, port } = await setup(t);
  upstream.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    if (head.length) socket.write(head);
    socket.pipe(socket);
  });
  await new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', port, ca: cert, headers: { connection: 'Upgrade', upgrade: 'websocket' } });
    req.on('error', reject);
    req.on('upgrade', (res, socket) => {
      // A masked text frame sent through the raw tunnel, echoed unchanged.
      const frame = Buffer.from([0x81, 0x82, 1, 2, 3, 4, 0x69, 0x6b]);
      socket.once('data', data => { assert.deepEqual(data, frame); socket.destroy(); resolve(); });
      socket.on('error', reject);
      socket.write(frame);
    });
    req.end();
  });
});

test('unavailable upstream gives 502', async t => {
  const { upstream, port } = await setup(t);
  await new Promise(resolve => upstream.close(resolve));
  assert.equal((await request(port)).status, 502);
});

test('upstream timeout gives 504', async t => {
  const { port } = await setup(t, () => {}, { timeout: 50 });
  assert.equal((await request(port)).status, 504);
});

test('target and CLI reject invalid input before loading certificates', () => {
  assert.equal(parseTarget('5173').origin, 'http://127.0.0.1:5173');
  for (const value of ['ftp://localhost', 'http://user:pass@localhost', 'http://localhost/path']) assert.throws(() => parseTarget(value));
  for (const args of [['--port', '0'], ['--port', 'abc'], ['--unknown'], ['3443']]) {
    const result = spawnSync(process.execPath, ['bin/local-https.js', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Error:/);
  }
});
