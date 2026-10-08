#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createProxy, parseTarget } from '../src/proxy.js';
import { initializeTrust, loadCertificates } from '../src/certificates.js';

const help = `local-https — Local HTTPS with WebSockets

  local-https init                       Install local trust using mkcert
  local-https 3000                       https://localhost:3443 → HTTP :3000
  local-https --target http://localhost:5173 --port 5443
  local-https 3000 --cert cert.pem --key key.pem

Options:
  --target <port|URL>  Target application (default: 3000)
  --port <port>       HTTPS port (default: 3443)
  --cert <file>       Custom PEM certificate
  --key <file>        Custom PEM private key
  --cert-dir <dir>    mkcert certificate cache directory
  --help, -h          Show this help
  --version, -v       Show the version

Listens on localhost only. Requires Node.js 22+ and mkcert
(or your own certificates). init may require administrator privileges.
`;

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    target: { type: 'string' }, port: { type: 'string', default: '3443' },
    cert: { type: 'string' }, key: { type: 'string' }, 'cert-dir': { type: 'string' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
  } });
  if (values.help) { console.log(help); process.exit(0); }
  if (values.version) { console.log('0.1.0'); process.exit(0); }
  if (positionals.length > 1) throw new Error('Only one target is accepted. See --help.');
  if (positionals[0] === 'init') {
    initializeTrust();
    console.log('Local trust configured. You can now run: local-https 3000');
  } else {
    if (values.target && positionals.length) throw new Error('Use either a positional target or --target.');
    const target = parseTarget(values.target || positionals[0] || '3000');
    const port = Number(values.port);
    if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The HTTPS port must be between 1 and 65535.');
    if (Number(target.port || (target.protocol === 'https:' ? 443 : 80)) === port && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new Error('The target and proxy must use different ports.');
    const credentials = loadCertificates({ ...values, certDir: values['cert-dir'] });
    const server = createProxy({ target: target.href, ...credentials, onError: error => console.error(`[proxy] ${error.code || error.message}`) });
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Choose another port with --port.` : error.message);
      process.exitCode = 1;
    });
    server.listen(port, 'localhost', () => {
      console.log(`\n  https://localhost:${port} → ${target.origin}\n  WebSockets enabled · Ctrl+C to stop\n`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      server.stop().catch(error => { console.error(error.message); process.exitCode = 1; });
    });
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
