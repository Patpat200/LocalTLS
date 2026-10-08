import http from 'node:http';
import https from 'node:https';

const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
function cleanHeaders(input) {
  const headers = { ...input };
  for (const name of [...hopHeaders, ...String(input.connection || '').split(',').map(s => s.trim().toLowerCase())]) delete headers[name];
  return headers;
}

export function parseTarget(value) {
  const target = new URL(/^\d+$/.test(String(value)) ? `http://127.0.0.1:${value}` : value);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('The target must be a port or an HTTP(S) origin without a path or credentials.');
  }
  return target;
}

/** Create an unstarted HTTPS proxy. The caller owns listen() and close(). */
export function createProxy({ target, key, cert, timeout = 30000, onError = () => {} }) {
  const origin = parseTarget(target);
  const transport = origin.protocol === 'https:' ? https : http;
  const sockets = new Set();
  const headersFor = req => ({
    ...cleanHeaders(req.headers),
    host: origin.host,
    'x-forwarded-host': req.headers.host || '',
    'x-forwarded-proto': 'https',
    'x-forwarded-for': req.socket.remoteAddress || '',
    'x-forwarded-port': String(req.socket.localPort),
  });
  function options(req, websocket = false) {
    // Keep the incoming path as a path: never let an absolute URL change the target.
    const headers = headersFor(req);
    if (websocket) Object.assign(headers, { connection: 'Upgrade', upgrade: 'websocket' });
    return { protocol: origin.protocol, hostname: origin.hostname.replace(/^\[|\]$/g, ''), port: origin.port || undefined, method: req.method, path: req.url, headers };
  }
  function track(socket) {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    return socket;
  }
  const server = https.createServer({ key, cert, minVersion: 'TLSv1.2' }, (req, res) => {
    const upstream = transport.request(options(req), response => {
      const headers = cleanHeaders(response.headers);
      // Redirects to the HTTP upstream should stay on the HTTPS entry point.
      if (headers.location) {
        try {
          const location = new URL(headers.location);
          if (location.origin === origin.origin) headers.location = `https://${req.headers.host}${location.pathname}${location.search}${location.hash}`;
        } catch { /* Relative redirects already work. */ }
      }
      res.writeHead(response.statusCode, headers);
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    upstream.setTimeout(timeout, () => upstream.destroy(Object.assign(new Error('Upstream response timed out'), { code: 'ETIMEDOUT' })));
    upstream.on('error', error => {
      onError(error);
      if (res.headersSent) return res.destroy();
      res.writeHead(error.code === 'ETIMEDOUT' ? 504 : 502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('The local server is not responding. Make sure your application is running.\n');
    });
    req.on('aborted', () => upstream.destroy());
    req.on('error', () => upstream.destroy());
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  });
  server.on('connection', track);
  server.on('upgrade', (req, client, head) => {
    client.on('error', () => client.destroy());
    if (String(req.headers.upgrade).toLowerCase() !== 'websocket') {
      client.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = transport.request(options(req, true));
    const timer = setTimeout(() => upstream.destroy(new Error('WebSocket handshake timeout')), timeout);
    timer.unref();
    client.once('close', () => { clearTimeout(timer); upstream.destroy(); });
    upstream.on('upgrade', (response, remote, remoteHead) => {
      clearTimeout(timer);
      track(remote);
      remote.on('error', () => client.destroy());
      remote.once('close', () => client.destroy());
      client.once('close', () => remote.destroy());
      const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`];
      for (let i = 0; i < response.rawHeaders.length; i += 2) lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
      client.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (remoteHead.length) client.write(remoteHead);
      if (head.length) remote.write(head);
      client.pipe(remote).pipe(client);
    });
    upstream.on('response', response => {
      clearTimeout(timer);
      response.resume();
      client.end(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    });
    upstream.on('error', error => {
      clearTimeout(timer);
      onError(error);
      if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    upstream.end();
  });
  server.stop = () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    for (const socket of sockets) socket.destroy();
  });
  return server;
}
